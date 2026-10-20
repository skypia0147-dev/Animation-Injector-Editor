import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backendText} from '../src/backendText.ts';
import {getLanguage, setLanguage} from '../src/i18n/index.ts';
import {fromKorean} from '../src/i18n/fromKorean.ts';

// The Rust backend writes its messages in Korean (src-tauri/src); backend.ts shows them in the UI language.
const inLanguage = (language, fn) => {
  const before = getLanguage();
  setLanguage(language);
  try {
    fn();
  } finally {
    setLanguage(before);
  }
};

test('backend messages show in the UI language, with their values', () => {
  inLanguage('en', () => {
    const plain = '파일이 아닙니다.';
    assert.equal(backendText(plain), fromKorean[plain][0]);
    // format!("{}: 마지막 검사 이후 원본이 변경되었습니다. 다시 검사하세요.", clip)
    const changed = backendText('Animations\\A.hkx: 마지막 검사 이후 원본이 변경되었습니다. 다시 검사하세요.');
    assert.ok(changed.startsWith('Animations\\A.hkx'), changed);
    assert.doesNotMatch(changed, /[가-힣]/);
    // format!("{CHECKER}가 비정상 종료했습니다(코드 {code}). {detail}") keeps the checker's own detail.
    const crashed = backendText('AnimationInjectorXmlCheck.exe가 비정상 종료했습니다(코드 3). boom');
    assert.match(crashed, /AnimationInjectorXmlCheck\.exe/);
    assert.match(crashed, /3/);
    assert.match(crashed, /boom$/);
    // format!("{GAME_PATH_RULE} ({clip})"): a known message followed by more keeps the rest.
    const rule =
      'HKX 경로(캐릭터 폴더 아래)는 영문·숫자·일반 기호만 씁니다. 한글 등은 게임이 파일을 찾지 못하니 파일·폴더 이름을 바꾸세요.';
    assert.equal(backendText(rule + ' (Animations\\가.hkx)'), fromKorean[rule][0] + ' (Animations\\가.hkx)');
    assert.equal(backendText('unknown message'), 'unknown message');
  });
  inLanguage('ko', () => assert.equal(backendText('파일이 아닙니다.'), '파일이 아닙니다.'));
});
