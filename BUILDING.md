# Building Animation Injector Editor

[한국어](BUILDING_KO.md)

## Requirements

- Windows 10/11 x64 with the Microsoft Edge WebView2 Runtime
- [Node.js](https://nodejs.org/) 22 or later (tested with 24)
- [Rust](https://www.rust-lang.org/) 1.88 or later, MSVC toolchain, and the Visual Studio C++ build tools that Tauri needs
- Git (the HKX reader is a submodule)

## Get the source

```bash
git clone --recurse-submodules <this repository>
```

If you cloned without submodules, run `git submodule update --init`. `vendor/serde-hkx` is pinned to the commit
recorded in `vendor-lock.json`.

## Build and run

```bash
npm ci
npm run desktop          # development window with hot reload
npm run desktop:build    # release exe: src-tauri/target/release/animation-injector-editor.exe
```

`npm run build` builds only the web front end (`dist/`); `npm run dev` serves it in a browser, where reading HKX and
saving to disk are not available.

## The runtime XML checker

Saving runs `AnimationInjectorXmlCheck.exe`, built from the runtime's sources, so the editor never writes an XML the
game would skip. Build it from the [Animation Injector](https://github.com/skypia0147-dev/Animation-Injector)
repository (see its `BUILDING.md`):

```bash
cmake --build build --config Release --target AnimationInjectorXmlCheck
```

Put the exe next to the editor's exe. A debug build of the editor also finds it in a runtime checkout beside this one
(`../AnimationInjector/build/Release`). Keep its version equal to `MINIMUM_RUNTIME_VERSION` in `src/xmlFormat.ts`.

## Tests

```bash
npm test                         # formatting check, then node --test tests/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml
```

Some tests compare with the runtime. They look for a runtime checkout beside this one and are skipped, with the
reason, when it is missing:

| Variable | Default | Used for |
|---|---|---|
| `AIE_RUNTIME_SRC` | `../AnimationInjector` | runtime sources (event names, test data) |
| `AIE_XMLCHECK` | `<AIE_RUNTIME_SRC>/build/Release/AnimationInjectorXmlCheck.exe` | XML accepted by the runtime |
| `AIE_GRAPPLE_XML` | unset | an installed Grapple mod's XML, for tests on a real project |

## Translations

Screen text is written in Korean as `tr('...')` and translated in `src/i18n/fromKorean.ts` (English, Japanese,
Chinese). After adding text, `node tools/i18n-merge.mjs --missing <file>` lists what needs translating and
`node tools/i18n-merge.mjs <translations.json>` merges it; `tests/korean-coverage.test.mjs` fails on anything left
out. Messages from the Rust side are gathered with `node tools/i18n-backend.mjs`.

## Game files

The repository contains no game assets. The release package's exe embeds preview skeletons (`*.hkx`) and skins
(`*.glb`) for humans and creatures; `build.rs` takes every file under `src-tauri/assets/preview/skeletons` and
`src-tauri/assets/preview/meshes` when that folder exists, and builds an empty table when it does not. A build from
this repository therefore previews with the skeletons the user chooses.
