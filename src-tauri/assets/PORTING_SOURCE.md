# P5 HKX 디코더 포팅 출처

P5 네이티브 뷰어 디코더는 아래 GPLv3 소스의 수정 포팅이다. 수정본은
`src-tauri/src/hkx/viewer.rs`와 `src-tauri/src/hkx/spline.rs`에 있으며, 빌드에
사용한 전체 프로젝트 소스와 함께 재현할 수 있다. GPLv3 전문은
`HKX_VIEWER_LICENSE_GPL-3.0.txt`에 보존했다.

## HKX_Viewer

- 출처: 작성자(Smooth)의 HKX_Viewer 프로젝트 (공개 저장소 없음, 같은 GPLv3)
- 라이선스: GPLv3
- 포팅 파일:
  - `hkxviewer/hkx_serde.py`
    - SHA-256 `DBAFD4C7106C76639F44CD994BF5941C81295044E774F1801111C67CE9F4A85A`
  - `hkxviewer/hkx_spline.py`
    - SHA-256 `1A677972996DFF167AE961094510BEDC399F72957975837596A6E81AE58A15AA`
  - `hkxviewer/model.py`
    - SHA-256 `8351D9986E85797144CC79124236DAF00292DBAB39A078E768BEDF21691FB0FA`
  - `signatures.json`
    - SHA-256 `33F220B9273597134C9F3657125DF820DF77924726E85328B20D1B76E7BEFC06`

`hkx_spline.py`는 PredatorCZ/HavokLib의
`source/hka_spline_decompressor.cpp`를 포팅한 코드다. 원 저작권 표기는
`Copyright (C) 2016-2023 Lukas Cone`이며 HavokLib은 GPLv3로 배포된다.

- https://github.com/PredatorCZ/HavokLib

## serde-hkx

바이너리 HKX container/class 역직렬화에는 프로젝트의 기존 vendor 사본을
그대로 사용한다.

- 저장소: https://github.com/SARDONYX-sard/serde-hkx
- 고정 커밋: `e8bc1abc015d42567e6b7e7bb3e99447370f306a`
- upstream tag: `0.7.3`
- manifest version: `0.7.2`
- 라이선스: MIT OR Apache-2.0

## 포함하지 않은 자산

HKX_Viewer의 skeleton HKX와 GLB skin은 파일별 원출처·재배포 권리를 확인할
수 없어 복사하거나 패키지에 포함하지 않았다. 실행 시 사용자가 소유한 로컬
자산 경로만 읽는다.
