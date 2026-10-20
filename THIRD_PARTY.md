# Third-party software

[한국어](#서드파티-소프트웨어)

Animation Injector Editor is distributed as a whole under the GNU General Public License version 3 (`LICENSE`).

## HKX_Viewer and HavokLib (ported, GPL-3.0)

The native HKX viewer decoder is a modified Rust port of these GPL-3.0 sources from the author's own HKX_Viewer
project:

| Original | Ported to | Original SHA-256 |
|---|---|---|
| `hkxviewer/hkx_serde.py` | `src-tauri/src/hkx/viewer.rs` | `DBAFD4C7106C76639F44CD994BF5941C81295044E774F1801111C67CE9F4A85A` |
| `hkxviewer/hkx_spline.py` | `src-tauri/src/hkx/spline.rs` | `1A677972996DFF167AE961094510BEDC399F72957975837596A6E81AE58A15AA` |
| `hkxviewer/model.py` | `src-tauri/src/hkx/viewer.rs` | `8351D9986E85797144CC79124236DAF00292DBAB39A078E768BEDF21691FB0FA` |
| `signatures.json` | `src-tauri/assets/signatures.json` | `33F220B9273597134C9F3657125DF820DF77924726E85328B20D1B76E7BEFC06` |

`hkx_spline.py` ports `source/hka_spline_decompressor.cpp` of [HavokLib](https://github.com/PredatorCZ/HavokLib),
Copyright (C) 2016-2023 Lukas Cone, GPL-3.0. Porting notes: `src-tauri/assets/PORTING_SOURCE.md`; the license text
kept with them: `src-tauri/assets/HKX_VIEWER_LICENSE_GPL-3.0.txt`.

## serde-hkx (MIT OR Apache-2.0)

Binary HKX is read with [serde-hkx](https://github.com/SARDONYX-sard/serde-hkx), a submodule at `vendor/serde-hkx`
pinned to commit `e8bc1abc015d42567e6b7e7bb3e99447370f306a` (tag `0.7.3`, crate version `0.7.2`), also recorded in
`vendor-lock.json`.

## three.js (MIT)

The viewport uses [three](https://github.com/mrdoob/three.js) `0.185.1`, locked in `package.json` and
`package-lock.json`.

## Runtime XML checker (GPL-3.0)

`AnimationInjectorXmlCheck.exe`, shipped next to the editor, is built from the
[Animation Injector](https://github.com/skypia0147-dev/Animation-Injector) runtime sources (`tests/XmlDeclarations.cpp`,
`src/Settings.cpp`, `src/declarations/`). It links CommonLibSSE-NG (GPL-3.0), pugixml (MIT), spdlog (MIT) and fmt
(MIT) statically. Its source is that repository at the matching version.

## Other dependencies

Tauri, React, Vite, TypeScript and the rest are locked in `package-lock.json` and `src-tauri/Cargo.lock`. A release
package's `THIRD_PARTY_NOTICES.txt` holds their license texts, gathered by `tools/package.mjs`.

## Game files

The repository and the program contain no game assets. Skeleton HKX and skin GLB are files the user chooses from an
installation they have the right to use; the editor reads them in place and never copies or uploads them. The GPL of
this program grants no rights to anyone's game or mod assets.

---

# 서드파티 소프트웨어

Animation Injector Editor는 전체를 GNU General Public License 버전 3(`LICENSE`)으로 배포합니다.

## HKX_Viewer와 HavokLib (포팅, GPL-3.0)

네이티브 HKX 뷰어 디코더는 작성자 본인의 HKX_Viewer 프로젝트에 있는 GPL-3.0 소스를 Rust로 수정 포팅한 것입니다.
원본 파일과 해시는 위 영문 표와 같습니다. `hkx_spline.py`는 [HavokLib](https://github.com/PredatorCZ/HavokLib)의
`source/hka_spline_decompressor.cpp`(Copyright (C) 2016-2023 Lukas Cone, GPL-3.0)를 포팅한 코드입니다. 포팅
내역은 `src-tauri/assets/PORTING_SOURCE.md`, 함께 둔 라이선스 전문은 `src-tauri/assets/HKX_VIEWER_LICENSE_GPL-3.0.txt`에
있습니다.

## serde-hkx (MIT 또는 Apache-2.0)

바이너리 HKX는 [serde-hkx](https://github.com/SARDONYX-sard/serde-hkx)로 읽습니다. `vendor/serde-hkx` 서브모듈이며
커밋 `e8bc1abc015d42567e6b7e7bb3e99447370f306a`(태그 `0.7.3`, crate 버전 `0.7.2`)로 고정했고 `vendor-lock.json`에도
기록돼 있습니다.

## three.js (MIT)

뷰포트는 [three](https://github.com/mrdoob/three.js) `0.185.1`을 씁니다(`package.json`, `package-lock.json`에 고정).

## 런타임 XML 검사기 (GPL-3.0)

에디터 옆에 함께 배포하는 `AnimationInjectorXmlCheck.exe`는
[Animation Injector](https://github.com/skypia0147-dev/Animation-Injector) 런타임 소스(`tests/XmlDeclarations.cpp`,
`src/Settings.cpp`, `src/declarations/`)로 빌드합니다. CommonLibSSE-NG(GPL-3.0), pugixml(MIT), spdlog(MIT),
fmt(MIT)를 정적으로 링크합니다. 대응 소스는 같은 버전의 그 저장소입니다.

## 그 밖의 의존성

Tauri, React, Vite, TypeScript 등은 `package-lock.json`과 `src-tauri/Cargo.lock`에 고정돼 있습니다. 배포 패키지의
`THIRD_PARTY_NOTICES.txt`에 `tools/package.mjs`가 모은 라이선스 원문이 들어갑니다.

## 게임 파일

저장소와 프로그램에는 게임 자산이 들어 있지 않습니다. 스켈레톤 HKX와 스킨 GLB는 사용자가 사용할 권리가 있는
설치본에서 직접 고르는 파일이며, 에디터는 그 자리에서 읽기만 하고 복사하거나 업로드하지 않습니다. 이 프로그램의
GPL은 게임이나 모드 자산에 대한 권리를 주지 않습니다.
