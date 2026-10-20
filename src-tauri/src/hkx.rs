use havok_classes::{Classes, hkaAnimation};
use std::{fs, path::Path, io::Read};

pub(crate) mod skin;
mod spline;
pub(crate) mod viewer;

#[derive(serde::Serialize, Debug)]
pub struct Annotation {
    time: f32,
    text: String,
    track: String,
}
#[derive(serde::Serialize, Debug)]
pub struct AnimationMeta {
    duration: f32,
    tracks: i32,
    annotations: Vec<Annotation>,
}
#[derive(serde::Serialize, Debug)]
pub struct Metadata {
    animations: Vec<AnimationMeta>,
    /// A pair HKX's start: "front" (the two face each other) or "back" (one behind the other).
    #[serde(rename = "pairFacing", skip_serializing_if = "Option::is_none")]
    pair_facing: Option<&'static str>,
}

fn animation(a: &hkaAnimation<'_>) -> Result<AnimationMeta, String> {
    if !a.m_duration.is_finite() || a.m_duration <= 0.0 || a.m_duration > 86400.0 {
        return Err("HKX 애니메이션 길이가 유효하지 않습니다.".into());
    }
    let mut annotations = Vec::new();
    for track in &a.m_annotationTracks {
        for note in &track.m_annotations {
            if !note.m_time.is_finite() || note.m_time < 0.0 {
                continue;
            }
            if annotations.len() >= 100000 {
                return Err("HKX 주석 개수 제한을 넘었습니다.".into());
            }
            annotations.push(Annotation {
                time: note.m_time,
                text: note.m_text.as_str().to_owned(),
                track: track.m_trackName.as_str().to_owned(),
            });
        }
    }
    annotations.sort_by(|a, b| a.time.total_cmp(&b.time));
    Ok(AnimationMeta {
        duration: a.m_duration,
        tracks: a.m_numberOfTransformTracks,
        annotations,
    })
}
fn decode(bytes: &[u8]) -> Result<Metadata, String> {
    let classes: indexmap::IndexMap<usize, Classes<'_>> =
        serde_hkx::from_bytes(bytes).map_err(|e| format!("HKX 해석 실패: {e}"))?;
    let mut animations = Vec::new();
    for c in classes.values() {
        let a = match c {
            Classes::hkaSplineCompressedAnimation(a) => Some(&a.parent),
            Classes::hkaInterleavedUncompressedAnimation(a) => Some(&a.parent),
            Classes::hkaDeltaCompressedAnimation(a) => Some(&a.parent),
            Classes::hkaWaveletCompressedAnimation(a) => Some(&a.parent),
            _ => None,
        };
        if let Some(a) = a {
            animations.push(animation(a)?);
        }
    }
    if animations.is_empty() {
        return Err("지원되는 애니메이션이 없는 HKX입니다.".into());
    }
    let pair_facing = viewer::pair_start_facing(&classes).map(|front| if front { "front" } else { "back" });
    Ok(Metadata {
        animations,
        pair_facing,
    })
}
pub fn read(path: &str) -> Result<Metadata, String> {
    let p = Path::new(path);
    if !p.is_absolute()
        || path.starts_with("\\\\")
        || path.contains("://")
        || !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("hkx"))
    {
        return Err("로컬 HKX 절대 경로가 필요합니다.".into());
    }
    let f = fs::File::open(p).map_err(|e| e.to_string())?;
    if !f.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("파일이 아닙니다.".into());
    }
    let mut bytes = Vec::new();
    f.take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("HKX는 64 MB 이하여야 합니다.".into());
    }
    std::panic::catch_unwind(|| decode(&bytes)).map_err(|_| "HKX 해석 중 오류가 발생했습니다.".to_owned())?
}
#[tauri::command]
pub async fn hkx_meta(path: String) -> Result<Metadata, String> {
    tauri::async_runtime::spawn_blocking(move || read(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore]
    fn reference_metadata_matches_viewer() {
        let path = std::env::var("AIE_HKX_FIXTURE").expect("set AIE_HKX_FIXTURE");
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/p4-verification");
        let expected: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("expected.json")).unwrap()).unwrap();
        let m = read(&path).unwrap();
        assert!((m.animations[0].duration as f64 - expected["duration"].as_f64().unwrap()).abs() < 0.00001);
        let notes = expected["annotations"].as_array().unwrap();
        assert_eq!(notes.len(), m.animations[0].annotations.len());
        let mut matched = vec![false; notes.len()];
        for actual in &m.animations[0].annotations {
            let index = notes
                .iter()
                .enumerate()
                .position(|(i, want)| {
                    !matched[i]
                        && actual.text == want["text"].as_str().unwrap()
                        && (actual.time as f64 - want["time"].as_f64().unwrap()).abs() < 0.00001
                })
                .expect("matching annotation and timestamp");
            matched[index] = true;
        }
        let win32 = read(dir.join("attack-win32.hkx").to_str().unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&m).unwrap(), serde_json::to_value(&win32).unwrap());
        fs::write(dir.join("metadata.json"), serde_json::to_vec_pretty(&m).unwrap()).unwrap();
    }
    #[test]
    fn rejects_invalid_paths_and_bytes() {
        assert!(read("https://example.org/a.hkx").is_err());
        assert!(read("a.txt").is_err());
        assert!(decode(&[0u8; 64]).is_err());
    }
    #[test]
    fn real_animation_metadata() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../release/test-mods/AI Editor S5 Sample/meshes/actors/character/Animations/ComboTest/test_Null.hkx"
        );
        // A local test HKX (release/test-mods, not in the repository): skipped when it is not there.
        if !std::path::Path::new(path).is_file() {
            eprintln!("skipped: {path} not found");
            return;
        }
        let m = read(path).unwrap();
        assert!(!m.animations.is_empty());
        assert!(m.animations[0].duration > 0.0);
        println!("{m:?}");
    }
}
