use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri_plugin_dialog::DialogExt;

const GLB_FILE_LIMIT: u64 = 32 * 1024 * 1024;
const GLB_JSON_CHUNK: u32 = 0x4e4f_534a;

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkinBinary {
    path: String,
    name: String,
    bytes: Vec<u8>,
}

fn validate_local_path(path: &str, extension: &str) -> Result<PathBuf, String> {
    let value = Path::new(path);
    if path.len() > 32_767
        || !value.is_absolute()
        || path.starts_with("\\\\")
        || path.contains("://")
        || !value
            .extension()
            .is_some_and(|item| item.eq_ignore_ascii_case(extension))
    {
        return Err(format!("로컬 {extension} 절대 경로가 필요합니다."));
    }
    let metadata = fs::metadata(value).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("파일이 아닙니다.".into());
    }
    Ok(value.to_path_buf())
}

fn le_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or("GLB 헤더 또는 chunk가 중간에서 끝났습니다.")?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn validate_glb(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 20 || bytes.get(..4) != Some(b"glTF") {
        return Err("GLB magic 또는 헤더가 유효하지 않습니다.".into());
    }
    if le_u32(bytes, 4)? != 2 {
        return Err("GLB v2 파일만 지원합니다.".into());
    }
    if usize::try_from(le_u32(bytes, 8)?).ok() != Some(bytes.len()) {
        return Err("GLB 선언 길이와 실제 파일 길이가 다릅니다.".into());
    }
    let mut cursor = 12_usize;
    let mut chunk_index = 0_usize;
    while cursor < bytes.len() {
        let length = usize::try_from(le_u32(bytes, cursor)?).map_err(|_| "GLB chunk 길이가 너무 큽니다.")?;
        let kind = le_u32(bytes, cursor + 4)?;
        if length % 4 != 0 {
            return Err("GLB chunk 길이는 4 byte 정렬이어야 합니다.".into());
        }
        if chunk_index == 0 && kind != GLB_JSON_CHUNK {
            return Err("GLB 첫 chunk가 JSON이 아닙니다.".into());
        }
        cursor = cursor
            .checked_add(8)
            .and_then(|value| value.checked_add(length))
            .ok_or("GLB chunk 길이 계산이 넘쳤습니다.")?;
        if cursor > bytes.len() {
            return Err("GLB chunk가 파일 범위를 벗어났습니다.".into());
        }
        chunk_index += 1;
    }
    if cursor != bytes.len() || chunk_index == 0 {
        return Err("GLB chunk 구성이 유효하지 않습니다.".into());
    }
    Ok(())
}

/// GLB for the WebView: a JSON header {path, name} followed by the raw file bytes.
fn encode_skin(skin: &SkinBinary) -> Result<Vec<u8>, String> {
    crate::ipc_binary::frame(
        &serde_json::json!({"path": skin.path, "name": skin.name}),
        skin.bytes.len(),
        |out| out.extend_from_slice(&skin.bytes),
    )
}

fn read_skin_at(path: &str) -> Result<SkinBinary, String> {
    let path = validate_local_path(path, "glb")?;
    let file = fs::File::open(&path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if metadata.len() > GLB_FILE_LIMIT {
        return Err("GLB는 32 MB 이하여야 합니다.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(GLB_FILE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > GLB_FILE_LIMIT {
        return Err("GLB는 32 MB 이하여야 합니다.".into());
    }
    validate_glb(&bytes)?;
    Ok(SkinBinary {
        name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        bytes,
    })
}

#[tauri::command]
pub async fn hkx_skin(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || read_skin_at(&path).and_then(|skin| encode_skin(&skin)))
        .await
        .map_err(|error| error.to_string())?
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn pick_viewer_asset(app: tauri::AppHandle, kind: String) -> Result<Option<String>, String> {
    let (label, extension) = match kind.as_str() {
        "skeleton" => ("Havok skeleton", "hkx"),
        "skin" => ("GLB skin", "glb"),
        _ => return Err("알 수 없는 뷰어 자산 종류입니다.".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().add_filter(label, &[extension]).blocking_pick_file() else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|error| error.to_string())?;
        let value = path.to_string_lossy().into_owned();
        validate_local_path(&value, extension)?;
        Ok(Some(value))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_glb() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"glTF");
        bytes.extend_from_slice(&2_u32.to_le_bytes());
        bytes.extend_from_slice(&20_u32.to_le_bytes());
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        bytes.extend_from_slice(&GLB_JSON_CHUNK.to_le_bytes());
        bytes
    }

    #[test]
    fn validates_glb_v2_structure() {
        assert!(validate_glb(&valid_glb()).is_ok());
        let mut wrong_length = valid_glb();
        wrong_length[8..12].copy_from_slice(&24_u32.to_le_bytes());
        assert!(validate_glb(&wrong_length).is_err());
        let mut wrong_chunk = valid_glb();
        wrong_chunk[16..20].copy_from_slice(&0x004e_4942_u32.to_le_bytes());
        assert!(validate_glb(&wrong_chunk).is_err());
        assert!(validate_glb(&[0_u8; 20]).is_err());
    }

    #[test]
    fn reads_valid_local_glb_and_rejects_bad_file() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join(format!(
            "p5-skin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let valid = directory.join("사용자 스킨.glb");
        fs::write(&valid, valid_glb()).unwrap();
        let loaded = read_skin_at(&valid.to_string_lossy()).unwrap();
        assert_eq!(loaded.name, "사용자 스킨.glb");
        assert_eq!(loaded.bytes, valid_glb());
        let frame = encode_skin(&loaded).unwrap();
        let (header, payload) = crate::ipc_binary::split(&frame);
        assert_eq!(
            (header["name"].as_str(), payload),
            (Some("사용자 스킨.glb"), valid_glb().as_slice())
        );
        let bad = directory.join("bad.glb");
        fs::write(&bad, [0_u8; 20]).unwrap();
        assert!(read_skin_at(&bad.to_string_lossy()).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore]
    fn reads_real_user_skin_fixture() {
        let path = std::env::var("AIE_VIEWER_GLB").expect("set AIE_VIEWER_GLB");
        let started = std::time::Instant::now();
        let loaded = read_skin_at(&path).unwrap();
        assert_eq!(loaded.bytes.get(..4), Some(b"glTF".as_slice()));
        println!(
            "native GLB read: {} bytes in {:.3}s",
            loaded.bytes.len(),
            started.elapsed().as_secs_f64()
        );
    }
}
