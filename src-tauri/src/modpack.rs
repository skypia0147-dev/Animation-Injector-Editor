use std::{
    collections::{BTreeSet, BTreeMap},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri_plugin_dialog::DialogExt;
use crate::digest::sha256;
const FILE_LIMIT: u64 = 64 * 1024 * 1024;
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Asset {
    #[serde(default = "human_root")]
    pub actor_roots: Vec<String>,
    pub clip: String,
    pub paths: Vec<String>,
    pub mode: String,
    pub dependency: String,
    pub expected_sha256: String,
}
/// A sound file a function plays (runtime 0.12.296): `file` is its path under Data, written to the same path in
/// the mod.
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sound {
    pub file: String,
    pub paths: Vec<String>,
    pub mode: String,
    pub dependency: String,
    pub expected_sha256: String,
}
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub folder: String,
    pub id: String,
    pub roots: Vec<String>,
    pub assets: Vec<Asset>,
    #[serde(default)]
    pub sounds: Vec<Sound>,
    pub plugins: Vec<String>,
    pub xml: String,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    pub size: u64,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub clip: String,
    pub status: String,
    pub message: String,
    pub candidates: Vec<Candidate>,
    pub sha256: String,
    pub size: u64,
}
#[derive(serde::Serialize)]
pub struct Plugin {
    pub name: String,
    pub found: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub assets: Vec<Row>,
    pub sounds: Vec<Row>,
    pub plugins: Vec<Plugin>,
    pub warnings: Vec<String>,
    pub ready: bool,
    pub total_bytes: u64,
    pub runtime: crate::runtime_check::Verdict,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Debug)]
pub struct Exported {
    pub path: String,
    pub files: usize,
    pub bytes: u64,
}
fn human_root() -> Vec<String> {
    vec!["meshes/actors/character".into()]
}
fn valid_actor_roots(roots: &[String]) -> bool {
    let allowed = crate::rig_roots();
    !roots.is_empty()
        && roots.len() <= allowed.len()
        && roots.iter().all(|r| allowed.contains(r))
        && roots.iter().collect::<BTreeSet<_>>().len() == roots.len()
}
fn plain(s: &str, max: usize) -> bool {
    s.len() <= max && !s.chars().any(char::is_control)
}
fn component(s: &str) -> bool {
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    !s.is_empty()
        && s.len() <= 180
        && s != "."
        && s != ".."
        && !s.ends_with(['.', ' '])
        && !s.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
        && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}
fn relative(s: &str) -> Result<PathBuf, String> {
    let normalized = s.replace('\\', "/");
    if normalized.len() > 1024
        || !normalized.to_ascii_lowercase().ends_with(".hkx")
        || !normalized.split('/').all(component)
    {
        return Err(format!("잘못된 HKX 상대 경로: {s}"));
    }
    if !crate::game_path_ok(&normalized) {
        return Err(format!("{} ({s})", crate::GAME_PATH_RULE));
    }
    Ok(normalized.split('/').collect())
}
const SOUND_EXTENSIONS: [&str; 2] = [".wav", ".xwm"];
const SOUND_PATH_RULE: &str =
    "소리 파일 경로는 영문·숫자·일반 기호만 씁니다. 한글 등은 게임이 파일을 찾지 못하니 파일·폴더 이름을 바꾸세요.";
/// A sound's path under Data, as the function names it and the mod holds it.
fn sound_path(s: &str) -> Result<PathBuf, String> {
    let normalized = s.replace('\\', "/");
    let folded = normalized.to_ascii_lowercase();
    if normalized.len() > 1024
        || !SOUND_EXTENSIONS.iter().any(|e| folded.ends_with(e))
        || !normalized.split('/').all(component)
    {
        return Err(format!("잘못된 소리 파일 경로(.wav·.xwm): {s}"));
    }
    if !crate::game_path_ok(&normalized) {
        return Err(format!("{SOUND_PATH_RULE} ({s})"));
    }
    Ok(normalized.split('/').collect())
}
/// A chosen sound file's path under Data: from its folder named `sound` (a mod's or the game's) down.
pub(crate) fn sound_relative(path: &str) -> Result<String, String> {
    local(path)?;
    let normalized = path.replace('\\', "/");
    let start = normalized
        .to_ascii_lowercase()
        .rfind("/sound/")
        .map(|offset| offset + 1)
        .ok_or("모드나 Data 폴더의 sound 폴더 아래 소리 파일을 고르세요.")?;
    let file = &normalized[start..];
    sound_path(file)?;
    Ok(file.replace('/', "\\"))
}
fn local(s: &str) -> Result<PathBuf, String> {
    let b = s.as_bytes();
    if b.len() < 3
        || !b[0].is_ascii_alphabetic()
        || b[1] != b':'
        || !matches!(b[2], b'/' | b'\\')
        || s.replace('\\', "/").split('/').any(|p| p == "..")
    {
        return Err("로컬 드라이브의 절대 경로가 필요합니다.".into());
    }
    Ok(PathBuf::from(s))
}
fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    if !m.is_file() || m.len() == 0 || m.len() > FILE_LIMIT {
        return Err("원본 파일은 0 초과~64 MB여야 합니다.".into());
    }
    let mut data = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(FILE_LIMIT + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.is_empty() || data.len() as u64 > FILE_LIMIT {
        return Err("파일 크기가 검사 중 변경되었습니다.".into());
    }
    Ok(data)
}
fn validate(r: &Request) -> Result<(), String> {
    if !component(&r.folder) || r.folder.starts_with(".aieditor-") {
        return Err("모드 폴더 이름을 확인하세요.".into());
    }
    if r.id.is_empty()
        || r.id.len() > 64
        || !r.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        || !component(&r.id)
    {
        return Err("XML 묶음 ID가 잘못되었습니다.".into());
    }
    if r.roots.len() > 12 || r.assets.is_empty() || r.assets.len() > 500 || r.plugins.len() > 200 {
        return Err("패키지 설정/크기 제한을 확인하세요.".into());
    }
    if r.xml.len() > 2_000_000 || !r.xml.trim_start().starts_with("<?xml") {
        return Err("출력 문서 크기 또는 XML 형식 오류".into());
    }
    let mut clips = BTreeSet::new();
    for a in &r.assets {
        relative(&a.clip)?;
        if !valid_actor_roots(&a.actor_roots) {
            return Err("대상 스켈레톤의 애니메이션 경로가 잘못되었습니다.".into());
        }
        if !clips.insert(a.clip.replace('\\', "/").to_lowercase())
            || a.paths.len() > 100
            || !matches!(a.mode.as_str(), "copy" | "external")
            || !plain(&a.dependency, 256)
            || a.mode == "external" && a.dependency.trim().is_empty()
        {
            return Err("자산 중복 또는 외부 공급 모드 설정 오류".into());
        }
    }
    if r.sounds.len() > 500 {
        return Err("패키지 설정/크기 제한을 확인하세요.".into());
    }
    let mut files = BTreeSet::new();
    for s in &r.sounds {
        sound_path(&s.file)?;
        if !files.insert(s.file.replace('\\', "/").to_lowercase())
            || s.paths.len() > 100
            || !matches!(s.mode.as_str(), "copy" | "external")
            || !plain(&s.dependency, 256)
            || s.mode == "external" && s.dependency.trim().is_empty()
        {
            return Err("자산 중복 또는 외부 공급 모드 설정 오류".into());
        }
    }
    for p in &r.plugins {
        if !component(p)
            || ![".esp", ".esm", ".esl"]
                .iter()
                .any(|e| p.to_ascii_lowercase().ends_with(e))
        {
            return Err("의존 플러그인 파일명이 잘못되었습니다.".into());
        }
    }
    Ok(())
}
fn roots(request: &Request, warnings: &mut Vec<String>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for raw in &request.roots {
        match local(raw) {
            Ok(p) if p.is_dir() => {
                dirs.push(p.clone());
                match fs::read_dir(&p) {
                    Ok(children) => {
                        for child in children.flatten() {
                            if child.file_type().is_ok_and(|t| t.is_dir()) {
                                dirs.push(child.path());
                                if dirs.len() > 5000 {
                                    warnings.push("검색 폴더가 너무 큽니다. 개별 모드 폴더를 선택하세요.".into());
                                    return dirs;
                                }
                            }
                        }
                    }
                    Err(e) => warnings.push(format!("검색 폴더 열람 실패: {raw}: {e}")),
                }
            }
            _ => warnings.push(format!("검색 폴더 접근 불가: {raw}")),
        }
    }
    dirs.sort();
    dirs.dedup();
    dirs
}
/// One file's source: the chosen paths (each must `fit` the file's path) or, without any, what `search` finds in
/// the search folders. One readable source is ready; none, several or a wrong choice is not.
#[allow(clippy::too_many_arguments)]
fn locate(
    label: &str,
    mode: &str,
    dependency: &str,
    paths: &[String],
    search: impl Fn(&PathBuf) -> Option<PathBuf>,
    fits: impl Fn(&str) -> bool,
    dirs: &[PathBuf],
    ready: &str,
) -> Result<Row, String> {
    let mut row = Row {
        clip: label.into(),
        status: "missing".into(),
        message: String::new(),
        candidates: vec![],
        sha256: String::new(),
        size: 0,
    };
    if mode == "external" {
        row.status = "external".into();
        row.message = format!("외부 모드 필요: {}", dependency);
        return Ok(row);
    }
    let mut candidates = BTreeMap::new();
    let explicit = !paths.is_empty();
    let raw: Vec<PathBuf> = if explicit {
        paths.iter().map(|p| local(p)).collect::<Result<_, _>>()?
    } else {
        dirs.iter().filter_map(&search).collect()
    };
    let mut invalid = 0;
    for p in raw {
        if p.is_file() {
            if !explicit || fits(&p.to_string_lossy()) {
                if let Ok(canonical) = fs::canonicalize(&p) {
                    let key = canonical.to_string_lossy().to_lowercase();
                    candidates.entry(key).or_insert(Candidate {
                        path: p.to_string_lossy().into_owned(),
                        size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
                    });
                }
            } else {
                invalid += 1;
            }
        } else if explicit {
            invalid += 1;
        }
    }
    row.candidates = candidates.into_values().collect();
    if invalid > 0 {
        row.status = "invalid".into();
        row.message = "지정했던 원본이 없거나 XML 경로와 다릅니다. 다시 선택하세요.".into();
    } else if row.candidates.len() > 1 {
        row.status = "ambiguous".into();
        row.message = "같은 목적지에 여러 원본 후보가 있습니다. 사용할 파일을 선택하세요.".into();
    } else if let Some(c) = row.candidates.first() {
        match read_bounded(Path::new(&c.path)) {
            Ok(data) => {
                row.status = "ready".into();
                row.size = data.len() as u64;
                row.sha256 = sha256(&data);
                row.message = ready.into();
            }
            Err(e) => {
                row.status = "invalid".into();
                row.message = e;
            }
        }
    } else {
        row.message = "파일을 찾지 못했습니다. 원본 선택 또는 외부 공급 모드를 지정하세요.".into();
    }
    Ok(row)
}
pub fn inspect(r: &Request) -> Result<Report, String> {
    validate(r)?;
    let mut warnings = Vec::new();
    let dirs = roots(r, &mut warnings);
    let mut rows = Vec::new();
    let mut total = 0;
    for a in &r.assets {
        let relative = relative(&a.clip)?;
        let row = locate(
            &a.clip,
            &a.mode,
            &a.dependency,
            &a.paths,
            |root| {
                a.actor_roots
                    .iter()
                    .map(|actor| root.join(actor).join(&relative))
                    .find(|p| p.is_file())
            },
            |text| {
                crate::hkx_relative(text).is_ok_and(|clip| {
                    clip.replace('\\', "/").to_lowercase() == a.clip.replace('\\', "/").to_lowercase()
                })
            },
            &dirs,
            "복사 준비 완료 · HKX 내용/주석 미검사",
        )?;
        total += row.size * a.actor_roots.len() as u64;
        rows.push(row);
    }
    let mut sounds = Vec::new();
    for s in &r.sounds {
        let relative = sound_path(&s.file)?;
        let tail = format!("/{}", s.file.replace('\\', "/").to_lowercase());
        let row = locate(
            &s.file,
            &s.mode,
            &s.dependency,
            &s.paths,
            |root| Some(root.join(&relative)).filter(|p| p.is_file()),
            // A chosen file is at the function's path below some folder (a mod's or Data).
            |text| text.replace('\\', "/").to_lowercase().ends_with(&tail),
            &dirs,
            "복사 준비 완료",
        )?;
        total += row.size;
        sounds.push(row);
    }
    let plugins = r
        .plugins
        .iter()
        .map(|name| Plugin {
            name: name.clone(),
            found: dirs.iter().any(|d| d.join(name).is_file()),
        })
        .collect();
    let ready = warnings.is_empty()
        && rows
            .iter()
            .chain(&sounds)
            .all(|r| r.status == "ready" || r.status == "external")
        && total <= 2 * 1024 * 1024 * 1024;
    if total > 2 * 1024 * 1024 * 1024 {
        warnings.push("전체 자산은 2 GB 이하여야 합니다.".into());
    }
    Ok(Report {
        assets: rows,
        sounds,
        plugins,
        warnings,
        ready,
        total_bytes: total,
        runtime: Default::default(),
    })
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(bytes).and_then(|_| f.sync_all()).map_err(|e| e.to_string())
}
#[derive(serde::Serialize)]
struct Entry {
    path: String,
    bytes: usize,
    sha256: String,
}
pub fn export_to(r: &Request, parent: &Path) -> Result<Exported, String> {
    let report = inspect(r)?;
    if !report.ready {
        return Err("자산 검사를 완료하세요. 누락·중복·잘못된 원본이 있습니다.".into());
    }
    for (a, row) in r.assets.iter().zip(&report.assets) {
        if a.mode == "copy" && (a.expected_sha256.is_empty() || !a.expected_sha256.eq_ignore_ascii_case(&row.sha256)) {
            return Err(format!(
                "{}: 마지막 검사 이후 원본이 변경되었습니다. 다시 검사하세요.",
                a.clip
            ));
        }
    }
    for (s, row) in r.sounds.iter().zip(&report.sounds) {
        if s.mode == "copy" && (s.expected_sha256.is_empty() || !s.expected_sha256.eq_ignore_ascii_case(&row.sha256)) {
            return Err(format!(
                "{}: 마지막 검사 이후 원본이 변경되었습니다. 다시 검사하세요.",
                s.file
            ));
        }
    }
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if !parent.is_dir() {
        return Err("출력 부모 폴더가 필요합니다.".into());
    }
    let target = parent.join(&r.folder);
    if target.try_exists().map_err(|e| e.to_string())? {
        return Err("같은 이름의 폴더가 이미 있습니다. 새 이름을 사용하세요. 기존 파일은 변경하지 않았습니다.".into());
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let stage = parent.join(format!(".aieditor-package-{}-{nonce}", std::process::id()));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut entries = Vec::new();
        let mut add = |path: String, data: &[u8]| -> Result<(), String> {
            write_new(&stage.join(path.replace('/', "\\")), data)?;
            entries.push(Entry {
                path,
                bytes: data.len(),
                sha256: sha256(data),
            });
            Ok(())
        };
        add(
            format!("SKSE/Plugins/AnimationInjector/{0}/{0}.xml", r.folder),
            r.xml.as_bytes(),
        )?;
        for (a, row) in r.assets.iter().zip(&report.assets) {
            if a.mode != "copy" {
                continue;
            }
            let data = read_bounded(Path::new(&row.candidates[0].path))?;
            if sha256(&data) != row.sha256 {
                return Err(format!("{}: 복사 도중 원본 변경 감지", a.clip));
            }
            for actor_root in &a.actor_roots {
                add(format!("{}/{}", actor_root, a.clip.replace('\\', "/")), &data)?;
            }
        }
        for (s, row) in r.sounds.iter().zip(&report.sounds) {
            if s.mode != "copy" {
                continue;
            }
            let data = read_bounded(Path::new(&row.candidates[0].path))?;
            if sha256(&data) != row.sha256 {
                return Err(format!("{}: 복사 도중 원본 변경 감지", s.file));
            }
            add(s.file.replace('\\', "/"), &data)?;
        }
        if target.try_exists().map_err(|e| e.to_string())? {
            return Err("출력 중 같은 이름의 폴더가 생성되었습니다.".into());
        }
        fs::rename(&stage, &target)
            .map_err(|e| format!("모드 폴더 확정 실패: {e}. 출력 폴더를 사용하는 프로그램을 닫고 새로 출력하세요."))?;
        Ok(Exported {
            path: target
                .to_string_lossy()
                .strip_prefix(r"\\?\")
                .unwrap_or(&target.to_string_lossy())
                .to_string(),
            files: entries.len(),
            bytes: entries.iter().map(|e| e.bytes as u64).sum::<u64>(),
        })
    })();
    if result.is_err()
        && stage.parent() == Some(parent.as_path())
        && stage
            .file_name()
            .is_some_and(|s| s.to_string_lossy().starts_with(".aieditor-package-"))
        && fs::symlink_metadata(&stage).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
    {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}
#[tauri::command]
pub async fn pick_asset_root(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(p) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let p = p.into_path().map_err(|e| e.to_string())?;
        local(&p.to_string_lossy())?;
        Ok(Some(p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(serde::Serialize)]
pub struct PickedSound {
    pub path: String,
    pub file: String,
}
/// The sound files a mod folder holds (`<root>\sound\…`, .wav·.xwm): a mod's sounds may be played by its plugin's
/// sound descriptors from HKX SoundPlay annotations, which the XML never names. Bounded walk; names the game cannot
/// find (not ASCII) are left out.
pub fn sounds_in(root: &str) -> Result<Vec<PickedSound>, String> {
    let mut dirs = vec![local(root)?.join("sound")];
    let mut found = Vec::new();
    let mut seen = 0;
    while let Some(dir) = dirs.pop() {
        let Ok(children) = fs::read_dir(&dir) else {
            continue;
        };
        for child in children.flatten() {
            seen += 1;
            if seen > 20_000 || found.len() >= 500 {
                return Ok(found);
            }
            let path = child.path();
            match child.file_type() {
                Ok(t) if t.is_dir() => dirs.push(path),
                Ok(t) if t.is_file() => {
                    let text = path.to_string_lossy().into_owned();
                    if let Ok(file) = sound_relative(&text) {
                        found.push(PickedSound { path: text, file });
                    }
                }
                _ => {}
            }
        }
    }
    found.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    Ok(found)
}
/// A sound file's bytes for the editor's preview. Only .wav: the webview cannot decode xWMA.
#[tauri::command]
pub async fn sound_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = local(&path)?;
        if !path.to_ascii_lowercase().ends_with(".wav") {
            return Err("미리듣기는 .wav 파일만 됩니다.".into());
        }
        read_bounded(&file).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn mod_sounds(root: String) -> Result<Vec<PickedSound>, String> {
    tauri::async_runtime::spawn_blocking(move || sounds_in(&root))
        .await
        .map_err(|e| e.to_string())?
}
/// A sound file for a function: its local path, and its path under Data that the function plays and the mod holds.
#[tauri::command]
pub async fn pick_sound(app: tauri::AppHandle) -> Result<Option<PickedSound>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Sound", &["wav", "xwm"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let text = path.to_string_lossy().into_owned();
        let relative = sound_relative(&text)?;
        if !fs::metadata(&path).map_err(|e| e.to_string())?.is_file() {
            return Err("파일이 아닙니다.".into());
        }
        Ok(Some(PickedSound {
            path: text,
            file: relative,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Asset inspection plus the plugin's own verdict on the XML this package would install.
fn probe(request: &Request) -> Result<Report, String> {
    let mut report = inspect(request)?;
    report.runtime = crate::runtime_check::check(&request.xml);
    if report.runtime.rejected() {
        report.ready = false;
    }
    Ok(report)
}
#[tauri::command]
pub async fn probe_package(request: Request) -> Result<Report, String> {
    tauri::async_runtime::spawn_blocking(move || probe(&request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn export_mod(app: tauri::AppHandle, request: Request) -> Result<Option<Exported>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate(&request)?;
        crate::runtime_check::require(&request.xml)?;
        let Some(p) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = p.into_path().map_err(|e| e.to_string())?;
        local(&path.to_string_lossy())?;
        export_to(&request, &path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cross_species_exports_both_actor_paths_with_identical_bytes() {
        let t = Temp::new();
        let source = t.asset("Source");
        let mut r = request();
        r.assets[0].paths.push(source.to_string_lossy().into_owned());
        r.assets[0].actor_roots.push("meshes/actors/ambient/chicken".into());
        ready(&mut r);
        let output = export_to(&r, &t.0).unwrap();
        assert_eq!(output.files, 3);
        for actor in &r.assets[0].actor_roots {
            assert_eq!(
                fs::read(Path::new(&output.path).join(actor).join("Animations/Test Clip+1.hkx")).unwrap(),
                fs::read(&source).unwrap()
            );
        }
    }
    #[test]
    fn creature_root_validation_blocks_unknown_escape_and_duplicates() {
        for roots in [
            vec!["meshes/actors/unknown".into()],
            vec!["../escape".into()],
            vec!["C:/outside".into()],
            vec!["meshes/actors/character".into(); 2],
            vec![],
        ] {
            let mut r = request();
            r.assets[0].actor_roots = roots;
            assert!(inspect(&r).is_err());
        }
        let allowed: Vec<String> = serde_json::from_str(include_str!("paired_rigs.json")).unwrap();
        assert!(valid_actor_roots(&allowed));
    }
    #[test]
    fn paired_root_search_chooses_one_copy_within_a_mod() {
        let t = Temp::new();
        let source = t.asset("Source");
        let mut r = request();
        r.roots.push(t.0.to_string_lossy().into_owned());
        r.assets[0].actor_roots.push("meshes/actors/ambient/chicken".into());
        let target =
            t.0.join("Source/meshes/actors/ambient/chicken/Animations/Test Clip+1.hkx");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::copy(&source, &target).unwrap();
        let result = inspect(&r).unwrap();
        assert!(result.ready);
        assert_eq!(result.assets[0].candidates.len(), 1);
    }
    #[test]
    fn first_person_copy_is_its_own_asset_under_1stperson() {
        // The editor asks for a first-person copy as the clip _1stPerson\<clip> (src/view.ts): found in a
        // searched mod's _1stperson folder or chosen there, and written next to the third-person file.
        let t = Temp::new();
        let third = t.asset("Source");
        let first =
            t.0.join("Source/meshes/actors/character/_1stperson/Animations/Test Clip+1.hkx");
        fs::create_dir_all(first.parent().unwrap()).unwrap();
        fs::write(&first, b"first-person bytes").unwrap();
        let mut r = request();
        r.roots.push(t.0.to_string_lossy().into_owned());
        let mut copy = r.assets[0].clone();
        copy.clip = "_1stPerson\\Animations\\Test Clip+1.hkx".into();
        r.assets.push(copy);
        let found = inspect(&r).unwrap();
        assert!(found.ready);
        assert_eq!(found.assets[1].candidates.len(), 1);
        r.assets[1].paths = vec![first.to_string_lossy().into_owned()];
        ready(&mut r);
        let output = export_to(&r, &t.0).unwrap();
        let root = Path::new(&output.path).join("meshes/actors/character");
        assert_eq!(
            fs::read(root.join("Animations/Test Clip+1.hkx")).unwrap(),
            fs::read(&third).unwrap()
        );
        assert_eq!(
            fs::read(root.join("_1stPerson/Animations/Test Clip+1.hkx")).unwrap(),
            b"first-person bytes"
        );
        // A third-person file chosen for the copy is not at its path.
        r.assets[1].paths = vec![third.to_string_lossy().into_owned()];
        assert_eq!(inspect(&r).unwrap().assets[1].status, "invalid");
    }
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/pack-tests");
            fs::create_dir_all(&base).unwrap();
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let p = base.join(format!("test-{}-{stamp}", std::process::id()));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
        fn asset(&self, mod_name: &str) -> PathBuf {
            let p = self
                .0
                .join(mod_name)
                .join("meshes/actors/character/Animations/Test Clip+1.hkx");
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, b"test asset bytes").unwrap();
            p
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/pack-tests");
            if self.0.parent() == Some(base.as_path())
                && self.0.file_name().unwrap().to_string_lossy().starts_with("test-")
            {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }
    fn request() -> Request {
        Request {
            folder: "테스트 Mod".into(),
            id: "TestSet".into(),
            roots: vec![],
            assets: vec![Asset {
                actor_roots: human_root(),
                clip: "Animations\\Test Clip+1.hkx".into(),
                paths: vec![],
                mode: "copy".into(),
                dependency: "".into(),
                expected_sha256: "".into(),
            }],
            sounds: vec![],
            plugins: vec![],
            xml: "<?xml version=\"1.0\"?><AnimationSet/>".into(),
        }
    }
    fn ready(r: &mut Request) {
        let report = inspect(r).unwrap();
        assert!(report.ready);
        for (a, row) in r.assets.iter_mut().zip(report.assets) {
            a.expected_sha256 = row.sha256;
        }
        for (s, row) in r.sounds.iter_mut().zip(report.sounds) {
            s.expected_sha256 = row.sha256;
        }
    }
    fn sound(file: &str) -> Sound {
        Sound {
            file: file.into(),
            paths: vec![],
            mode: "copy".into(),
            dependency: "".into(),
            expected_sha256: "".into(),
        }
    }
    #[test]
    fn sounds_are_found_or_chosen_and_written_at_their_data_path() {
        let t = Temp::new();
        let mut r = request();
        r.assets[0].paths.push(t.asset("Source").to_string_lossy().into_owned());
        r.roots.push(t.0.to_string_lossy().into_owned());
        r.sounds.push(sound("sound\\fx\\MyMod\\whoosh.wav"));
        assert_eq!(inspect(&r).unwrap().sounds[0].status, "missing");
        let found = t.0.join("Source/sound/fx/MyMod/whoosh.wav");
        fs::create_dir_all(found.parent().unwrap()).unwrap();
        fs::write(&found, b"RIFF sound").unwrap();
        assert_eq!(inspect(&r).unwrap().sounds[0].status, "ready");
        // A file chosen elsewhere must sit at the function's path.
        let other = t.0.join("Elsewhere/sound/fx/other.wav");
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::write(&other, b"other").unwrap();
        r.sounds[0].paths = vec![other.to_string_lossy().into_owned()];
        assert_eq!(inspect(&r).unwrap().sounds[0].status, "invalid");
        r.sounds[0].paths = vec![found.to_string_lossy().into_owned()];
        ready(&mut r);
        let output = export_to(&r, &t.0).unwrap();
        assert_eq!(output.files, 3);
        assert_eq!(
            fs::read(Path::new(&output.path).join("sound/fx/MyMod/whoosh.wav")).unwrap(),
            b"RIFF sound"
        );
        // A game or other mod's sound is a requirement, not copied.
        let mut r = request();
        r.assets[0].mode = "external".into();
        r.assets[0].dependency = "Base".into();
        r.sounds.push(sound("sound/fx/vanilla.wav"));
        r.sounds[0].mode = "external".into();
        assert!(inspect(&r).is_err());
        r.sounds[0].dependency = "Skyrim".into();
        assert!(inspect(&r).unwrap().ready);
        let output = export_to(&r, &Temp::new().0).unwrap();
        assert_eq!(output.files, 1);
    }
    #[test]
    fn a_mod_folder_lists_its_sound_files() {
        let t = Temp::new();
        let m = t.0.join("My Mod");
        for f in [
            "Sound/FX/FST/a.wav",
            "Sound/FX/b.xwm",
            "Sound/FX/c.txt",
            "Sound/FX/한글.wav",
            "meshes/d.wav",
        ] {
            let p = m.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, b"x").unwrap();
        }
        let found = sounds_in(&m.to_string_lossy()).unwrap();
        let files: Vec<_> = found.iter().map(|s| s.file.replace('/', "\\")).collect();
        assert_eq!(files, ["sound\\FX\\b.xwm", "sound\\FX\\FST\\a.wav"]);
        assert!(found.iter().all(|s| Path::new(&s.path).is_file()));
        assert!(sounds_in(&t.0.join("none").to_string_lossy()).unwrap().is_empty());
        // The mod that reported the problem (10-26), when AIE_SOUND_MOD names its folder on this computer.
        if let Some(real) = std::env::var_os("AIE_SOUND_MOD").filter(|p| Path::new(p).is_dir()) {
            assert!(!sounds_in(&real.to_string_lossy()).unwrap().is_empty());
        }
    }
    #[test]
    fn sound_paths_are_data_relative_ascii_sound_files() {
        for bad in [
            "C:/sound/a.wav",
            "../a.wav",
            "sound/a.mp3",
            "sound/한글.wav",
            "sound//a.wav",
            "sound/CON.wav",
        ] {
            let mut r = request();
            r.sounds.push(sound(bad));
            assert!(inspect(&r).is_err(), "{bad}");
        }
        let mut r = request();
        r.sounds.push(sound("sound/a.wav"));
        r.sounds.push(sound("Sound\\A.WAV"));
        assert!(inspect(&r).is_err());
        assert_eq!(
            sound_relative("H:\\Mods\\내 모드\\Sound\\FX\\a.xwm").unwrap(),
            "Sound\\FX\\a.xwm"
        );
        assert!(sound_relative("H:\\Mods\\a.wav").is_err());
        assert!(sound_relative("sound\\a.wav").is_err());
    }
    #[test]
    fn detects_missing_ambiguous_and_explicit_selection() {
        let t = Temp::new();
        let mut r = request();
        r.roots.push(t.0.to_string_lossy().into_owned());
        assert_eq!(inspect(&r).unwrap().assets[0].status, "missing");
        let first = t.asset("Mod A");
        assert_eq!(inspect(&r).unwrap().assets[0].status, "ready");
        let second = t.asset("Mod B");
        assert_eq!(inspect(&r).unwrap().assets[0].status, "ambiguous");
        r.assets[0].paths = vec![
            first.to_string_lossy().into_owned(),
            second.to_string_lossy().into_owned(),
        ];
        assert_eq!(inspect(&r).unwrap().assets[0].status, "ambiguous");
        r.assets[0].paths.pop();
        assert!(inspect(&r).unwrap().ready);
        r.assets[0].clip = "Animations/other.hkx".into();
        assert_eq!(inspect(&r).unwrap().assets[0].status, "invalid");
    }
    #[test]
    fn exports_unicode_assets_and_rejects_existing_directory() {
        let t = Temp::new();
        let source = t.asset("Source");
        let mut r = request();
        r.assets[0].paths.push(source.to_string_lossy().into_owned());
        ready(&mut r);
        let output = export_to(&r, &t.0).unwrap();
        let copied = Path::new(&output.path).join("meshes/actors/character/Animations/Test Clip+1.hkx");
        assert_eq!(fs::read(&copied).unwrap(), fs::read(&source).unwrap());
        let root = Path::new(&output.path);
        assert_eq!(
            fs::read_to_string(root.join(format!("SKSE/Plugins/AnimationInjector/{0}/{0}.xml", r.folder))).unwrap(),
            r.xml
        );
        assert!(!root.join("SKSE/Plugins/AnimationInjector/TestSet").exists());
        let mut files = Vec::new();
        let mut dirs = vec![root.to_path_buf()];
        while let Some(dir) = dirs.pop() {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    dirs.push(path);
                } else {
                    files.push(path);
                }
            }
        }
        // A package is its XML and HKX files only: no README, license or project.
        assert_eq!(files.len(), 2);
        assert_eq!(output.files, 2);
        assert_eq!(output.bytes, r.xml.len() as u64 + fs::metadata(&source).unwrap().len());
        assert!(files
            .iter()
            .all(|p| matches!(p.extension().and_then(|s| s.to_str()), Some("xml" | "hkx"))));
        assert!(export_to(&r, &t.0).is_err());
        assert_eq!(fs::read(&copied).unwrap(), b"test asset bytes");
        assert!(!fs::read_dir(&t.0)
            .unwrap()
            .flatten()
            .any(|p| p.file_name().to_string_lossy().starts_with(".aieditor-")));
    }
    #[test]
    fn changed_or_deleted_source_never_creates_partial_output() {
        let t = Temp::new();
        let source = t.asset("Source");
        let mut r = request();
        r.assets[0].paths.push(source.to_string_lossy().into_owned());
        ready(&mut r);
        fs::write(&source, b"changed").unwrap();
        assert!(export_to(&r, &t.0).unwrap_err().contains("변경"));
        assert!(!t.0.join(&r.folder).exists());
        ready(&mut r);
        fs::remove_file(&source).unwrap();
        assert!(export_to(&r, &t.0).is_err());
        assert_eq!(fs::read_dir(&t.0).unwrap().count(), 1);
    }
    #[test]
    fn runtime_rejection_blocks_readiness_with_the_real_checker() {
        // Runs the plugin parser (AnimationInjectorXmlCheck); a file it would skip is never "ready". Skipped without it.
        if crate::runtime_check::locate().is_none() {
            eprintln!("skipped: AnimationInjectorXmlCheck not found");
            return;
        }
        let mut r = request();
        r.assets[0].mode = "external".into();
        r.assets[0].dependency = "Base".into();
        let xml = |blend: &str| {
            format!(
                r#"<?xml version="1.0" encoding="utf-8"?><AnimationSet version="6" id="E2"><Inputs><Input id="use" key="Num0"/><Input id="next" key="Num1"/></Inputs><Start input="use" to="First"/><Action id="First" clip="Animations\A.hkx"><Transition input="next" from="0.1" until="end-0.1"{blend}><Row to="Second"><Check kind="blocking"/></Row></Transition></Action><Action id="Second" clip="Animations\B.hkx"/></AnimationSet>"#
            )
        };
        r.xml = xml("");
        let report = probe(&r).unwrap();
        assert!(
            report.runtime.available && report.runtime.valid && report.ready,
            "{:?}",
            report.runtime
        );
        r.xml = xml(r#" blend="0.3""#);
        let report = probe(&r).unwrap();
        assert!(report.runtime.rejected() && !report.ready, "{:?}", report.runtime);
        assert!(crate::runtime_check::require(&r.xml).is_err());
    }
    #[test]
    fn external_files_and_plugins_are_requirements_not_copied() {
        let t = Temp::new();
        let mut r = request();
        r.assets[0].mode = "external".into();
        assert!(inspect(&r).is_err());
        r.assets[0].dependency = "Base Animations".into();
        r.plugins.push("Required.esp".into());
        let report = inspect(&r).unwrap();
        assert!(report.ready);
        assert!(!report.plugins[0].found);
        let output = export_to(&r, &t.0).unwrap();
        assert!(!Path::new(&output.path).join("meshes").exists());
        assert_eq!(output.files, 1);
        assert!(!Path::new(&output.path).join("dependencies.json").exists());
    }
    #[test]
    fn path_traversal_reserved_names_and_duplicate_destinations_are_rejected() {
        let mut r = request();
        for bad in [
            "../escape.hkx",
            "C:/x.hkx",
            "Animations/CON.hkx",
            "Animations/x:stream.hkx",
            "Animations//x.hkx",
            "Animations/x. /x.hkx",
            "Animations/잡기/x.hkx",
            "Animations/한글.hkx",
            "Animations/a?.hkx",
        ] {
            r.assets[0].clip = bad.into();
            assert!(inspect(&r).is_err(), "{bad}");
        }
        r = request();
        for name in ["../outside", "CON", "LPT1.txt", "bad.", "bad ", ".aieditor-owned"] {
            r.folder = name.into();
            assert!(inspect(&r).is_err());
        }
        r = request();
        r.assets.push(r.assets[0].clone());
        assert!(inspect(&r).is_err());
    }
    #[test]
    fn a_request_carrying_documents_is_refused() {
        // The editor no longer sends README, license, author or version (2026-09-30).
        let mut json = request_json();
        assert!(serde_json::from_value::<Request>(json.clone()).is_ok());
        for field in ["readmeKo", "readmeEn", "license", "author", "version", "project"] {
            json[field] = serde_json::json!("x");
            assert!(serde_json::from_value::<Request>(json.clone()).is_err(), "{field}");
            json.as_object_mut().unwrap().remove(field);
        }
    }
    fn request_json() -> serde_json::Value {
        let r = request();
        serde_json::json!({
            "folder": r.folder, "id": r.id, "roots": r.roots, "plugins": r.plugins, "xml": r.xml,
            "assets": [{"actorRoots": r.assets[0].actor_roots, "clip": r.assets[0].clip, "paths": [],
                        "mode": "copy", "dependency": "", "expectedSha256": ""}]
        })
    }
    #[test]
    #[ignore]
    fn export_user_fixture() {
        let path = std::env::var("S5_PACKAGE_REQUEST").expect("explicit fixture path required");
        let parent = std::env::var("S5_PACKAGE_PARENT").expect("explicit output parent required");
        let r: Request = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let result = export_to(&r, Path::new(&parent)).unwrap();
        println!("Exported: {} ({} files)", result.path, result.files);
    }
}
