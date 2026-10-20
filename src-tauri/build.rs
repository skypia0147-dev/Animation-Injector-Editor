use std::{env, fs, path::Path};

/// The built-in preview skeletons and skins: every file under assets/preview/skeletons (*.hkx) and
/// assets/preview/meshes (*.glb) when that folder exists. The public source has no game files, so a build from it
/// gets an empty table and the viewer asks for a skeleton; the release build is made where the files are present.
fn builtin_assets() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets").join("preview");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut entries = Vec::new();
    for (folder, extension) in [("skeletons", "hkx"), ("meshes", "glb")] {
        let directory = root.join(folder);
        println!("cargo:rerun-if-changed={}", directory.display());
        let Ok(listing) = fs::read_dir(&directory) else {
            continue;
        };
        let mut files: Vec<_> = listing
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|e| e.eq_ignore_ascii_case(extension)))
            .collect();
        files.sort();
        for file in files {
            let name = file.file_name().unwrap().to_string_lossy().to_ascii_lowercase();
            entries.push(format!(
                "    (\"builtin/{folder}/{name}\", include_bytes!({file:?})),\n"
            ));
        }
    }
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("builtin_files.rs");
    fs::write(
        out,
        format!("pub const FILES: &[(&str, &[u8])] = &[\n{}];\n", entries.concat()),
    )
    .unwrap();
}

fn main() {
    builtin_assets();
    tauri_build::build()
}
