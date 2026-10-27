import type {Workspace} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import {sourceWindow} from './clipWindows.ts';
import {timingLabel} from '../model.ts';
import {exitSummary} from '../ui/details/inspectorModel.ts';
import {qteMembers} from './qteGroups.ts';
import {outcomes, qteTypes, type Outcome, type QteDesign, type QteResult, type QteType} from '../qte.ts';
import {qteKeyName} from '../qteFace.ts';
import {tr} from '../i18n/korean.ts';
import {gamepadXml, gameControlLabel} from '../keys.ts';
import {choosesOrdinary, frontAngle, frontRange} from '../cards.ts';

export const cardWidth = (n: Pick<FlatNode, 'kind'>) =>
  n.kind === 'entry'
    ? 112
    : n.kind === 'eventRegistry'
      ? 540
      : n.kind === 'hkxPlay'
        ? 380
        : n.kind === 'conditionCard'
          ? 340
          : 260;
export const pinTop = (n: Pick<FlatNode, 'kind'>) => (n.kind === 'entry' ? 34 : 54);
export const cardHeight = (n: Pick<FlatNode, 'kind' | 'inputs' | 'outputs'> & {measured?: {height?: number}}) =>
  n.measured?.height ??
  (n.kind === 'entry'
    ? 68
    : n.kind === 'qte'
      ? // Its face (look, type, input, start) and a route row per result (cardPresentation qteFace, 10-18).
        Math.max(150, 112 + n.outputs.length * 30)
      : Math.max(n.kind === 'hkxPlay' ? 160 : 128, pinTop(n) + Math.max(n.inputs.length, n.outputs.length) * 24 + 12));
/** A collapsed HKX card (summary view, docs/mockup-arrange): file, kind and view, the features in use. Taller
 *  only when its pins need the room; arrange places HKX cards at this height while summaries are shown. */
export const SUMMARY_HEIGHT = 224; // 196 + the "시작" row (10-20)
export const summaryHeight = (n: Pick<FlatNode, 'kind' | 'inputs' | 'outputs'>) =>
  Math.max(SUMMARY_HEIGHT, pinTop(n) + Math.max(n.inputs.length, n.outputs.length) * 24 + 12);
/** A QTE card's face (10-18, docs/mockup-qte-redesign): its look, its key, how it starts, and a group's size. */
export type QteFace = {
  type: QteType;
  design?: QteDesign;
  pressCount: number;
  key: string;
  typeName: string;
  input: string;
  start: string;
  rules: number;
  /** A lone QTE's results, each drawn as its outcome's row and the rows of who goes where (docs/mockup-qte-redesign/
   *  pair-results): a pair's transition has the attacker's and the victim's rows. A group's rules differ: none. */
  results?: {
    k: Outcome;
    mode: QteResult['mode'];
    recipient: QteResult['recipient'];
    event: string;
    pair: boolean;
    /** An event's QTE (runtime 0.12.264): its two rows are the player's and the partner's. */
    player: boolean;
  }[];
};
export type CardPresentation = {title: string; icon: string; rows: {label: string; value: string}[]; qte?: QteFace};
function qteFace(w: Workspace, n: FlatNode): QteFace | undefined {
  const members = qteMembers(w, n.id),
    q = members[0];
  if (!q) return undefined;
  const events = [...new Set(members.filter(m => m.at.basis === 'event').map(m => m.at.event))].filter(Boolean),
    times = members.filter(m => m.at.basis !== 'event');
  const start =
    q.eventStart !== undefined
      ? tr('이벤트 {v0}', {v0: q.eventStart || tr('미지정')})
      : events.length > 1
        ? tr('주석 이벤트 {length}종', {length: events.length})
        : events.length === 1 && !times.length
          ? tr('주석 {v0}', {v0: events[0]})
          : times.length === 1 && !events.length
            ? tr('{seconds}초', {seconds: times[0].at.seconds})
            : tr('{length}개 시점', {length: members.length});
  const key = q.type === 'keySequence' ? '' : q.control ? 'LMB' : qteKeyName(q.key) || '—';
  return {
    type: q.type ?? 'splitArc',
    design: q.design,
    pressCount: q.pressCount ?? 10,
    key,
    typeName:
      ((q.type ?? 'splitArc') === 'rapidPress' && (q.pressCount ?? 10) === 1
        ? tr('E · 한 번 입력')
        : qteTypes[q.type ?? 'splitArc'] + (q.design === 'converge' ? tr(' · 수렴선') : '')) +
      (q.hidden ? tr(' · 화면 표시 없음') : ''),
    input:
      q.type === 'keySequence'
        ? tr('순서 {v0}키', {v0: q.sequence?.length ?? 0})
        : q.control
          ? tr('일반 공격 · LMB / RT')
          : tr('키 {key}', {key}),
    start: tr('시작 · ') + start,
    rules: q.group ? members.length : 0,
    results: q.group
      ? undefined
      : outcomes.map(k => ({
          k,
          mode: q.results[k].mode,
          recipient: q.results[k].recipient,
          event: q.results[k].event,
          pair: q.eventStart !== undefined || !!w.actions.find(a => a.uid === q.owner)?.pair,
          player: q.eventStart !== undefined,
        })),
  };
}
export function presentCard(w: Workspace, n: FlatNode): CardPresentation {
  const a = w.actions.find(a => a.uid === n.action),
    s = a?.config.steps.find(s => s.id === n.step);
  if (n.kind === 'eventRegistry') return {title: tr('이벤트 등록 · 전역'), icon: 'event', rows: []};
  // A start or a transition is a key's or an event's by its mode (its title names what starts it).
  const start = n.kind === 'startCard' ? w.starts.find(s => 'startCard:' + s.uid === n.id) : undefined,
    link = n.kind === 'transition' ? w.links.find(l => 'transition:' + l.id === n.id) : undefined,
    keyed = n.kind === 'keyInput' || (start ? start.mode !== 'event' : link ? link.mode !== 'event' : false);
  const icon =
    n.kind === 'hkxPlay'
      ? 'play'
      : n.kind === 'blend'
        ? 'blend'
        : n.kind === 'entry'
          ? 'entry'
          : n.kind === 'outputPose'
            ? 'output'
            : keyed
              ? 'keyboard'
              : n.kind === 'markerReceive' ||
                  n.kind === 'eventEmit' ||
                  n.kind === 'startCard' ||
                  n.kind === 'transition'
                ? 'event'
                : n.kind.startsWith('condition') || n.kind === 'stateCondition'
                  ? 'branch'
                  : n.kind === 'cameraRestore'
                    ? 'camera'
                    : /회전/.test(n.title)
                      ? 'rotate'
                      : /면역/.test(n.title)
                        ? 'shield'
                        : 'settings';
  if (a && s && n.kind === 'hkxPlay') {
    const c = a.config,
      window = sourceWindow(a, s.id).value;
    const rows = [{label: tr('파일'), value: s.clip.split(/[\\/]/).at(-1) || tr('HKX 파일 선택')}];
    if (!a.pair)
      rows.push({label: tr('감지 구간'), value: `${timingLabel(window.open)} → ${timingLabel(window.close)}`});
    else rows.push({label: tr('역할'), value: tr('시작자 · 상대')});
    rows.push({label: tr('종료'), value: exitSummary(a)});
    return {title: tr('HKX 재생 · {v0}', {v0: c.kind === 'single' ? c.name : s.label || s.id}), icon, rows};
  }
  if (n.kind === 'qte') {
    const face = qteFace(w, n);
    // A QTE left with the default name is named by its shape and key (docs/mockup-design-audit ③).
    if (face)
      return {
        title:
          'QTE · ' +
          (n.title === 'QTE' ? [face.typeName.split(' · ')[1], face.key].filter(Boolean).join(' ') : n.title),
        icon,
        rows: [],
        qte: face,
      };
  }
  const label =
    n.kind === 'blend'
      ? tr('시간 · 적용')
      : keyed
        ? tr('입력')
        : n.kind === 'markerReceive' || n.kind === 'eventEmit' || n.kind === 'startCard' || n.kind === 'transition'
          ? tr('이벤트')
          : n.kind === 'stateCondition'
            ? tr('조건')
            : n.kind === 'conditionCard'
              ? tr('조건')
              : n.kind === 'outputPose'
                ? tr('종료')
                : n.kind === 'cameraRestore'
                  ? tr('이벤트')
                  : tr('설정');
  // A start card reads as its trigger, then what it sets (docs/mockup-format6-editor); it is edited in Details.
  if (start) {
    const rows = [
      start.mode === 'event'
        ? {label: tr('받을 때'), value: start.event || tr('이벤트 미지정')}
        : {
            label: start.onKeyUp ? tr('뗄 때') : tr('누를 때'),
            value: start.control
              ? gameControlLabel(start.control)
              : [start.key, start.gamepad ? gamepadXml(start.gamepad) : ''].filter(Boolean).join(' · ') ||
                tr('키 미지정'),
          },
    ];
    if (start.mode === 'event' && start.actor !== 'both')
      rows.push({label: tr('보낸 쪽'), value: start.actor === 'player' ? tr('플레이어') : 'NPC'});
    // A start choosing among ordinary actions names its target (mockup ⑨); a pair's names the combat target only.
    if (choosesOrdinary(w, start))
      rows.push({
        label: tr('대상'),
        value:
          start.target === 'combatTarget'
            ? tr('전투 대상')
            : tr('전방 대상 · {range} · {angle}°', {
                range: start.range ?? frontRange,
                angle: start.angle ?? frontAngle,
              }),
      });
    else if (start.mode === 'event' && start.target === 'combatTarget')
      rows.push({label: tr('페어 상대'), value: tr('전투 대상')});
    if (start.cooldown) rows.push({label: tr('쿨다운'), value: tr('{v0}초', {v0: start.cooldown})});
    if (start.block) rows.push({label: tr('바닐라 차단'), value: start.block.events.join(', ')});
    return {title: n.title, icon, rows};
  }
  // A transition reads the same way: its key or event, its window and blend.
  if (link) {
    const input = w.actions.find(a => a.uid === link.from)?.config.inputs.find(i => i.id === link.input);
    const rows = [
      link.mode === 'event'
        ? {label: tr('받을 때'), value: link.event || tr('이벤트 미지정')}
        : {
            label: tr('누를 때'),
            value: input?.control
              ? gameControlLabel(input.control)
              : [input?.key, input?.gamepad ? gamepadXml(input.gamepad) : ''].filter(Boolean).join(' · ') ||
                tr('키 미지정'),
          },
    ];
    if (link.window)
      rows.push({label: tr('감지 구간'), value: timingLabel(link.open) + ' → ' + timingLabel(link.close)});
    if (link.blend !== undefined) rows.push({label: tr('블렌드'), value: tr('{v0}초', {v0: link.blend})});
    return {title: n.title, icon, rows};
  }
  // An event's QTE card reads as a start: the event it waits for (its QTE is its route row, FlatGraph).
  if (n.id.startsWith('qte-event:'))
    return {
      // Named by its event (docs/mockup-design-audit ③), as a start card.
      title: w.qtes?.find(q => 'qte-event:' + q.id === n.id)?.eventStart
        ? tr('QTE 시작 · {v0}', {v0: n.summary})
        : n.title,
      icon,
      rows: [{label: tr('받을 때'), value: n.summary || tr('이벤트 미지정')}],
    };
  const rows = n.kind === 'entry' ? [] : [{label, value: n.summary || tr('설정할 항목을 선택하세요')}];
  return {title: n.title, icon, rows};
}
