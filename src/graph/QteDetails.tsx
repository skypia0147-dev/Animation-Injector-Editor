import {useState} from 'react';
import './qteDetails.css';
import {qteMembers, uniqueQteGroup, copyQteRules, removeQteRule} from './qteGroups.ts';
import {qteAnchors, type QteAnchor} from '../qteLayout.ts';
import {qteFaceMode} from '../qteFace.ts';
import {qteTarget} from '../qtePreview.ts';
import {QtePreview} from './QtePreview.tsx';
import {QteGlyph} from './QteGlyph.tsx';
import {useClipAnnotations, clipKey, eventSenders} from './annotations.ts';
import {pairEventSenders} from './qteGraph.ts';
import type {Workspace} from '../workspace.ts';
import {
  outcomes,
  qteTypes,
  qteDesigns,
  defaultSequence,
  shownTo,
  type QteNode,
  type Outcome,
  type QteType,
  type QteDesign,
  type QteResult,
} from '../qte.ts';
import {convergeTiming, speedForApproach} from '../qteConverge.ts';
import {TimeField} from '../ui/details/TimeField.tsx';
import {KeyField} from '../ui/details/KeyField.tsx';
import {markerNames} from '../ui/details/markerCatalog.ts';
import {EventPicker} from '../ui/details/EventPicker.tsx';
import {DetailCategory, DetailPanel, DetailRow} from '../ui/details/DetailRow.tsx';
import {tr} from '../i18n/korean.ts';
import {gameControlLabel, gameControls, isGameControl} from '../keys.ts';
const names: Record<Outcome, string> = {
  get success() {
    return tr('성공');
  },
  get failure() {
    return tr('실패');
  },
  get perfect() {
    return tr('완벽');
  },
};
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
/** The converging lines' windows in milliseconds become the runtime's ratios of the whole run. A perfect window wider
 *  than the success window is kept (the rule's check names it) so typing one number never rewrites the other. */
function setWindows(q: QteNode, successSeconds: number, perfectSeconds: number) {
  const total = convergeTiming(q).total;
  q.successWindow = Math.min(0.5, Math.max(0.001, round(successSeconds / total, 5)));
  q.perfectWindow = Math.min(0.5, Math.max(0, round(perfectSeconds / total, 5)));
}
/** A number shown from the rule (seconds, milliseconds) but typed freely: while the field has the focus it keeps
 *  what was typed, an empty or partial entry included, and applies each whole number it holds. */
function DerivedNumber({
  label,
  value,
  min,
  max,
  step,
  allowZero = false,
  commit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  allowZero?: boolean;
  commit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      aria-label={label}
      value={draft ?? value}
      min={min}
      max={max}
      step={step}
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onChange={e => {
        setDraft(e.target.value);
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v) && (v > 0 || (allowZero && v === 0))) commit(v);
      }}
    />
  );
}
// The anchors on a 3×3 grid (the editor's corners and middle); the other cells stay empty.
const anchorGrid: (QteAnchor | '')[] = ['topLeft', '', 'topRight', '', 'center', '', 'bottomLeft', '', 'bottomRight'];
const typeChoices: {value: string; type: QteType; pressCount?: number; name: string}[] = [
  ...Object.entries(qteTypes).map(([type, name]) => ({value: type, type: type as QteType, name})),
  {
    value: 'press',
    type: 'rapidPress',
    pressCount: 1,
    get name() {
      return tr('E · 한 번 입력');
    },
  },
];
// The QTE's panel (10-18, docs/mockup-qte-redesign): its preview on top, then what the whole group shares and what each
// rule sets apart. A group shows the two as tabs, each naming what it changes; a lone QTE shows them one after another.
export function QteDetails({w, id, edit}: {w: Workspace; id: string; edit: (f: (w: Workspace) => Workspace) => void}) {
  const [selected, setSelected] = useState(''),
    [ownerFilter, setOwnerFilter] = useState(''),
    [query, setQuery] = useState(''),
    [tab, setTab] = useState<'common' | 'rules'>('common');
  const annotations = useClipAnnotations(w);
  const members = qteMembers(w, id);
  const q = members.find(q => q.id === selected) ?? members[0];
  if (!q) return null;
  const grouped = !!q.group;
  const owner = w.actions.find(a => a.uid === q.owner),
    pair = !!owner?.pair;
  const actionName = (uid: string) => {
    const a = w.actions.find(a => a.uid === uid);
    return a ? a.config.name || a.config.actionId : '';
  };
  const change = (f: (q: QteNode) => void) =>
    edit(w => {
      const n = structuredClone(w);
      f(n.qtes!.find(x => x.id === q.id)!);
      return n;
    });
  // A rapid press of one press shows as "한 번 입력" (qteFace.ts): its key alone for its duration.
  // Started by an event, with no HKX (runtime 0.12.248).
  const started = q.eventStart !== undefined;
  const single = qteFaceMode(q) === 'single',
    // The converging lines (splitArc design="converge") are set in seconds and milliseconds.
    converge = qteFaceMode(q) === 'converge',
    timing = convergeTiming(q);
  const common = (f: (q: QteNode) => void) =>
    edit(w => {
      const n = structuredClone(w);
      for (const q of qteMembers(n, id)) f(q);
      return n;
    });
  const sequence = (f: (q: QteNode) => void) => {
    const source = structuredClone(q);
    f(source);
    common(q => {
      q.sequence = structuredClone(source.sequence);
    });
  };
  const row = (label: string, children: React.ReactNode, hint?: string) => (
    <DetailRow label={label} hint={hint}>
      {children}
    </DetailRow>
  );
  const number = (
    key:
      | 'speed'
      | 'successWindow'
      | 'perfectWindow'
      | 'scale'
      | 'x'
      | 'y'
      | 'delay'
      | 'pressCount'
      | 'perfectBefore'
      | 'feedback',
    label: string,
    min: number,
    max: number,
    step: number,
    hint?: string
  ) =>
    row(
      label,
      <input
        type="number"
        value={q[key] ?? (key === 'pressCount' ? 10 : key === 'feedback' ? 1.35 : 0.5)}
        min={min}
        max={max}
        step={step}
        onChange={e =>
          common(q => {
            q[key] = e.target.valueAsNumber;
          })
        }
      />,
      hint
    );
  const roleName = (m: QteNode) =>
    ({partner: tr('피해자'), self: tr('가해자'), player: tr('플레이어')})[shownTo(m, pair)];
  const startName = (m: QteNode) =>
    m.eventStart !== undefined
      ? tr('이벤트 {v0}', {v0: m.eventStart || tr('미지정')})
      : m.at.basis === 'event'
        ? m.at.event || tr('이벤트 미지정')
        : tr('{seconds}초', {seconds: m.at.seconds});
  const resultName = (r: QteResult) =>
    r.mode === 'event'
      ? `⚡ ${r.event || tr('이벤트 미지정')}`
      : r.mode === 'transition'
        ? `→ ${actionName(r.to) || tr('동작 미지정')}`
        : tr('계속');

  // ── What the whole group shares ──
  const typeValue = single ? 'press' : (q.type ?? 'splitArc');
  const shape = (
    <DetailCategory title={tr('QTE · 모양과 입력')} initialOpen>
      <div className="qte-types" role="group" aria-label={tr('QTE 유형')}>
        {typeChoices.map(c => (
          <button
            key={c.value}
            type="button"
            aria-pressed={typeValue === c.value}
            onClick={() =>
              common(q => {
                // One press is a rapid press of one press (XML type="rapidPress" pressCount="1").
                if (c.value === 'press') {
                  q.type = 'rapidPress';
                  q.pressCount = 1;
                  delete q.design;
                  return;
                }
                if (c.value === 'rapidPress' && (q.pressCount ?? 10) === 1) q.pressCount = 10;
                q.type = c.type;
                if (q.type !== 'splitArc') delete q.design;
                if (q.type === 'keySequence') delete q.control;
                if (q.type === 'keySequence' && !q.sequence) q.sequence = defaultSequence();
              })
            }
          >
            <QteGlyph type={c.type} pressCount={c.pressCount ?? 10} size={30} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
      {row(
        tr('화면 표시'),
        <label className="qte-hidden-toggle">
          <input
            type="checkbox"
            aria-label={tr('QTE 화면에 표시하지 않음')}
            checked={!!q.hidden}
            onChange={e =>
              common(q => {
                if (e.target.checked) q.hidden = true;
                else delete q.hidden;
              })
            }
          />
          {tr('표시하지 않음')}
        </label>,
        q.hidden
          ? tr(
              '게임에서는 아무것도 그리지 않고 입력만 받습니다. 결과 효과음과 결과 동작은 그대로입니다. 판정 뒤 결과 표시 시간 없이 바로 끝납니다.'
            )
          : tr('한 번 입력·연타를 화면 안내 없이 애니메이션 연출로 쓸 때 켭니다.')
      )}
      {(q.type ?? 'splitArc') === 'splitArc' &&
        row(
          tr('디자인'),
          <div className="qte-seg" role="group" aria-label={tr('QTE 디자인')}>
            {Object.entries(qteDesigns).map(([key, name]) => (
              <button
                key={key}
                type="button"
                aria-pressed={(q.design ?? 'circle') === key}
                onClick={() =>
                  common(q => {
                    if ((key as QteDesign) === 'circle') {
                      delete q.design;
                      return;
                    }
                    if (q.design === 'converge') return;
                    q.design = 'converge';
                    // The design's own timing: the lines meet after 1.4 s, success ±150 ms, perfect ±60 ms.
                    q.speed = round(speedForApproach(1.4), 4);
                    setWindows(q, 0.15, 0.06);
                    q.feedback = 1.2;
                    // Below the middle, where the design sits, while the rule is still in the middle.
                    if (q.anchor === 'center' && q.y === 0) q.y = 0.15;
                  })
                }
              >
                {name}
              </button>
            ))}
          </div>,
          tr(
            '수렴선: 화면 양 끝에서 두 선이 모여 가운데서 만나는 순간에 누릅니다. 성공 허용이 지나면 바로 실패합니다. 결과 때 화면이 흔들리고, 실패하면 잠깐 흑백이 됩니다.'
          )
        )}
      {q.type !== 'keySequence' &&
        row(
          tr('입력 방식'),
          <select
            value={q.control ?? 'key'}
            onChange={e =>
              common(q => {
                q.control = isGameControl(e.target.value) ? e.target.value : undefined;
              })
            }
          >
            <option value="key">{tr('키·컨트롤러 직접 지정')}</option>
            <optgroup label={tr('게임 동작 (게임 설정)')}>
              {gameControls.map(c => (
                <option key={c} value={c}>
                  {gameControlLabel(c)}
                </option>
              ))}
            </optgroup>
          </select>,
          tr(
            'QTE가 열릴 때 그 게임 동작에 묶인 키를 조회합니다. 키보드·마우스·게임패드 재설정을 따르고, 화면에는 마지막으로 쓴 장치의 키만 보입니다. 미리보기는 게임 기본 키로 보입니다.'
          )
        )}
      {q.control ? null : q.type !== 'keySequence' ? (
        <KeyField
          labeled
          value={q.key}
          change={key =>
            common(q => {
              q.key = key;
            })
          }
          gamepad={q.gamepad}
          changeGamepad={gamepad =>
            common(q => {
              q.gamepad = gamepad;
            })
          }
        />
      ) : (
        <div aria-label={tr('QTE 순서 입력 목록')}>
          {(q.sequence ?? []).map((key, i) => (
            <div key={i} style={{borderBottom: '1px solid var(--ue-line)', padding: '8px 0'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <b>
                  {i + 1}
                  {tr('번 입력')}
                </b>
                <span>
                  <button
                    title={tr('앞으로 이동')}
                    disabled={i === 0}
                    onClick={() =>
                      sequence(q => {
                        [q.sequence![i - 1], q.sequence![i]] = [q.sequence![i], q.sequence![i - 1]];
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    title={tr('뒤로 이동')}
                    disabled={i === (q.sequence?.length ?? 0) - 1}
                    onClick={() =>
                      sequence(q => {
                        [q.sequence![i + 1], q.sequence![i]] = [q.sequence![i], q.sequence![i + 1]];
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    title={tr('입력 삭제')}
                    disabled={(q.sequence?.length ?? 0) <= 2}
                    onClick={() =>
                      sequence(q => {
                        q.sequence!.splice(i, 1);
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              </div>
              <KeyField
                labeled
                value={key.key}
                gamepad={key.gamepad}
                change={key =>
                  sequence(q => {
                    q.sequence![i].key = key;
                  })
                }
                changeGamepad={gamepad =>
                  sequence(q => {
                    q.sequence![i].gamepad = gamepad;
                  })
                }
              />
            </div>
          ))}
          <button
            disabled={(q.sequence?.length ?? 0) >= 8}
            onClick={() =>
              sequence(q => {
                (q.sequence ??= []).push({key: 'E', gamepad: 0});
              })
            }
          >
            {tr('+ 입력 추가')}
          </button>
        </div>
      )}
      {q.type === 'rapidPress' &&
        !single &&
        number(
          'pressCount',
          tr('목표 연타 횟수'),
          1,
          100,
          1,
          tr('키를 놓고 다시 누른 횟수만 셉니다. 길게 누르기는 연타가 아닙니다.')
        )}
    </DetailCategory>
  );
  // The windows as a bar: where the press is right, the success and perfect spans around it (ratios of the run).
  const bar = converge
    ? {
        center: timing.approach / timing.total,
        ok: timing.success / timing.total,
        perfect: timing.perfect / timing.total,
      }
    : single || q.type === 'rapidPress' || q.type === 'keySequence'
      ? undefined
      : {center: qteTarget, ok: q.successWindow, perfect: q.perfectWindow};
  const span = (half: number) => ({
    left: `${Math.max(0, (bar!.center - half) * 100)}%`,
    width: `${Math.min(100, half * 200)}%`,
  });
  const judgment = (
    <DetailCategory title={tr('QTE · 판정')} initialOpen>
      {bar && (
        <div className="qte-timing" aria-label={tr('판정 구간')}>
          <div className="qte-timing-bar">
            <i className="ok" style={span(bar.ok)} />
            <i className="perfect" style={span(bar.perfect)} />
            <i className="mark" style={{left: `${bar.center * 100}%`}} />
          </div>
          <div className="qte-timing-legend">
            <span>
              <i className="ok" />
              {tr('성공 구간')}
            </span>
            <span>
              <i className="perfect" />
              {tr('완벽 구간')}
            </span>
            <span>{tr('세로선: 정확한 입력 시점')}</span>
          </div>
        </div>
      )}
      {converge && (
        <>
          {row(
            tr('접근 시간 (초)'),
            <DerivedNumber
              label={tr('QTE 접근 시간')}
              value={round(timing.approach, 2)}
              min={0.3}
              max={10}
              step={0.1}
              commit={seconds =>
                common(q => {
                  // The windows keep their milliseconds.
                  const before = convergeTiming(q);
                  q.speed = round(speedForApproach(seconds), 4);
                  setWindows(q, before.success, before.perfect);
                })
              }
            />,
            tr('두 선이 화면 끝에서 출발해 가운데서 만나기까지의 시간입니다. 만나는 순간이 정확한 입력 시점입니다.')
          )}
          {row(
            tr('성공 허용 (±ms)'),
            <DerivedNumber
              label={tr('QTE 성공 허용')}
              value={Math.round(timing.success * 1000)}
              min={1}
              max={1000}
              step={10}
              commit={ms =>
                common(q => {
                  setWindows(q, ms / 1000, convergeTiming(q).perfect);
                })
              }
            />,
            tr('만나는 순간 앞뒤로 이만큼 안에 누르면 성공입니다. 이 시간이 지나면 바로 실패합니다.')
          )}
          {row(
            tr('완벽 허용 (±ms)'),
            <DerivedNumber
              label={tr('QTE 완벽 허용')}
              value={Math.round(timing.perfect * 1000)}
              min={0}
              max={1000}
              step={10}
              allowZero
              commit={ms =>
                common(q => {
                  setWindows(q, convergeTiming(q).success, ms / 1000);
                })
              }
            />,
            tr('0이면 완벽 판정을 끕니다. 성공 허용보다 넓을 수 없습니다.')
          )}
        </>
      )}
      {converge
        ? null
        : single
          ? row(
              tr('지속시간 (초)'),
              <DerivedNumber
                label={tr('QTE 지속시간')}
                value={Math.round((2.4 / (q.speed || 1)) * 100) / 100}
                min={0.25}
                max={24}
                step={0.25}
                commit={seconds =>
                  common(q => {
                    // The runtime's clock: 2.4 s at speed 1.
                    q.speed = Math.min(10, Math.max(0.1, Math.round((2.4 / seconds) * 10000) / 10000));
                  })
                }
              />,
              tr('키가 이 시간 동안 보입니다. 그 안에 누르면 입력 효과와 함께 사라지고, 누르지 않으면 그냥 사라집니다.')
            )
          : number(
              'speed',
              tr('진행 속도'),
              0.1,
              10,
              0.1,
              tr(
                '모든 유형은 1×에서 제한 시간 2.4초입니다. 홀드는 누른 순간부터 게이지가 차며 전체 제한 시간 안에 놓아야 합니다.'
              )
            )}
      {single || converge ? null : q.type === 'rapidPress' || q.type === 'keySequence' ? (
        number(
          'perfectBefore',
          tr('완벽 완료 기준'),
          0,
          1,
          0.05,
          tr('제한 시간의 이 비율 이내에 모두 완료하면 완벽입니다. 기본 0.5는 절반 이내, 0은 완벽 판정 끄기입니다.')
        )
      ) : (
        <>
          {number(
            'successWindow',
            tr('성공 허용 폭'),
            0.001,
            0.5,
            0.005,
            tr('전체 제한 시간에 대한 비율입니다. 기본 ±8.5%.')
          )}
          {number('perfectWindow', tr('완벽 허용 폭'), 0, 0.5, 0.001, tr('기본 ±2.6%. 0이면 완벽 판정을 끕니다.'))}
        </>
      )}
    </DetailCategory>
  );
  const anchored = !!q.anchor && q.anchor !== 'screen';
  const setAnchor = (anchor: QteAnchor) =>
    common(q => {
      q.anchor = anchor;
      // The screen position is a ratio of the screen (its middle is 0.5); a corner's is a gap from it.
      q.x = q.y = q.anchor === 'screen' ? 0.5 : 0;
    });
  const screen = (
    <DetailCategory title={tr('QTE · 화면')} initialOpen>
      {row(
        tr('기준점'),
        <div className="qte-anchor">
          <div className="qte-anchor-grid" role="group" aria-label={tr('QTE 기준점')}>
            {anchorGrid.map((a, i) =>
              a ? (
                <button
                  key={i}
                  type="button"
                  aria-label={qteAnchors[a as keyof typeof qteAnchors]}
                  title={qteAnchors[a as keyof typeof qteAnchors]}
                  aria-pressed={q.anchor === a}
                  onClick={() => setAnchor(a)}
                />
              ) : (
                <span key={i} />
              )
            )}
          </div>
          <button type="button" aria-pressed={!anchored} onClick={() => setAnchor('screen')}>
            {tr('화면 비율')}
          </button>
        </div>,
        tr(
          '중앙 또는 모서리를 기준으로 배치합니다. "화면 비율"은 화면 비율(0~100%, 가운데 50%)로 둡니다(런타임 기본값). 기준점을 바꾸면 위치를 처음 값으로 되돌립니다. 위 미리보기에서 QTE를 끌어 옮길 수도 있습니다.'
        )
      )}
      {row(
        tr('크기 배율'),
        <div className="qte-scale">
          <input
            type="range"
            aria-label={tr('QTE 크기 배율')}
            min={0.25}
            max={4}
            step={0.05}
            value={q.scale}
            onChange={e =>
              common(q => {
                q.scale = e.target.valueAsNumber;
              })
            }
          />
          <input
            type="number"
            aria-label={tr('QTE 크기 배율 값')}
            min={0.25}
            max={4}
            step={0.05}
            value={q.scale}
            onChange={e =>
              common(q => {
                q.scale = e.target.valueAsNumber;
              })
            }
          />
        </div>,
        tr('화면 높이에 비례하여 크기가 자동 조절됩니다. 해상도마다 설정할 필요가 없습니다.')
      )}
      {row(
        anchored ? tr('간격 가로·세로 (%)') : tr('위치 가로·세로 (%)'),
        <div className="qte-pair">
          {(['x', 'y'] as const).map(axis => (
            <input
              key={axis}
              type="number"
              aria-label={axis === 'x' ? tr('가로 간격 (%)') : tr('세로 간격 (%)')}
              min={anchored ? -100 : 0}
              max={100}
              step={1}
              value={Math.round(q[axis] * 10000) / 100}
              onChange={e =>
                common(q => {
                  q[axis] = e.target.valueAsNumber / 100;
                })
              }
            />
          ))}
        </div>,
        anchored
          ? tr(
              '화면 높이 대비 간격입니다. 중앙에서는 양수가 오른쪽·아래쪽, 모서리에서는 양수가 화면 안쪽입니다. 가장자리에서는 잘리지 않도록 보정합니다.'
            )
          : tr('화면 비율입니다. 기준점을 선택하면 기준점에서의 간격으로 변경됩니다.')
      )}
    </DetailCategory>
  );
  const shown = outcomes.filter(k => !single || k !== 'perfect');
  const outcomeName = (k: Outcome) =>
    single ? {success: tr('눌렀을 때'), failure: tr('누르지 않았을 때'), perfect: ''}[k] : names[k];
  const effects = (
    <DetailCategory title={tr('효과음 · 결과 표시')}>
      {shown.map(k =>
        row(
          tr('{v0} 소리', {v0: outcomeName(k)}),
          <div className="qte-pair">
            <input
              aria-label={tr('{v0} 사운드 플러그인', {v0: outcomeName(k)})}
              value={q.results[k].soundPlugin ?? ''}
              placeholder={tr('플러그인 (FH_Grapple.esp)')}
              onChange={e =>
                common(q => {
                  q.results[k].soundPlugin = e.target.value;
                })
              }
            />
            <input
              aria-label={tr('{v0} 사운드 Form ID', {v0: outcomeName(k)})}
              value={q.results[k].soundForm ?? ''}
              placeholder="Form ID (822)"
              onChange={e =>
                common(q => {
                  q.results[k].soundForm = e.target.value;
                })
              }
            />
          </div>,
          tr(
            '기존 ESP/ESL의 Sound Descriptor를 사용합니다(WAV 경로가 아닙니다). Form ID는 플러그인 내부 16진수 ID입니다. 완벽 소리가 비어 있으면 성공 소리를 사용합니다.'
          )
        )
      )}
      {!single &&
        number(
          'feedback',
          tr('결과 표시 시간'),
          0.05,
          10,
          0.05,
          tr('결과 효과를 표시하는 시간입니다. 전환 지연보다 짧으면 전환 시점까지 표시합니다.')
        )}
    </DetailCategory>
  );
  const advanced = (
    <DetailCategory title={tr('고급 · 채널, 연속 단계, 지연')}>
      {row(
        tr('채널'),
        <select
          aria-label={tr('QTE 채널')}
          value={q.channel ?? 0}
          onChange={e =>
            common(q => {
              q.channel = Number(e.target.value) || undefined;
            })
          }
        >
          {[0, 1, 2, 3].map(c => (
            <option key={c} value={c}>
              {c === 0 ? tr('0 (기본)') : c}
            </option>
          ))}
        </select>,
        tr(
          '채널이 다른 QTE는 같은 시각에 함께 뜨고, 각자 자기 키만 받습니다. 같은 채널에서는 먼저 뜬 QTE가 진행되는 동안 뒤 QTE를 띄우지 않습니다.'
        )
      )}
      {!started &&
        row(
          tr('연속 단계 교체'),
          <input
            type="checkbox"
            checked={!!q.replaceActive}
            onChange={e =>
              common(q => {
                q.replaceActive = e.target.checked;
              })
            }
          />,
          tr('같은 동작의 다음 QTE가 이전 단계를 교체합니다. 애니메이션 전환 결과를 기다리는 동안은 교체하지 않습니다.')
        )}
      {row(
        tr('효과 움직임 축소'),
        <input
          type="checkbox"
          checked={q.reducedMotion}
          onChange={e =>
            common(q => {
              q.reducedMotion = e.target.checked;
            })
          }
        />
      )}
      {number(
        'delay',
        tr('결과 실행 지연'),
        0,
        10,
        0.05,
        tr('0이면 판정 즉시 실행합니다. 결과 효과의 재생 시간과 무관합니다.')
      )}
    </DetailCategory>
  );

  // An event's QTE (docs/mockup-qte-redesign/event-qte-pair-aware, runtime 0.12.264): the pairs whose HKX send its
  // event, read from their annotations. It shows in all of them, to the player in the role that receives the event.
  const pairSenders =
    started && q.eventStart
      ? pairEventSenders(w, clip => {
          const list = annotations.get(clipKey(clip));
          return list && eventSenders(list, q.eventStart!);
        })
      : [];
  const pairSent = pairSenders.length > 0 && (
    <div className="qte-senders">
      <b>{tr('이 이벤트를 보내는 HKX')}</b>
      <ul>
        {pairSenders.map(s => (
          <li key={s.action + s.role}>
            {actionName(s.action)}{' '}
            <small>
              ({s.role === 'partner' ? tr('피해자') : tr('가해자')} {tr('클립 →')}{' '}
              {s.role === 'partner' ? tr('피해자') : tr('가해자')}
              {tr('가 플레이어일 때 뜸)')}
            </small>
          </li>
        ))}
      </ul>
      <small>
        {tr('HKX 주석에서 읽은 안내입니다. 따로 연결할 필요는 없습니다. 페어 중이면 결과의 상대 줄도 씁니다.')}
      </small>
    </div>
  );
  const ownerName = {
    player: tr('어느 역할이든'),
    self: tr('가해자가 플레이어일 때'),
    partner: tr('피해자가 플레이어일 때'),
  };
  // ── What one rule sets apart ──
  // The HKX's own annotations say who sends the start event (desktop only, where the HKX is read): a QTE that
  // listens to the other actor never opens (10-19, Grapple: "Grapple_Stage_Start_02" comes from the victim's clip).
  const clip = owner?.config.steps.find(s => s.id === (q.step || owner.config.entry))?.clip;
  const list = clip ? annotations.get(clipKey(clip)) : undefined;
  const senders = list && q.at.basis === 'event' ? eventSenders(list, q.at.event) : undefined;
  const heard =
    !senders?.size ||
    (q.eventSource === 'both' ? true : q.eventSource === 'partner' ? senders.has('partner') : senders.has('self'));
  const senderHint = senders && senders.size > 0 && !heard && (
    <div className="qte-sender-hint" role="alert">
      <span>
        {tr('이 이벤트는 HKX에서')} {senders.has('partner') ? tr('피해자') : tr('가해자')}{' '}
        {tr('쪽만 보냅니다. 지금 발신자 설정으로는 이 QTE가 뜨지 않습니다.')}
      </span>
      <button
        type="button"
        onClick={() =>
          change(q => {
            q.eventSource =
              senders.has('partner') && senders.has('self') ? 'both' : senders.has('partner') ? 'partner' : 'self';
          })
        }
      >
        {tr('발신자를')} {senders.has('partner') ? tr('피해자') : tr('가해자')}
        {tr('로')}
      </button>
    </div>
  );
  const start = (
    <DetailCategory title={grouped ? tr('QTE · 이 규칙의 시작') : tr('QTE · 시작')} initialOpen>
      {row(
        tr('이름'),
        <input
          value={q.name}
          onChange={e =>
            change(q => {
              q.name = e.target.value;
            })
          }
        />
      )}
      {row(
        'ID',
        <input
          aria-label="QTE ID"
          placeholder={q.id}
          value={q.xmlId ?? ''}
          onChange={e =>
            change(x => {
              const value = e.target.value.trim();
              if (value) x.xmlId = value;
              else delete x.xmlId;
            })
          }
        />,
        tr(
          'XML의 QTE id입니다. 결과 이벤트 이름(AI_<동작>_QTE_<ID>_Success 등)에 쓰입니다. 비우면 자동 이름({id})을 씁니다. "이름"은 에디터 표시용입니다.',
          {id: q.id}
        )
      )}
      {!grouped &&
        row(
          tr('시작'),
          <select
            aria-label={tr('QTE 시작 방식')}
            value={started ? 'event' : 'hkx'}
            onChange={e =>
              change(q => {
                if (e.target.value === 'hkx') {
                  delete q.eventStart;
                  q.inputOwner = 'sender';
                  return;
                }
                // An event's QTE (runtime 0.12.248): no HKX, the player's input; a result sends an event or
                // starts an ordinary action (0.12.249), never a partner's.
                q.eventStart = q.eventStart ?? '';
                q.owner = '';
                q.step = '';
                q.inputOwner = 'player';
              })
            }
          >
            <option value="hkx">{tr('HKX에서 (재생 중 시점)')}</option>
            <option value="event">{tr('이벤트에서 (HKX 없이)')}</option>
          </select>,
          tr(
            '이벤트에서: 그 이벤트가 오면 바로 뜨고 래그돌 중에도 취소되지 않습니다(엔진이 보내는 요청 이벤트도 받습니다). 결과는 이벤트 발생 또는 애니메이션 전환(일반 동작). 쓰러져 일어나는 중이면 엔진이 몸을 넘겨받는 순간 그 동작이 엔진 기상 대신 재생됩니다.'
          )
        )}
      {pairSent}
      {started ? (
        row(
          tr('시작 이벤트'),
          <EventPicker
            label={tr('QTE 시작 이벤트')}
            empty={tr('이벤트 선택')}
            value={q.eventStart ?? ''}
            events={markerNames(w)}
            change={event =>
              change(q => {
                q.eventStart = event;
              })
            }
          />
        )
      ) : (
        <TimeField
          label={tr('QTE 시작')}
          value={q.at}
          change={at =>
            change(q => {
              q.at = at;
            })
          }
          events={markerNames(w)}
        />
      )}
      {row(
        tr('종료 이벤트'),
        <EventPicker
          label={tr('종료 이벤트')}
          empty={tr('없음')}
          value={q.stopEvent ?? ''}
          events={markerNames(w)}
          change={event =>
            change(q => {
              q.stopEvent = event;
            })
          }
        />,
        tr('이벤트를 받으면 진행 중 QTE와 결과 대기를 취소합니다. 실패 결과를 실행하지 않습니다.')
      )}
      {pair && q.at.basis === 'event' && senderHint}
      {pair &&
        q.at.basis === 'event' &&
        row(
          tr('이벤트 발신자'),
          <select
            value={q.eventSource}
            onChange={e =>
              change(q => {
                q.eventSource = e.target.value as QteNode['eventSource'];
              })
            }
          >
            <option value="self">{tr('가해자')}</option>
            <option value="partner">{tr('피해자')}</option>
            <option value="both">{tr('어느 쪽이든')}</option>
          </select>
        )}
      {pair &&
        row(
          tr('입력 담당'),
          <select
            aria-label={tr('QTE 입력 담당')}
            value={q.inputOwner}
            onChange={e =>
              change(q => {
                q.inputOwner = e.target.value as QteNode['inputOwner'];
              })
            }
          >
            <option value="sender">
              {q.at.basis === 'event'
                ? tr('이벤트 발신자를 따름 ({v0})', {v0: ownerName[shownTo({...q, inputOwner: 'sender'}, true)]})
                : tr('기본 (어느 역할이든)')}
            </option>
            <option value="player">{tr('플레이어 (어느 역할이든)')}</option>
            <option value="self">{tr('가해자가 플레이어일 때')}</option>
            <option value="partner">{tr('피해자가 플레이어일 때')}</option>
          </select>,
          q.at.basis === 'event'
            ? tr(
                '기본값이면 이벤트를 보내는 역할이 플레이어일 때만 QTE가 뜹니다. 발신자가 「어느 쪽이든」이면 역할과 상관없이 뜹니다.'
              )
            : undefined
        )}
    </DetailCategory>
  );
  // A result per box (docs/mockup-qte-redesign/pair-results): its outcome and how it goes on as three buttons, then a
  // row per role under it, each with a wide list: a pair's transition the attacker's and the victim's actions, an
  // event its name and who receives it.
  const modeNames = (k: Outcome) =>
    [
      ['continue', k === 'perfect' ? tr('성공 경로') : tr('계속')],
      ['event', tr('⚡ 이벤트')],
      ['transition', tr('→ 전환')],
    ] as const;
  const results = (
    <DetailCategory title={grouped ? tr('QTE · 이 규칙의 결과') : tr('QTE · 결과')} initialOpen>
      <div className="qte-results">
        {shown.map(k => {
          const r = q.results[k];
          return (
            <div key={k} className={'qte-result tone-' + k}>
              <header>
                <em>{outcomeName(k)}</em>
                <div className="qte-seg" role="group" aria-label={tr('{v0} 결과 방식', {v0: outcomeName(k)})}>
                  {modeNames(k).map(([mode, name]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-label={tr('{v0} 결과: {name}', {v0: outcomeName(k), name})}
                      aria-pressed={r.mode === mode}
                      onClick={() =>
                        change(q => {
                          q.results[k].mode = mode;
                        })
                      }
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </header>
              {r.mode === 'event' ? (
                <>
                  <label className="qte-role-field event">
                    <span>{tr('이벤트')}</span>
                    <input
                      aria-label={tr('{v0} 이벤트', {v0: outcomeName(k)})}
                      value={r.event}
                      placeholder="Grapple_QTE_Stage01"
                      onChange={e =>
                        change(q => {
                          q.results[k].event = e.target.value;
                        })
                      }
                    />
                  </label>
                  {pair && (
                    <label className="qte-role-field event">
                      <span>{tr('받는 쪽')}</span>
                      <select
                        aria-label={tr('{v0} 전달 대상', {v0: outcomeName(k)})}
                        value={r.recipient}
                        onChange={e =>
                          change(q => {
                            q.results[k].recipient = e.target.value as QteResult['recipient'];
                          })
                        }
                      >
                        <option value="self">{tr('가해자')}</option>
                        <option value="partner">{tr('피해자')}</option>
                        <option value="both">{tr('양쪽')}</option>
                      </select>
                    </label>
                  )}
                </>
              ) : r.mode === 'transition' ? (
                <>
                  <label className={'qte-role-field ' + (started ? 'player' : pair ? 'attacker' : 'next')}>
                    <span>{started ? tr('플레이어') : pair ? tr('가해자') : tr('다음 동작')}</span>
                    <select
                      aria-label={`${outcomeName(k)} ${started ? tr('플레이어 동작') : pair ? tr('가해자 동작') : tr('다음 동작')}`}
                      value={r.to}
                      onChange={e =>
                        change(q => {
                          q.results[k].to = e.target.value;
                        })
                      }
                    >
                      <option value="">{tr('동작을 고르세요')}</option>
                      {w.actions
                        .filter(a => !started || !a.pair)
                        .map(a => (
                          <option key={a.uid} value={a.uid}>
                            {a.config.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {(pair || started) && (
                    <label className={'qte-role-field ' + (started ? 'partner' : 'victim')}>
                      <span>{started ? tr('상대') : tr('피해자')}</span>
                      <select
                        aria-label={`${outcomeName(k)} ${started ? tr('상대 동작') : tr('피해자 동작')}`}
                        value={r.partnerTo}
                        onChange={e =>
                          change(q => {
                            q.results[k].partnerTo = e.target.value;
                          })
                        }
                      >
                        <option value="">{started ? tr('지정 안 함') : tr('그대로 (하던 페어 계속)')}</option>
                        {w.actions
                          .filter(a => !a.pair)
                          .map(a => (
                            <option key={a.uid} value={a.uid}>
                              {a.config.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </>
              ) : (
                <p className="qte-result-none">
                  {k === 'perfect'
                    ? tr('성공 결과를 그대로 씁니다.')
                    : pair
                      ? tr('페어를 그대로 재생합니다.')
                      : tr('동작을 그대로 재생합니다.')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </DetailCategory>
  );
  const addRule = () =>
    edit(w => {
      const n = structuredClone(w),
        rules = qteMembers(n, id),
        group = rules[0].group ?? uniqueQteGroup(n, tr('QTE 규칙'));
      for (const r of rules) r.group = group;
      const next = copyQteRules(n, [q], group, q.owner)[0];
      next.name = q.name + tr(' 복사');
      return n;
    });
  // A group's rules as a table: which action, from which moment, whose input, and where success and failure go.
  const owners = [...new Set(members.map(m => m.owner))];
  const listed = members.filter(
    m =>
      (!ownerFilter || m.owner === ownerFilter) &&
      (!query ||
        `${actionName(m.owner)} ${startName(m)} ${resultName(m.results.success)} ${resultName(m.results.failure)} ${m.name}`
          .toLowerCase()
          .includes(query.toLowerCase()))
  );
  const rules = (
    <div className="qte-rules">
      <div className="qte-rules-tools">
        <input
          aria-label={tr('QTE 규칙 찾기')}
          placeholder={tr('시작 이벤트·결과로 찾기')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="button" onClick={addRule}>
          {tr('선택 규칙 복제')}
        </button>
        <button
          type="button"
          disabled={members.length <= 1}
          onClick={() => {
            setSelected('');
            edit(w => removeQteRule(w, id, q.id));
          }}
        >
          {tr('삭제')}
        </button>
      </div>
      {owners.length > 1 && (
        <div className="qte-chips" role="group" aria-label={tr('동작별로 보기')}>
          {['', ...owners].map(o => (
            <button key={o || 'all'} type="button" aria-pressed={ownerFilter === o} onClick={() => setOwnerFilter(o)}>
              {o ? actionName(o) || tr('연결 전') : tr('전체')} ·{' '}
              {o ? members.filter(m => m.owner === o).length : members.length}
            </button>
          ))}
        </div>
      )}
      <div className="qte-rules-table">
        <table>
          <thead>
            <tr>
              <th>{tr('동작')}</th>
              <th>{tr('시작')}</th>
              {pair && <th>{tr('입력')}</th>}
              <th>{tr('성공')}</th>
              <th>{tr('실패')}</th>
            </tr>
          </thead>
          <tbody>
            {listed.map(m => (
              <tr
                key={m.id}
                tabIndex={0}
                aria-selected={m.id === q.id}
                onClick={() => setSelected(m.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(m.id);
                  }
                }}
              >
                <td>{actionName(m.owner) || tr('연결 전')}</td>
                <td>{startName(m)}</td>
                {pair && <td>{roleName(m)}</td>}
                <td className={'tone-' + m.results.success.mode}>{resultName(m.results.success)}</td>
                <td className={'tone-' + m.results.failure.mode}>{resultName(m.results.failure)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!listed.length && <p className="qte-rules-empty">{tr('찾는 규칙이 없습니다.')}</p>}
      </div>
    </div>
  );
  const ruleCount = members.length,
    actionCount = new Set(members.filter(m => m.owner).map(m => m.owner)).size;
  return (
    <DetailPanel>
      <div className="qte-top">
        <QtePreview
          q={q}
          move={(x, y) =>
            common(q => {
              q.x = x;
              q.y = y;
            })
          }
        />
        {grouped && (
          <p className="qte-top-note">
            {tr('묶음 ·')} {actionCount}
            {tr('개 동작 ·')} {ruleCount}
            {tr('개 규칙 · 미리보기를 끌어 위치를 옮깁니다')}
          </p>
        )}
      </div>
      {grouped ? (
        <>
          <div className="qte-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'common'} onClick={() => setTab('common')}>
              {tr('공통 설정')}
              <small>
                {ruleCount}
                {tr('개 규칙 모두')}
              </small>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'rules'} onClick={() => setTab('rules')}>
              {tr('규칙별 설정')}
              <small>{tr('시작 · 역할 · 결과')}</small>
            </button>
          </div>
          {tab === 'common' ? (
            <>
              <p className="qte-scope">
                {tr('여기서 바꾸면 이 묶음의')} {ruleCount}
                {tr('개 규칙에 모두 적용됩니다.')}
              </p>
              {row(
                tr('묶음 이름'),
                <input
                  value={q.group}
                  onChange={e =>
                    common(q => {
                      q.group = e.target.value || undefined;
                    })
                  }
                />
              )}
              {shape}
              {judgment}
              {screen}
              {effects}
              {advanced}
            </>
          ) : (
            <>
              {rules}
              <p className="qte-scope rule">
                {tr('고른 규칙 하나:')} {actionName(q.owner) || tr('연결 전')} · {startName(q)} · {q.name}
              </p>
              {start}
              {results}
            </>
          )}
        </>
      ) : (
        <>
          {shape}
          {judgment}
          {screen}
          {start}
          {results}
          {!started && (
            <div className="qte-rules-tools">
              <button type="button" onClick={addRule}>
                {tr('+ 규칙 추가 (같은 설정으로 다른 시점·결과)')}
              </button>
            </div>
          )}
          {effects}
          {advanced}
        </>
      )}
    </DetailPanel>
  );
}
