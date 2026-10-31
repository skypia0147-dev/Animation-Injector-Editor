//! Validates generated XML with the Animation Injector plugin's own parser.
//! `AnimationInjectorXmlCheck.exe` is built from the runtime sources (Settings.cpp, XmlV2.cpp)
//! and ships beside the editor. The runtime skips a rejected file entirely, so a rejection
//! must block saving; a missing checker only downgrades the result to "unchecked".
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub const CHECKER: &str = "AnimationInjectorXmlCheck.exe";
const TIMEOUT: Duration = Duration::from_secs(15);
const OUTPUT_LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    /// The checker ran and produced its contract output (or failed in a way that is itself a finding).
    pub available: bool,
    pub valid: bool,
    pub actions: Vec<String>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    /// Why no verdict exists when `available` is false.
    pub problem: String,
}

impl Verdict {
    pub fn rejected(&self) -> bool {
        self.available && !self.valid
    }
    pub fn summary(&self) -> String {
        let mut lines: Vec<&str> = self.errors.iter().map(String::as_str).collect();
        if lines.is_empty() {
            lines.extend(self.warnings.iter().map(String::as_str));
        }
        if lines.is_empty() {
            return "런타임이 이 XML을 거부했습니다.".into();
        }
        lines.join(" / ")
    }
}

#[derive(serde::Deserialize)]
struct Output {
    format: u32,
    valid: bool,
    actions: Vec<String>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

pub fn locate() -> Option<PathBuf> {
    let beside = std::env::current_exe().ok()?.parent()?.join(CHECKER);
    if beside.is_file() {
        return Some(beside);
    }
    // Development and test builds use the runtime project's own build output.
    #[cfg(debug_assertions)]
    {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../AnimationInjector/build/Release")
            .join(CHECKER);
        if dev.is_file() {
            return Some(dev);
        }
    }
    None
}

pub fn check(xml: &str) -> Verdict {
    match locate() {
        Some(checker) => check_with(&checker, xml),
        None => Verdict {
            problem: format!("{CHECKER}를 찾지 못했습니다."),
            ..Verdict::default()
        },
    }
}

fn failed(message: String) -> Verdict {
    // The checker runs the plugin's parser; a crash or hang there is a finding, not a skip.
    Verdict {
        available: true,
        errors: vec![message],
        ..Verdict::default()
    }
}

pub fn check_with(checker: &Path, xml: &str) -> Verdict {
    check_in(checker, xml, &std::env::temp_dir())
}

fn check_in(checker: &Path, xml: &str, folder: &Path) -> Verdict {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temporary = folder.join(format!(
        "aieditor-runtime-check-{}-{nonce}-{sequence}.xml",
        std::process::id()
    ));
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .and_then(|mut file| std::io::Write::write_all(&mut file, xml.as_bytes()));
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Verdict {
            problem: format!("검사용 임시 파일을 만들지 못했습니다: {error}"),
            ..Verdict::default()
        };
    }
    let verdict = run(checker, &temporary);
    let _ = fs::remove_file(&temporary);
    verdict
}

fn run(checker: &Path, file: &Path) -> Verdict {
    let mut command = Command::new(checker);
    command
        .arg("--json")
        .arg(file)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Verdict {
                problem: format!("{CHECKER}를 실행하지 못했습니다: {error}"),
                ..Verdict::default()
            }
        }
    };
    // Drain both pipes on their own threads so a large report can never block the checker.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(pipe) = pipe {
                let _ = pipe.take(OUTPUT_LIMIT).read_to_end(&mut bytes);
            }
            bytes
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < TIMEOUT => thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();
    let Some(status) = status else {
        return failed(format!("{CHECKER}가 {}초 안에 끝나지 않았습니다.", TIMEOUT.as_secs()));
    };
    let code = status.code().unwrap_or(-1);
    match serde_json::from_slice::<Output>(&stdout) {
        Ok(output) if output.format == 1 && (code == 0) == output.valid && (code == 0 || code == 2) => Verdict {
            available: true,
            valid: output.valid,
            actions: output.actions,
            errors: output.errors,
            warnings: output.warnings,
            problem: String::new(),
        },
        _ => {
            let detail = String::from_utf8_lossy(if stderr.is_empty() { &stdout } else { &stderr })
                .trim()
                .chars()
                .take(400)
                .collect::<String>();
            failed(format!("{CHECKER}가 비정상 종료했습니다(코드 {code}). {detail}"))
        }
    }
}

/// Guard for every path that writes runtime XML. Only an actual rejection blocks.
pub fn require(xml: &str) -> Result<(), String> {
    let verdict = check(xml);
    if verdict.rejected() {
        return Err(format!(
            "런타임이 이 XML을 거부합니다(게임에서 파일 전체가 무시됨): {}",
            verdict.summary()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn check_runtime_xml(xml: String) -> Result<Verdict, String> {
    if xml.len() > 4 * 1024 * 1024 {
        return Err("XML이 4 MB 제한을 넘었습니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || check(&xml))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    // These tests run the real checker built from the runtime sources (no stand-in).
    // Without the checker (a checkout without the runtime built beside it) these tests are skipped with a note.
    fn checker() -> Option<PathBuf> {
        let found = locate();
        if found.is_none() {
            eprintln!("skipped: build AnimationInjectorXmlCheck (runtime project) beside this repository");
        }
        found
    }
    const VALID: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="E2Check">
  <Inputs><Input id="use" key="Num0"/><Input id="next" key="Num1"/></Inputs>
  <Start input="use" press="tap" to="First"/>
  <Action id="First" clip="Animations\ComboTest\test_Attack1.hkx">
    <Transition input="next" from="0.1" until="end-0.1" buffer="true"BLEND><Row to="Second"><Check kind="blocking"/></Row></Transition>
  </Action>
  <Action id="Second" clip="Animations\ComboTest\test_Attack2.hkx"/>
</AnimationSet>"#;
    #[test]
    fn accepts_what_the_plugin_loads() {
        let Some(checker) = checker() else { return };
        let verdict = check_with(&checker, &VALID.replace("BLEND", ""));
        assert!(verdict.available && verdict.valid, "{verdict:?}");
        // A transition through a condition card goes through a selecting action the runtime makes for it (format 6).
        assert_eq!(verdict.actions, ["First", "Second", "First_Transition"]);
        assert!(verdict.errors.is_empty() && verdict.warnings.is_empty());
    }
    #[test]
    fn reports_a_file_the_plugin_would_skip() {
        // Review E-2: a blend on a transition through a condition card; the plugin skips the whole file.
        let Some(checker) = checker() else { return };
        let verdict = check_with(&checker, &VALID.replace("BLEND", r#" blend="0.3""#));
        assert!(verdict.rejected(), "{verdict:?}");
        assert!(verdict.actions.is_empty());
        assert!(
            verdict
                .summary()
                .contains("조건 카드를 거치는 전환에는 blend를 쓸 수 없습니다"),
            "{}",
            verdict.summary()
        );
        assert!(
            verdict.summary().contains("XML:") && !verdict.summary().contains("aieditor-runtime-check"),
            "{}",
            verdict.summary()
        );
    }
    #[test]
    fn rejects_broken_xml_and_removes_its_temporary_file() {
        let Some(checker) = checker() else { return };
        // A folder of its own: tests run in parallel and share the system temp folder.
        let folder = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("runtime-check-tests")
            .join(format!("{}-{:?}", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
        fs::create_dir_all(&folder).unwrap();
        let verdict = check_in(&checker, "<AnimationSet version=\"6\"", &folder);
        // pugixml failures are logged as warnings; the verdict is still a rejection with a reason.
        assert!(
            verdict.rejected() && !(verdict.errors.is_empty() && verdict.warnings.is_empty()),
            "{verdict:?}"
        );
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
        fs::remove_dir(&folder).unwrap();
    }
    #[test]
    fn missing_or_foreign_checker_never_passes_silently() {
        let missing = check_with(Path::new("C:/definitely/missing/AnimationInjectorXmlCheck.exe"), VALID);
        assert!(!missing.available && !missing.valid && !missing.problem.is_empty());
        // A program that does not speak the contract is a failure, not a pass.
        let cmd = Path::new(&std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
            .join("System32\\where.exe");
        let foreign = check_with(&cmd, VALID);
        assert!(foreign.rejected(), "{foreign:?}");
    }
}
