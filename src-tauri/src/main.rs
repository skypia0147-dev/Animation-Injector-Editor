#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod digest;
mod hkx;
mod ipc_binary;
mod modpack;
mod runtime_check;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
struct Document {
    name: String,
    path: String,
    contents: String,
    /// SHA-256 of the bytes read: Save compares it with the file on disk before writing over it.
    stamp: String,
}

/// A written document and the stamp of what is now on disk.
#[derive(serde::Serialize)]
struct Saved {
    path: String,
    stamp: String,
}

/// The error Save returns when the file changed on disk since it was opened or last saved. The editor asks
/// whether to write over it instead of losing the other edit.
const CHANGED_ON_DISK: &str = "changed-on-disk";

#[derive(serde::Serialize)]
struct HkxAsset {
    path: String,
    clip: String,
}
#[derive(serde::Serialize)]
struct HkxResolved {
    path: String,
    clip: String,
    error: String,
}
#[derive(serde::Deserialize)]
struct AssetRequest {
    id: String,
    path: String,
    clip: String,
}
#[derive(serde::Serialize)]
struct AssetResult {
    id: String,
    message: String,
}

#[derive(serde::Serialize)]
struct SearchRoots {
    roots: Vec<String>,
    rejected: Vec<String>,
}

fn search_roots(paths: Vec<String>) -> Result<SearchRoots, String> {
    if paths.len() > 200 {
        return Err("At most 200 paths may be dropped at once.".into());
    }
    let mut result = SearchRoots {
        roots: Vec::new(),
        rejected: Vec::new(),
    };
    for path in paths {
        // Match the local-drive policy of the existing mod packager. Do not recursively scan on drop.
        let normalized = path.replace('\\', "/");
        let bytes = normalized.as_bytes();
        let local = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
        if !local || normalized.split('/').any(|p| p == "..") || !Path::new(&path).is_dir() {
            result.rejected.push(path);
            continue;
        }
        let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
        let text = canonical.display().to_string();
        let clean = text.strip_prefix("\\\\?\\").unwrap_or(&text).to_string();
        let local_bytes = clean.as_bytes();
        if local_bytes.len() < 3 || !local_bytes[0].is_ascii_alphabetic() || local_bytes[1] != b':' {
            result.rejected.push(path);
            continue;
        }
        if !result.roots.iter().any(|p| p.eq_ignore_ascii_case(&clean)) {
            result.roots.push(clean);
        }
    }
    Ok(result)
}

#[tauri::command]
async fn resolve_search_roots(paths: Vec<String>) -> Result<SearchRoots, String> {
    tauri::async_runtime::spawn_blocking(move || search_roots(paths))
        .await
        .map_err(|e| e.to_string())?
}

const DOCUMENT_LIMIT: u64 = 4 * 1024 * 1024;

/// A path under the game's Data folder that the engine can open: printable ASCII (letters, digits and the
/// symbols Windows allows in names). The engine reads animation files through narrow code-page paths, so a
/// Korean name is never found; the runtime's declaration check (XmlV2 clip) applies the same rule.
pub(crate) fn game_path_ok(path: &str) -> bool {
    path.bytes()
        .all(|b| (0x20..=0x7e).contains(&b) && !b"*?\"<>|".contains(&b))
}
/// The actor folders of the supported rigs (generated with the runtime's rig catalog), parsed once.
pub(crate) fn rig_roots() -> &'static [String] {
    static ROOTS: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!("paired_rigs.json")).expect("generated rig roots")
    });
    &ROOTS
}
pub(crate) const GAME_PATH_RULE: &str =
    "HKX 경로(캐릭터 폴더 아래)는 영문·숫자·일반 기호만 씁니다. 한글 등은 게임이 파일을 찾지 못하니 파일·폴더 이름을 바꾸세요.";
// The editor's documents: runtime XML (the project rides in its editor block) and templates. The .aiproj file was
// retired on 10-03 and is neither opened nor written.
const DOCUMENT_EXTENSIONS: [&str; 2] = ["xml", "aitemplate"];

fn hkx_relative(path: &str) -> Result<String, String> {
    let normalized = path.replace('\\', "/");
    let bytes = normalized.as_bytes();
    if bytes.len() < 4
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || bytes[2] != b'/'
        || normalized.split('/').any(|p| p == "..")
    {
        return Err("로컬 드라이브의 절대 경로가 필요합니다.".into());
    }
    let folded = normalized.to_ascii_lowercase();
    let start = rig_roots()
        .iter()
        .find_map(|root| {
            let anchor = format!("/{root}/");
            folded.rfind(&anchor).map(|offset| offset + anchor.len())
        })
        .ok_or("지원하는 인간·크리쳐의 meshes/actors 경로 아래 HKX를 선택하세요.")?;
    let clip = &normalized[start..];
    if !folded.ends_with(".hkx") || clip.is_empty() || clip.len() > 1024 || clip.split('/').any(|p| p.is_empty()) {
        return Err("유효한 상대 HKX 경로가 아닙니다.".into());
    }
    // Only the part the game reads (below the actors folder) must be ASCII; the mod folder above it may not be.
    if !game_path_ok(clip) {
        return Err(format!("{GAME_PATH_RULE} ({clip})"));
    }
    Ok(clip.replace('/', "\\"))
}

fn document_extension_ok(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| DOCUMENT_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

/// A document's text: UTF-8 (with or without a byte order mark) or UTF-16 with its mark, which the
/// runtime's XML parser also reads (code review E-9).
fn decode_text(bytes: &[u8]) -> Result<String, String> {
    let utf16 = |little: bool| -> Result<String, String> {
        if bytes.len() % 2 != 0 {
            return Err("UTF-16 파일의 길이가 올바르지 않습니다.".into());
        }
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|p| {
                if little {
                    u16::from_le_bytes([p[0], p[1]])
                } else {
                    u16::from_be_bytes([p[0], p[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| "UTF-16 문서에 잘못된 문자가 있습니다.".into())
    };
    match bytes {
        [0xFF, 0xFE, ..] => utf16(true),
        [0xFE, 0xFF, ..] => utf16(false),
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8(rest.to_vec()).map_err(|e| e.to_string()),
        _ => String::from_utf8(bytes.to_vec()).map_err(|_| "UTF-8 또는 UTF-16(BOM 포함) 문서만 열 수 있습니다.".into()),
    }
}

fn read_document_at(path: &Path) -> Result<Document, String> {
    if !document_extension_ok(path) {
        return Err("XML 또는 템플릿(.aitemplate) 파일만 열 수 있습니다.".into());
    }
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아닙니다.".into());
    }
    if meta.len() > DOCUMENT_LIMIT {
        return Err("파일이 4 MB 제한을 넘었습니다.".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let contents = decode_text(&bytes)?;
    Ok(Document {
        name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: path.display().to_string(),
        contents,
        stamp: digest::sha256(&bytes),
    })
}

#[tauri::command]
async fn pick_hkx(app: tauri::AppHandle) -> Result<Option<HkxAsset>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Havok animation", &["hkx"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let path_text = path.to_string_lossy().into_owned();
        let clip = hkx_relative(&path_text)?;
        if !fs::metadata(&path).map_err(|e| e.to_string())?.is_file() {
            return Err("파일이 아닙니다.".into());
        }
        Ok(Some(HkxAsset { path: path_text, clip }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dropped HKX files: resolve each to its relative clip path without touching the files.
#[tauri::command]
async fn resolve_hkx(paths: Vec<String>) -> Result<Vec<HkxResolved>, String> {
    if paths.len() > 200 {
        return Err("한 번에 200개까지 등록합니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                let (clip, error) = match hkx_relative(&path) {
                    Ok(clip) => match fs::metadata(&path) {
                        Ok(m) if m.is_file() => (clip, String::new()),
                        _ => (String::new(), "파일 없음 또는 접근 불가".to_string()),
                    },
                    Err(e) => (String::new(), e),
                };
                HkxResolved { path, clip, error }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Whether each path is a file now: a source path remembered on this computer may point into a mod folder that was
/// renamed or moved since (the editor then finds the HKX beside the XML again).
#[tauri::command]
async fn files_exist(paths: Vec<String>) -> Result<Vec<bool>, String> {
    if paths.len() > 200 {
        return Err("한 번에 200개까지 확인합니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| fs::metadata(path).map(|m| m.is_file()).unwrap_or(false))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_assets(files: Vec<AssetRequest>) -> Result<Vec<AssetResult>, String> {
    if files.len() > 100 {
        return Err("한 번에 100개까지 확인합니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        files
            .into_iter()
            .map(|file| {
                let message = if file.path.is_empty() {
                    "실제 파일 미선택 · 상대 경로만 지정됨".into()
                } else {
                    match hkx_relative(&file.path) {
                        Ok(clip) if clip.eq_ignore_ascii_case(&file.clip.replace('/', "\\")) => {
                            match fs::metadata(&file.path) {
                                Ok(m) if m.is_file() => format!("파일 존재 · {} bytes · HKX 내용 미검사", m.len()),
                                _ => "파일 없음 또는 접근 불가".into(),
                            }
                        }
                        Ok(_) => "선택했던 파일과 현재 상대 경로가 다릅니다. 다시 선택하세요.".into(),
                        Err(e) => e,
                    }
                };
                AssetResult { id: file.id, message }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Refuses to write over a file whose bytes are no longer the ones the editor read or wrote (`expected`).
/// An empty `expected` (a new file, or the user chose to overwrite) and a file that is gone write as before.
fn unchanged_on_disk(path: &Path, expected: &str) -> Result<(), String> {
    if expected.is_empty() {
        return Ok(());
    }
    match fs::read(path) {
        Ok(bytes) if !digest::sha256(&bytes).eq_ignore_ascii_case(expected) => Err(CHANGED_ON_DISK.into()),
        _ => Ok(()),
    }
}

/// A draft: work saved while the project still has errors. Its runtime body is an empty set
/// (`<AnimationSet version="4" id="…"/>`), which the plugin skips as a whole, and the editor block after it holds
/// the project. Only this exact body may be written without the runtime check.
fn draft_body(contents: &str) -> bool {
    let body = contents
        .split("<!-- AnimationInjectorEditor ")
        .next()
        .unwrap_or("")
        .trim();
    let Some(rest) = body
        .strip_prefix("<?xml")
        .and_then(|r| r.split_once("?>"))
        .map(|(_, r)| r.trim())
    else {
        return false;
    };
    let Some(id) = rest
        .strip_prefix("<AnimationSet version=\"4\" id=\"")
        .and_then(|r| r.strip_suffix("\"/>"))
    else {
        return false;
    };
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// The guard before writing runtime XML: the plugin's own check, or a draft's empty body.
fn writable_xml(contents: &str, draft: bool) -> Result<(), String> {
    if draft {
        if draft_body(contents) {
            return Ok(());
        }
        return Err("초안 저장은 게임용 본문이 빈 묶음일 때만 쓸 수 있습니다.".into());
    }
    runtime_check::require(contents)
}

fn write_document(path: &Path, contents: &str) -> Result<(), String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = path.with_file_name(format!(".aieditor-{}-{}.tmp", std::process::id(), nonce));
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        output.write_all(contents.as_bytes())?;
        output.sync_all()?;
        drop(output);
        fs::rename(&temporary, path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
async fn open_document(app: tauri::AppHandle) -> Result<Option<Document>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Animation Injector", &DOCUMENT_EXTENSIONS)
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        read_document_at(&path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open a known path (recent files, drag & drop). Same limits as the dialog path.
#[tauri::command]
async fn read_document(path: String) -> Result<Document, String> {
    tauri::async_runtime::spawn_blocking(move || read_document_at(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Save dialog hint. An absolute path restores the last folder and file name; a bare file
/// name (the mod folder name for runtime XML) only suggests the name. Other text is ignored.
fn dialog_hint(default_path: Option<&str>, extension: &str) -> (Option<PathBuf>, Option<String>) {
    let Some(path) = default_path.map(Path::new) else {
        return (None, None);
    };
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case(extension)) {
        return (None, None);
    }
    let bare = matches!(
        path.components().collect::<Vec<_>>().as_slice(),
        [std::path::Component::Normal(_)]
    );
    if !path.is_absolute() && !bare {
        return (None, None);
    }
    let directory = if path.is_absolute() {
        path.parent().filter(|p| p.is_dir()).map(Path::to_path_buf)
    } else {
        None
    };
    (directory, path.file_name().map(|n| n.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    kind: String,
    contents: String,
    default_path: Option<String>,
    draft: Option<bool>,
) -> Result<Option<Saved>, String> {
    if contents.len() as u64 > DOCUMENT_LIMIT {
        return Err("파일이 4 MB 제한을 넘었습니다.".into());
    }
    let (name, extension) = match kind.as_str() {
        "xml" => ("AnimationInjector.xml", "xml"),
        "template" => ("AnimationSet.aitemplate", "aitemplate"),
        _ => return Err("알 수 없는 저장 형식입니다.".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        // Runtime XML the plugin would skip is never written (checked before the dialog), except a draft's
        // empty body.
        if extension == "xml" {
            writable_xml(&contents, draft.unwrap_or(false))?;
        }
        let mut dialog = app
            .dialog()
            .file()
            .set_file_name(name)
            .add_filter("Animation Injector", &[extension]);
        let (directory, file_name) = dialog_hint(default_path.as_deref(), extension);
        if let Some(directory) = directory {
            dialog = dialog.set_directory(directory);
        }
        if let Some(file_name) = file_name {
            dialog = dialog.set_file_name(file_name);
        }
        let Some(file) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        write_document(&path, &contents)?;
        Ok(Some(Saved {
            path: path.display().to_string(),
            stamp: digest::sha256(contents.as_bytes()),
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save to the path the document was opened from or last saved to (File > Save). Save As keeps using the dialog.
#[tauri::command]
async fn save_to_path(
    path: String,
    contents: String,
    expected: Option<String>,
    draft: Option<bool>,
) -> Result<Saved, String> {
    if contents.len() as u64 > DOCUMENT_LIMIT {
        return Err("파일이 4 MB 제한을 넘었습니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let target = Path::new(&path);
        // File > Save writes the XML the document was opened from or last saved to (with the editor's block). It is
        // written only after the runtime check passes, as through the dialog (code review E-15: no file the plugin
        // would skip); templates keep their own dialog.
        if !target.extension().is_some_and(|e| e.eq_ignore_ascii_case("xml")) {
            return Err("XML 경로만 바로 저장할 수 있습니다.".into());
        }
        if !target.is_absolute() {
            return Err("절대 경로가 필요합니다.".into());
        }
        writable_xml(&contents, draft.unwrap_or(false))?;
        unchanged_on_disk(target, expected.as_deref().unwrap_or(""))?;
        write_document(target, &contents)?;
        Ok(Saved {
            path: target.display().to_string(),
            stamp: digest::sha256(contents.as_bytes()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            hkx::hkx_meta,
            hkx::viewer::hkx_frames,
            hkx::skin::hkx_skin,
            hkx::skin::pick_viewer_asset,
            open_document,
            read_document,
            save_document,
            save_to_path,
            pick_hkx,
            resolve_hkx,
            files_exist,
            resolve_search_roots,
            check_assets,
            modpack::pick_asset_root,
            modpack::probe_package,
            modpack::export_mod,
            runtime_check::check_runtime_xml
        ])
        .run(tauri::generate_context!())
        .expect("Animation Injector Editor failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dropped_search_roots_are_directories_and_deduplicated() {
        let dir = isolated_dir();
        let file = dir.join("not-a-folder.hkx");
        fs::write(&file, b"test").unwrap();
        let path = dir.display().to_string();
        let result = search_roots(vec![
            path.clone(),
            path,
            file.display().to_string(),
            "relative".into(),
            "//server/share".into(),
        ])
        .unwrap();
        assert_eq!(result.roots.len(), 1);
        assert_eq!(result.rejected.len(), 3);
        assert!(search_roots(vec![String::new(); 201]).is_err());
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn hkx_paths_are_local_relative_and_ascii_below_the_actors_folder() {
        // A Korean mod folder above the actors folder is fine; the game reads only the part below it.
        assert_eq!(
            hkx_relative("H:\\모드\\meshes\\actors\\character\\animations\\Test_1-A+B (2).hkx").unwrap(),
            "animations\\Test_1-A+B (2).hkx"
        );
        for path in [
            "//server/meshes/actors/character/a.hkx",
            "C:/outside/a.hkx",
            "C:/meshes/actors/character/../a.hkx",
            "C:/meshes/actors/character/a.exe",
            "H:/모드/meshes/actors/character/animations/테스트.hkx",
            "H:/mod/meshes/actors/character/잡기/a.hkx",
            "C:/meshes/actors/character/a?.hkx",
        ] {
            assert!(hkx_relative(path).is_err());
        }
    }
    #[test]
    fn save_dialog_suggests_the_mod_name_and_keeps_the_last_folder() {
        assert_eq!(
            dialog_hint(Some("My Animation Mod.xml"), "xml"),
            (None, Some("My Animation Mod.xml".into()))
        );
        let dir = isolated_dir();
        let last = dir.join("그래플 모드.xml");
        assert_eq!(
            dialog_hint(Some(&last.display().to_string()), "xml"),
            (Some(dir.clone()), Some("그래플 모드.xml".into()))
        );
        for ignored in ["..\\escape.xml", "sub/name.xml", "name.aiproj", "", "C:name.xml"] {
            assert_eq!(dialog_hint(Some(ignored), "xml"), (None, None), "{ignored}");
        }
        assert_eq!(dialog_hint(None, "xml"), (None, None));
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn documents_read_as_utf8_or_utf16_with_a_mark() {
        let text = "<?xml version=\"1.0\"?><AnimationSet id=\"한글\"/>";
        assert_eq!(decode_text(text.as_bytes()).unwrap(), text);
        let with_bom = [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat();
        assert_eq!(decode_text(&with_bom).unwrap(), text);
        let le: Vec<u8> = [0xFF, 0xFE]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        assert_eq!(decode_text(&le).unwrap(), text);
        let be: Vec<u8> = [0xFE, 0xFF]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_be_bytes))
            .collect();
        assert_eq!(decode_text(&be).unwrap(), text);
        assert!(decode_text(&[0xFF, 0xFE, 0x41]).is_err());
        assert!(decode_text(&[0xC3, 0x28]).is_err());
    }
    #[test]
    fn document_extensions_are_whitelisted() {
        assert!(!document_extension_ok(Path::new("C:/a/b.aiproj")));
        assert!(document_extension_ok(Path::new("C:/a/B.XML")));
        assert!(document_extension_ok(Path::new("C:/a/t.aitemplate")));
        assert!(!document_extension_ok(Path::new("C:/a/x.exe")));
        assert!(!document_extension_ok(Path::new("C:/a/noext")));
    }
    fn isolated_dir() -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-io")
            .join(format!("{}-{}", std::process::id(), nonce));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn saves_and_replaces_unicode_document() {
        let dir = isolated_dir();
        let file = dir.join("한글 콤보.xml");
        write_document(&file, "첫 저장").unwrap();
        write_document(&file, "두 번째 저장").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "두 번째 저장");
        let doc = read_document_at(&file).unwrap();
        assert_eq!(doc.contents, "두 번째 저장");
        assert_eq!(doc.name, "한글 콤보.xml");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn a_draft_is_only_an_empty_set_with_the_editor_block() {
        let block = "\n<!-- AnimationInjectorEditor {\"version\":1} -->\n";
        let empty = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<AnimationSet version=\"4\" id=\"My_Set1\"/>";
        assert!(draft_body(&format!("{empty}{block}")));
        assert!(writable_xml(&format!("{empty}{block}"), true).is_ok());
        for body in [
            "<?xml version=\"1.0\"?><AnimationSet version=\"4\" id=\"A\"><Action id=\"X\"/></AnimationSet>",
            "<?xml version=\"1.0\"?><AnimationSet version=\"3\" id=\"A\"/>",
            "<?xml version=\"1.0\"?><AnimationSet version=\"4\" id=\"a b\"/>",
            "<AnimationSet version=\"4\" id=\"A\"/>",
        ] {
            assert!(!draft_body(&format!("{body}{block}")), "{body}");
            assert!(writable_xml(&format!("{body}{block}"), true).is_err(), "{body}");
        }
    }
    #[test]
    fn save_refuses_a_file_changed_since_it_was_read() {
        let dir = isolated_dir();
        let file = dir.join("doc.xml");
        fs::write(&file, "opened").unwrap();
        let stamp = read_document_at(&file).unwrap().stamp;
        assert!(unchanged_on_disk(&file, &stamp).is_ok());
        fs::write(&file, "edited elsewhere").unwrap();
        assert_eq!(unchanged_on_disk(&file, &stamp).unwrap_err(), CHANGED_ON_DISK);
        // Overwrite chosen (no stamp) and a file that is gone both write.
        assert!(unchanged_on_disk(&file, "").is_ok());
        fs::remove_file(&file).unwrap();
        assert!(unchanged_on_disk(&file, &stamp).is_ok());
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn failed_replace_keeps_target_and_removes_temporary_file() {
        let dir = isolated_dir();
        let occupied = dir.join("occupied");
        fs::create_dir(&occupied).unwrap();
        assert!(write_document(&occupied, "cannot replace a directory").is_err());
        assert!(occupied.is_dir());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir(occupied).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
