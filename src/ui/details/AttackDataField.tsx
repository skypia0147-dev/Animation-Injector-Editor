import {useMemo, useState} from 'react';
import type {Workspace} from '../../workspace.ts';
import {attackDataLabel, attackDataOptions} from '../../attackData.ts';
import {useLanguage} from '../../i18n/index.ts';
import {Property} from './Property.tsx';
import {tr} from '../../i18n/korean.ts';

// The list's "type a name" line (no attack data has this name: it has a control character).
const TYPE = '\u0001type';

export function AttackDataField({
  w,
  value,
  change,
  override = false,
  label: customLabel,
}: {
  w: Workspace;
  value: string;
  change: (name: string) => void;
  override?: boolean;
  label?: string;
}) {
  const language = useLanguage();
  const options = useMemo(() => attackDataOptions(w, value), [w.actions, value, language]);
  // A name the list does not have (a mod race's attack data) is typed: "직접 입력…" turns the list into a field.
  const [typing, setTyping] = useState(false);
  const commit = (text: string) => {
    const name = text.trim();
    setTyping(false);
    // An invalid name is kept and reported by the check ("공격 데이터 이름이 잘못되었습니다"), not dropped.
    if (name && name !== value) change(name);
  };
  const label = customLabel ?? (override ? tr('이 HKX 공격 데이터') : tr('기본 공격 데이터'));
  return (
    <Property
      id="attackData"
      label={label}
      initial=""
      value={value}
      change={change}
      hint={tr(
        '종족에 등록된 공격 데이터를 선택합니다. 목록은 Skyrim.esm 기준이며 설치 모드·종족에 따라 달라집니다. 이름만 선택하며 피해나 타격 이벤트를 생성하지 않습니다. 기본값보다 이 HKX 설정이 우선합니다.'
      )}
    >
      {typing ? (
        <input
          aria-label={label}
          autoFocus
          defaultValue={value}
          placeholder={tr('공격 데이터 이름 (예: attackStart_MySwing)')}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setTyping(false);
          }}
        />
      ) : (
        <select
          aria-label={label}
          value={value}
          onChange={e => (e.target.value === TYPE ? setTyping(true) : change(e.target.value))}
          title={value || undefined}
        >
          <option value="">{override ? tr('기본 공격 데이터 사용') : tr('지정 안 함')}</option>
          <optgroup label={tr('인간 · 기본 게임')}>
            {options.human.map(a => (
              <option key={a.name} value={a.name} title={a.races.join(', ')}>
                {attackDataLabel(a.name)}
              </option>
            ))}
          </optgroup>
          {!!options.custom.length && (
            <optgroup label={tr('프로젝트 사용자 정의')}>
              {options.custom.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={tr('그 외 종족 · 기본 게임')}>
            {options.other.map(a => (
              <option key={a.name} value={a.name} title={a.races.join(', ')}>
                {a.name} · {a.races[0]}
                {a.races.length > 1 ? ` +${a.races.length - 1}` : ''}
              </option>
            ))}
          </optgroup>
          <option value={TYPE}>{tr('직접 입력…')}</option>
        </select>
      )}
    </Property>
  );
}
