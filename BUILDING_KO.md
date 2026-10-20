# Animation Injector Editor 빌드

[English](BUILDING.md)

## 준비물

- Windows 10/11 x64, Microsoft Edge WebView2 런타임
- [Node.js](https://nodejs.org/) 22 이상 (24에서 확인)
- [Rust](https://www.rust-lang.org/) 1.88 이상(MSVC 툴체인)과 Tauri가 쓰는 Visual Studio C++ 빌드 도구
- Git (HKX 리더가 서브모듈입니다)

## 소스 받기

```bash
git clone --recurse-submodules <이 저장소>
```

서브모듈 없이 받았다면 `git submodule update --init`을 실행하세요. `vendor/serde-hkx`는 `vendor-lock.json`에 적힌
커밋으로 고정돼 있습니다.

## 빌드와 실행

```bash
npm ci
npm run desktop          # 개발용 창(코드 수정 즉시 반영)
npm run desktop:build    # 배포용 exe: src-tauri/target/release/animation-injector-editor.exe
```

`npm run build`는 화면(`dist/`)만 빌드합니다. `npm run dev`는 브라우저에서 띄우며, HKX 읽기와 디스크 저장은 되지
않습니다.

## 런타임 XML 검사기

저장할 때 런타임 소스로 빌드한 `AnimationInjectorXmlCheck.exe`를 돌려, 게임이 건너뛸 XML을 쓰지 않습니다.
[Animation Injector](https://github.com/skypia0147-dev/Animation-Injector) 저장소에서 빌드하세요(그 저장소의
`BUILDING_KO.md` 참고).

```bash
cmake --build build --config Release --target AnimationInjectorXmlCheck
```

만든 exe를 에디터 exe 옆에 두면 됩니다. 에디터의 디버그 빌드는 이 저장소 옆의 런타임 폴더
(`../AnimationInjector/build/Release`)에서도 찾습니다. 검사기 버전은 `src/xmlFormat.ts`의
`MINIMUM_RUNTIME_VERSION`과 같게 유지하세요.

## 시험

```bash
npm test                         # 형식 검사 후 node --test tests/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml
```

런타임과 비교하는 시험은 이 저장소 옆의 런타임 폴더를 찾고, 없으면 이유를 남기고 건너뜁니다.

| 변수 | 기본값 | 쓰임 |
|---|---|---|
| `AIE_RUNTIME_SRC` | `../AnimationInjector` | 런타임 소스(이벤트 이름, 시험 데이터) |
| `AIE_XMLCHECK` | `<AIE_RUNTIME_SRC>/build/Release/AnimationInjectorXmlCheck.exe` | 런타임이 받아들이는 XML인지 |
| `AIE_GRAPPLE_XML` | 없음 | 설치된 Grapple 모드의 XML(실제 프로젝트로 하는 시험) |

## 번역

화면 문구는 한국어로 `tr('...')`처럼 쓰고, 번역은 `src/i18n/fromKorean.ts`(영어·일본어·중국어)에 있습니다. 문구를
더한 뒤 `node tools/i18n-merge.mjs --missing <파일>`로 번역할 목록을 뽑고 `node tools/i18n-merge.mjs <번역.json>`으로
합칩니다. 빠진 번역은 `tests/korean-coverage.test.mjs`가 잡습니다. Rust 쪽 메시지는 `node tools/i18n-backend.mjs`로
모읍니다.

## 게임 파일

저장소와 exe에는 게임 자산이 들어 있지 않습니다. HKX·스켈레톤·스킨은 사용자가 설치한 게임과 모드에서 씁니다.
