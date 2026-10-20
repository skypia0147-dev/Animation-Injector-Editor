import {HelpTip} from '../HelpTip.tsx';
import {DetailRow} from './DetailRow.tsx';
import type {Action} from '../../workspace.ts';
import {sourceWindow, setSourceWindow} from '../../graph/clipWindows.ts';
import {TimeField} from './TimeField.tsx';
import {Property} from './Property.tsx';
import {tr} from '../../i18n/korean.ts';

export function ClipWindowFields({
  action,
  step,
  change,
  events = [],
}: {
  action: Action;
  step: string;
  change: (a: Action) => void;
  events?: string[];
}) {
  const {value} = sourceWindow(action, step);
  return (
    <div className="clip-window-fields" data-clip-window={step}>
      <div className="field-heading">
        <HelpTip
          label={tr('공통 감지 구간')}
          help={
            <>
              <p>{tr('이 HKX에서 나가는 모든 키가 같은 구간을 사용합니다. 키 카드는 키와 다음 동작만 지정합니다.')}</p>
              <p>
                {tr(
                  '주석을 따르려면 시작·종료를 ‘HKX 주석 이벤트’로 선택하고 파일에 넣은 이름을 지정하세요. 예: ComboWindowOpen / ComboWindowClose 또는 MCO_WinOpen / MCO_WinClose. 대소문자까지 일치해야 합니다.'
                )}
              </p>
              <p>
                {tr(
                  '초 단위 설정은 주석이 있어도 자동으로 바뀌지 않습니다. HKX 교체 시 새 파일에도 설정한 이벤트명이 필요합니다.'
                )}
              </p>
              <p>
                {tr(
                  '대체 시각을 끄면 이벤트만 기다립니다. 켜면 이벤트와 대체 시각 중 먼저 도달한 쪽에서 실행합니다. 예: 주석 0.8초, 대체 0.45초라면 0.45초에 열립니다.'
                )}
              </p>
              <p>
                {tr(
                  '시작 이벤트가 없으면 창이 열리지 않습니다. 종료 이벤트가 없으면 동작 종료까지 열려 있을 수 있습니다. 닫힌 창은 늦은 주석으로 다시 열리지 않습니다.'
                )}
              </p>
            </>
          }
        >
          <span className="help-tip-label">{tr('공통 감지 구간')}</span>
        </HelpTip>
      </div>
      <DetailRow label={tr('감지 시작')}>
        <TimeField
          events={events}
          label={tr('공통 감지 시작')}
          value={value.open}
          change={open => change(setSourceWindow(action, step, {...value, open}))}
        />
      </DetailRow>
      <DetailRow label={tr('감지 종료')}>
        <TimeField
          events={events}
          label={tr('공통 감지 종료')}
          bases={['end', 'event']}
          fallback="end"
          value={value.close}
          change={close => change(setSourceWindow(action, step, {...value, close}))}
        />
      </DetailRow>
      <Property
        id="buffered"
        value={value.buffered}
        change={buffered => change(setSourceWindow(action, step, {...value, buffered}))}
      />
    </div>
  );
}
