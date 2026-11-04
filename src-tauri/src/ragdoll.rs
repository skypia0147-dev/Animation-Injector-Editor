//! Carry ragdoll files beside an action XML: `<folder of the XML>/Ragdoll/<lift action id>.xml` (the runtime's
//! RagdollProfile, 11-04). The editor reads them when a document opens and writes them when it saves; the mod
//! package writes them beside its XML (modpack.rs).
use std::fs;
use std::path::{Path, PathBuf};

const FILE_LIMIT: usize = 256 * 1024;
const COUNT_LIMIT: usize = 256;

/// A lift action's id as the editor writes it (model.ts idPattern): it names the file.
pub fn valid_id(id: &str) -> bool {
    let mut bytes = id.bytes();
    id.len() <= 64
        && bytes.next().is_some_and(|c| c.is_ascii_alphabetic())
        && bytes.all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

#[derive(Clone, serde::Deserialize)]
pub struct RagdollFile {
    pub id: String,
    pub contents: String,
}

/// A file to write: a safe id and a ragdoll document the editor made (ragdoll.ts ragdollXml).
pub fn check(file: &RagdollFile) -> Result<(), String> {
    if !valid_id(&file.id) {
        return Err(format!("래그돌 파일 이름(동작 ID)이 잘못되었습니다: {}", file.id));
    }
    if file.contents.len() > FILE_LIMIT
        || !file.contents.trim_start().starts_with("<?xml")
        || !file.contents.contains("<Ragdoll ")
    {
        return Err(format!("래그돌 파일 형식 오류: {}", file.id));
    }
    Ok(())
}

fn folder(xml_path: &str) -> Result<PathBuf, String> {
    let xml = Path::new(xml_path);
    if !xml.is_absolute() || !xml.extension().is_some_and(|e| e.eq_ignore_ascii_case("xml")) {
        return Err("래그돌 파일은 저장된 XML 옆에만 둡니다.".into());
    }
    let parent = xml.parent().ok_or("XML 폴더가 없습니다.")?;
    Ok(parent.join("Ragdoll"))
}

#[derive(serde::Serialize)]
pub struct ReadRagdoll {
    pub id: String,
    /// None: no file.
    pub contents: Option<String>,
}

/// The ragdoll files of these lift actions beside the XML, those that exist.
#[tauri::command]
pub async fn read_ragdolls(xml_path: String, ids: Vec<String>) -> Result<Vec<ReadRagdoll>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if ids.len() > COUNT_LIMIT {
            return Err("래그돌 파일 개수 제한".into());
        }
        let folder = folder(&xml_path)?;
        let mut out = Vec::new();
        for id in ids {
            if !valid_id(&id) {
                out.push(ReadRagdoll { id, contents: None });
                continue;
            }
            let path = folder.join(format!("{id}.xml"));
            let contents = match fs::metadata(&path) {
                Ok(m) if m.is_file() && m.len() as usize <= FILE_LIMIT => {
                    Some(fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?)
                }
                Ok(m) if m.is_file() => return Err(format!("{}: 래그돌 파일이 너무 큽니다.", path.display())),
                _ => None,
            };
            out.push(ReadRagdoll { id, contents });
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes these lift actions' files beside the XML and removes those of `remove` (lifts back on the built-in values,
/// or renamed). Every file is checked before any is written.
#[tauri::command]
pub async fn write_ragdolls(xml_path: String, files: Vec<RagdollFile>, remove: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if files.len() > COUNT_LIMIT || remove.len() > COUNT_LIMIT {
            return Err("래그돌 파일 개수 제한".into());
        }
        for f in &files {
            check(f)?;
        }
        if let Some(id) = remove.iter().find(|id| !valid_id(id)) {
            return Err(format!("래그돌 파일 이름(동작 ID)이 잘못되었습니다: {}", id));
        }
        let folder = folder(&xml_path)?;
        if !files.is_empty() {
            fs::create_dir_all(&folder).map_err(|e| format!("{}: {e}", folder.display()))?;
        }
        for f in &files {
            crate::write_document(&folder.join(format!("{}.xml", f.id)), &f.contents)?;
        }
        for id in &remove {
            let path = folder.join(format!("{id}.xml"));
            if path.is_file() {
                fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_name_files_only() {
        assert!(valid_id("GrappleCarryLift"));
        assert!(valid_id("A_1"));
        for bad in ["", "1Lift", "../Lift", "Lift.xml", "Lift\\x", "a:b", &"A".repeat(65)] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn writes_and_removes_beside_the_xml() {
        let root = std::env::temp_dir().join(format!("aie-ragdoll-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let xml = root.join("Mod.xml").display().to_string();
        let doc = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<Ragdoll rig=\"character\" version=\"1\"/>\n";
        let file = RagdollFile {
            id: "Lift".into(),
            contents: doc.into(),
        };
        tauri::async_runtime::block_on(write_ragdolls(xml.clone(), vec![file], vec![])).unwrap();
        let read =
            tauri::async_runtime::block_on(read_ragdolls(xml.clone(), vec!["Lift".into(), "Other".into()])).unwrap();
        assert_eq!(read[0].contents.as_deref(), Some(doc));
        assert!(read[1].contents.is_none());
        tauri::async_runtime::block_on(write_ragdolls(xml.clone(), vec![], vec!["Lift".into()])).unwrap();
        assert!(!root.join("Ragdoll/Lift.xml").exists());
        let bad = RagdollFile {
            id: "../Lift".into(),
            contents: doc.into(),
        };
        assert!(tauri::async_runtime::block_on(write_ragdolls(xml, vec![bad], vec![])).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
