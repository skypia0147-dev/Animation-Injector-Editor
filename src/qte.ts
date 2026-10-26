import type {Workspace, Action} from './workspace.ts';
import type {Mark} from './model.ts';
import {mark, keyCode} from './model.ts';
import {clock2, omitDefaults} from './compiler.ts';
import {gamepadFromXml, gamepadXml, isGameControl, type GameControl} from './keys.ts';
import {node, type Xml} from './xml.ts';
import {linkDestination, type Writer} from './format6Xml.ts';
import type {Ref} from './cards.ts';
import {qteAnchors, type QteAnchor} from './qteLayout.ts';
import {tr} from './i18n/korean.ts';
export const outcomes = ['success', 'failure', 'perfect'] as const;
export type Outcome = (typeof outcomes)[number];
export const qteTypes = {
  get splitArc() {
    return tr('A · 수축 원형');
  },
  get timingBar() {
    return tr('B · 타이밍 바');
  },
  get rotatingNeedle() {
    return tr('C · 회전 바늘');
  },
  get holdRelease() {
    return tr('D · 홀드 후 해제');
  },
  get rapidPress() {
    return tr('E · 연타');
  },
  get keySequence() {
    return tr('F · 순서 입력');
  },
} as const;
export type QteType = keyof typeof qteTypes;
/** How a timing (splitArc) QTE looks (runtime 0.12.246): the shrinking circle or the converging lines. */
export const qteDesigns = {
  get circle() {
    return tr('원형');
  },
  get converge() {
    return tr('수렴선');
  },
} as const;
export type QteDesign = keyof typeof qteDesigns;
export type QteKey = {key: string; gamepad: number};
export const defaultSequence = (): QteKey[] => ['E', 'Q', 'E', 'R'].map(key => ({key, gamepad: 0}));
export type QteResult = {
  mode: 'continue' | 'event' | 'transition';
  event: string;
  recipient: 'self' | 'partner' | 'both';
  to: string;
  /** Through a condition card (XML format 6): the card's uid; `to` is then empty. */
  card?: string;
  partnerTo: string;
  soundPlugin?: string;
  soundForm?: string;
};
export type QteNode = {
  anchor?: QteAnchor;
  /** A game control (rightAttack, or any of keys.ts gameControls since runtime 0.12.292): the keys bound to it. */
  control?: GameControl;
  stopEvent?: string;
  replaceActive?: boolean;
  feedback?: number;
  group?: string;
  /** QTEs on different channels (0..3) run together, each taking only its own key. undefined = 0. */
  channel?: number;
  type?: QteType;
  /** splitArc only; undefined = circle. */
  design?: QteDesign;
  /** Started by this event, with no HKX (runtime 0.12.248: <EventRegistry><Event name=…><QTE>): the player's, asked
   *  at once and kept through a ragdoll. `owner` is then empty; `at`, roles, groups and transitions are unused. */
  eventStart?: string;
  pressCount?: number;
  perfectBefore?: number;
  sequence?: QteKey[];
  /** The editor's key for this rule (QTE1, …; node ids and pins use it). */
  id: string;
  /** The id written to the XML (unique within its action; it names the result events AI_<action>_QTE_<id>_…);
   *  absent = id. */
  xmlId?: string;
  name: string;
  owner: string;
  step: string;
  at: Mark;
  key: string;
  gamepad: number;
  /** 'sender' (no XML attribute, runtime 0.12.263): a pair QTE started by an event is the sending role's. */
  inputOwner: 'sender' | 'player' | 'self' | 'partner';
  eventSource: 'self' | 'partner' | 'both';
  speed: number;
  successWindow: number;
  perfectWindow: number;
  scale: number;
  x: number;
  y: number;
  delay: number;
  reducedMotion: boolean;
  /** Nothing on screen (runtime 0.12.266): the input and its results only, for a press or a mash played as a moment
   *  of the animation. */
  hidden?: boolean;
  results: Record<Outcome, QteResult>;
};
/** The role whose player sees the QTE, as the runtime reads it (0.12.263): unset, a pair QTE started by one actor's
 *  event is that actor's; a timed one or one heard from both is the player's in any role. */
export function shownTo(q: QteNode, pair: boolean): 'player' | 'self' | 'partner' {
  if (q.inputOwner !== 'sender') return q.inputOwner;
  return pair && q.eventStart === undefined && q.at.basis === 'event' && q.eventSource !== 'both'
    ? q.eventSource
    : 'player';
}
export const emptyResult = (): QteResult => ({mode: 'continue', event: '', recipient: 'self', to: '', partnerTo: ''});
export function newQte(w: Workspace): QteNode {
  let i = 1;
  while (w.qtes?.some(q => q.id === 'QTE' + i)) i++;
  return {
    id: 'QTE' + i,
    name: 'QTE',
    type: 'splitArc',
    pressCount: 10,
    perfectBefore: 0.5,
    sequence: defaultSequence(),
    owner: '',
    step: '',
    at: {...mark(), seconds: 0.5},
    key: 'E',
    gamepad: 0,
    inputOwner: 'sender',
    eventSource: 'self',
    speed: 1,
    successWindow: 0.085,
    perfectWindow: 0.026,
    scale: 1,
    anchor: 'center',
    x: 0,
    y: 0,
    delay: 0,
    reducedMotion: false,
    results: {success: emptyResult(), failure: emptyResult(), perfect: emptyResult()},
  };
}
/** A QTE's id in the XML: the one the author gave, else the editor's own. */
export const qteXmlId = (q: QteNode) => q.xmlId || q.id;
export function qteErrors(w: Workspace): string[] {
  const errors: string[] = [],
    ids = new Set<string>(),
    // The XML ids within each action (the runtime refuses a repeat, case-insensitive).
    xmlIds = new Set<string>();
  if (w.qtes === undefined) return errors;
  if (!Array.isArray(w.qtes) || w.qtes.length > 1000) return [tr('QTE 목록 형식 오류')];
  for (const q of w.qtes) {
    if (!q || typeof q.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(q.id) || ids.has(q.id.toLowerCase())) {
      errors.push(tr('QTE ID 형식 또는 중복 오류'));
      continue;
    }
    ids.add(q.id.toLowerCase());
    const bad = (s: string) => errors.push(q.id + ': ' + s),
      a = w.actions.find(a => a.uid === q.owner);
    if (q.xmlId !== undefined && (typeof q.xmlId !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(q.xmlId)))
      bad(tr('QTE ID는 영문으로 시작하는 영문·숫자·_ 64자 이내입니다.'));
    else if (q.owner || q.eventStart) {
      const key = (q.owner || 'event:' + q.eventStart!.toLowerCase()) + '|' + qteXmlId(q).toLowerCase();
      if (xmlIds.has(key))
        bad(tr('같은 {v0}에 같은 QTE ID가 있습니다: ', {v0: q.owner ? tr('동작') : tr('이벤트')}) + qteXmlId(q));
      xmlIds.add(key);
    }
    if (q.eventStart !== undefined) {
      // An event's QTE (runtime 0.12.248): the player's own, with no HKX to start from. A result may start an
      // ordinary action (0.12.249: at once, or when the engine hands a body getting up back); asked during a pair
      // (0.12.264) it sends the partner to its own ordinary action too.
      if (!validEvent(q.eventStart)) bad(tr('QTE를 시작할 이벤트 이름을 지정하세요.'));
      if (q.owner) bad(tr('이벤트로 시작하는 QTE는 HKX에 붙지 않습니다.'));
      if (q.group) bad(tr('이벤트로 시작하는 QTE는 규칙 묶음을 쓰지 않습니다.'));
      if (q.inputOwner !== 'player') bad(tr('이벤트로 시작하는 QTE는 플레이어가 입력합니다.'));
      for (const k of outcomes) {
        const r = q.results?.[k];
        if (r?.mode !== 'transition' || r.card) continue;
        const dest = w.actions.find(a => a.uid === r.to);
        if (!dest) bad(tr('결과 HKX를 연결하세요.'));
        else if (dest.pair) bad(tr('이벤트로 시작하는 QTE는 일반 동작으로만 전환합니다.'));
        const other = r.partnerTo ? w.actions.find(a => a.uid === r.partnerTo) : undefined;
        if (r.partnerTo && !other) bad(tr('상대 동작을 찾지 못했습니다.'));
        else if (other?.pair) bad(tr('상대도 일반 동작으로만 전환합니다.'));
      }
      if (outcomes.some(k => q.results?.[k]?.mode === 'event' && q.results[k].recipient !== 'self'))
        bad(tr('이벤트로 시작하는 QTE의 결과 이벤트는 플레이어에게만 보냅니다.'));
      if (w.qtes.filter(x => x.eventStart?.toLowerCase() === q.eventStart?.toLowerCase()).length > 4)
        bad(tr('이벤트 하나에 QTE는 4개까지입니다.'));
    }
    if (!Object.hasOwn(qteTypes, q.type ?? 'splitArc')) bad(tr('QTE 유형 오류'));
    if (q.design !== undefined && !Object.hasOwn(qteDesigns, q.design)) bad(tr('QTE 디자인 오류'));
    if (!Number.isInteger(q.pressCount ?? 10) || (q.pressCount ?? 10) < 1 || (q.pressCount ?? 10) > 100)
      bad(tr('연타 목표는 1~100회입니다.'));
    if (!Number.isFinite(q.perfectBefore ?? 0.5) || (q.perfectBefore ?? 0.5) < 0 || (q.perfectBefore ?? 0.5) > 1)
      bad(tr('완벽 완료 기준은 0~1입니다.'));
    if (q.type === 'keySequence') {
      if (!Array.isArray(q.sequence) || q.sequence.length < 2 || q.sequence.length > 8)
        bad(tr('순서 입력은 2~8개를 지정하세요.'));
      else {
        const valid = (s: QteKey) =>
          s && typeof s.key === 'string' && Number.isInteger(s.gamepad) && s.gamepad >= 0 && s.gamepad <= 65535;
        if (
          !q.sequence.every(valid) ||
          (!q.sequence.every(s => !!keyCode(s.key)) && !q.sequence.every(s => s.gamepad > 0))
        )
          bad(tr('모든 순서에 키보드·마우스 또는 게임패드 키를 지정하세요.'));
      }
    }
    if ((q.control !== undefined && !isGameControl(q.control)) || (q.control && q.type === 'keySequence'))
      bad(tr('QTE 조작키 오류'));
    if (q.stopEvent && !validEvent(q.stopEvent)) bad(tr('QTE 종료 이벤트 오류'));
    if (q.feedback !== undefined && (!Number.isFinite(q.feedback) || q.feedback < 0.05 || q.feedback > 10))
      bad(tr('결과 표시 시간 오류'));
    if (q.replaceActive !== undefined && typeof q.replaceActive !== 'boolean') bad(tr('단계 교체 설정 오류'));
    if (q.group !== undefined && (typeof q.group !== 'string' || q.group.length > 128)) bad(tr('QTE 묶음 이름 오류'));
    if (q.channel !== undefined && (!Number.isInteger(q.channel) || q.channel < 0 || q.channel > 3))
      bad(tr('QTE 채널은 0~3입니다.'));
    if (typeof q.owner !== 'string' || typeof q.name !== 'string' || typeof q.step !== 'string')
      bad(tr('카드 형식 오류'));
    if (q.owner && !a) bad(tr('시작 HKX가 없습니다.'));
    if (a && q.step && !a.config.steps.some(s => s.id === q.step)) bad(tr('시작 클립이 없습니다.'));
    if (q.anchor !== undefined && q.anchor !== 'screen' && !Object.hasOwn(qteAnchors, q.anchor))
      bad(tr('QTE 기준점 오류'));
    const minPosition = !q.anchor || q.anchor === 'screen' ? 0 : -1;
    for (const [key, min, max] of [
      ['speed', 0.1, 10],
      ['successWindow', 0.001, 0.5],
      ['perfectWindow', 0, 0.5],
      ['scale', 0.25, 4],
      ['x', minPosition, 1],
      ['y', minPosition, 1],
      ['delay', 0, 10],
      ['gamepad', 0, 65535],
    ] as const)
      if (!Number.isFinite(q[key]) || q[key] < min || q[key] > max) bad(key + tr(' 범위 오류'));
    if (!Number.isInteger(q.gamepad)) bad(tr('게임패드 버튼은 정수입니다.'));
    if (q.perfectWindow > q.successWindow) bad(tr('완벽 판정은 성공 판정보다 좁아야 합니다.'));
    if (q.type !== 'keySequence' && !q.control && !keyCode(q.key) && !q.gamepad) bad(tr('입력 키를 지정하세요.'));
    if (
      !['sender', 'player', 'self', 'partner'].includes(q.inputOwner) ||
      !['self', 'partner', 'both'].includes(q.eventSource) ||
      typeof q.reducedMotion !== 'boolean'
    )
      bad(tr('입력·이벤트 대상 형식 오류'));
    if (a && !a.pair && (q.inputOwner === 'partner' || q.eventSource !== 'self'))
      bad(tr('상대 설정은 페어 전용입니다.'));
    if (
      !q.at ||
      !['seconds', 'event'].includes(q.at.basis) ||
      !Number.isFinite(q.at.seconds) ||
      q.at.seconds < 0 ||
      q.at.seconds > 600 ||
      (q.at.basis === 'event' && !validEvent(q.at.event)) ||
      (q.at.fallback && q.at.fallbackBasis !== 'seconds')
    )
      bad(tr('시작 시점 오류'));
    for (const outcome of outcomes) {
      const r = q.results?.[outcome];
      if (
        !r ||
        !['continue', 'event', 'transition'].includes(r.mode) ||
        !['self', 'partner', 'both'].includes(r.recipient)
      ) {
        bad(tr('결과 형식 오류'));
        continue;
      }
      if (
        (r.soundPlugin || r.soundForm) &&
        (!r.soundPlugin || !r.soundForm || !/^(?:0[xX])?[0-9a-fA-F]{1,8}$/.test(r.soundForm))
      )
        bad(tr('QTE 사운드 플러그인·Form ID를 지정하세요.'));
      if (r.mode === 'event' && !validEvent(r.event)) bad(tr('결과 이벤트 이름을 지정하세요.'));
      if (a && !a.pair && r.mode === 'event' && r.recipient !== 'self') bad(tr('상대 이벤트는 페어 전용입니다.'));
      if (r.mode === 'transition' && r.card) {
        if (!w.cards.some(c => c.uid === r.card)) bad(tr('결과의 조건 카드가 없습니다.'));
        if (r.partnerTo) bad(tr('상대 동작은 HKX로 바로 가는 결과에만 지정합니다.'));
      } else if (r.mode === 'transition') {
        const dest = w.actions.find(a => a.uid === r.to),
          partner = w.actions.find(a => a.uid === r.partnerTo);
        if (q.owner && !dest) bad(tr('결과 HKX를 연결하세요.'));
        if (q.owner && r.partnerTo && (!a?.pair || !partner || partner.pair || dest?.pair))
          bad(tr('양쪽 전환은 페어에서 두 일반 동작으로 연결하세요.'));
      }
    }
  }
  return errors;
}
const validEvent = (s: unknown) =>
  typeof s === 'string' && !!s.trim() && s.length <= 256 && !/[\s|@<>\x00-\x1f]/.test(s);
/** A QTE's attributes as the XML writes them (format 4 leaves out the runtime's omitted values; key="" stays: it
 *  means pad only). An event's QTE has no start time, roles, step swap or group, and its transition no partner. */
function qteAttrs(q: QteNode) {
  const started = q.eventStart !== undefined;
  return omitDefaults(
    {
      id: qteXmlId(q),
      ...(started ? {} : clock2('at', q.at)),
      key: q.key,
      gamepad: q.gamepad ? gamepadXml(q.gamepad) : undefined,
      inputOwner: started ? undefined : q.inputOwner,
      eventSource: started ? undefined : q.eventSource,
      speed: q.speed,
      successWindow: q.successWindow,
      perfectWindow: q.perfectWindow,
      control: q.control,
      stopEvent: q.stopEvent || undefined,
      replaceActive: started ? undefined : q.replaceActive,
      feedback: q.feedback,
      group: started ? undefined : q.group || undefined,
      channel: q.channel || undefined,
      scale: q.scale,
      anchor: q.anchor,
      x: q.x,
      y: q.y,
      delay: q.delay,
      reducedMotion: q.reducedMotion,
      hidden: q.hidden || undefined,
      type: q.type ?? 'splitArc',
      // The design belongs to the timing circle; another type keeps none.
      design: (q.type ?? 'splitArc') === 'splitArc' ? q.design : undefined,
      ...(q.type === 'rapidPress' ? {pressCount: q.pressCount ?? 10} : {}),
      ...(['rapidPress', 'keySequence'].includes(q.type ?? '') ? {perfectBefore: q.perfectBefore ?? 0.5} : {}),
    },
    {
      key: 'E',
      inputOwner: 'sender',
      eventSource: 'self',
      speed: 1,
      successWindow: 0.085,
      perfectWindow: 0.026,
      replaceActive: false,
      feedback: 1.35,
      scale: 1,
      anchor: 'screen',
      x: q.anchor === 'screen' ? 0.5 : 0,
      y: q.anchor === 'screen' ? 0.5 : 0,
      delay: 0,
      reducedMotion: false,
      type: 'splitArc',
      design: 'circle',
      pressCount: 10,
      perfectBefore: 0.5,
    }
  );
}
function qteChildren(w: Workspace, q: QteNode, x: Writer): Xml[] {
  const started = q.eventStart !== undefined;
  return [
    ...(q.type === 'keySequence'
      ? (q.sequence ?? []).map(s =>
          node('Input', {key: s.key || undefined, gamepad: s.gamepad ? gamepadXml(s.gamepad) : undefined})
        )
      : []),
    ...outcomes.flatMap(k => {
      const r = q.results[k];
      if (r.mode === 'continue' && !r.soundForm) return [];
      const sound = r.soundForm ? {soundPlugin: r.soundPlugin, soundForm: r.soundForm} : {};
      const e = node(k[0].toUpperCase() + k.slice(1), {
        ...(r.mode === 'event' ? (started ? {event: r.event} : {event: r.event, recipient: r.recipient}) : {}),
        ...(r.mode === 'transition' && r.partnerTo
          ? {partnerTo: w.actions.find(a => a.uid === r.partnerTo)!.config.actionId}
          : {}),
        ...sound,
      });
      return [r.mode === 'transition' ? linkDestination(x, e, r.to, r.card) : e];
    }),
  ];
}
export function qteXml(w: Workspace, a: Action, x: Writer): Xml[] {
  return (w.qtes ?? [])
    .filter(q => q.owner === a.uid && q.eventStart === undefined)
    .map(q => node('QTE', qteAttrs(q), qteChildren(w, q, x)));
}
/** The QTEs events start (runtime 0.12.248), each with its event's name as written; workspace.ts puts them under
 *  that event's <Event> in the registry. */
export function eventQteXml(w: Workspace, x: Writer): {event: string; xml: Xml}[] {
  return (w.qtes ?? [])
    .filter(q => q.eventStart !== undefined)
    .map(q => ({event: q.eventStart!, xml: node('QTE', qteAttrs(q), qteChildren(w, q, x))}));
}
const ACTION_QTE_ATTRS = [
  'id',
  'at',
  'fallback',
  'key',
  'gamepad',
  'inputOwner',
  'eventSource',
  'speed',
  'successWindow',
  'perfectWindow',
  'scale',
  'x',
  'y',
  'anchor',
  'delay',
  'reducedMotion',
  'hidden',
  'type',
  'design',
  'pressCount',
  'perfectBefore',
  'control',
  'stopEvent',
  'replaceActive',
  'feedback',
  'group',
  'channel',
];
const EVENT_ONLY_OMITS = ['at', 'fallback', 'inputOwner', 'eventSource', 'replaceActive', 'group'];
/** One <QTE>: an action's (`a`, its clock reads `at`) or an event's (`eventName`). */
function readQte(
  w: Workspace,
  xml: Xml,
  a: Action | undefined,
  eventName: string | undefined,
  through: Through,
  clock?: (s: string, f?: string) => Mark
) {
  const q = newQte(w),
    p = xml.attrs;
  const allowed = eventName ? ACTION_QTE_ATTRS.filter(k => !EVENT_ONLY_OMITS.includes(k)) : ACTION_QTE_ATTRS;
  if (
    Object.keys(p).some(k => !allowed.includes(k)) ||
    xml.children.some(n => !['Success', 'Failure', 'Perfect', 'Input'].includes(n.name))
  )
    throw Error(eventName ? tr('이벤트로 시작하는 QTE에 쓸 수 없는 속성입니다.') : tr('지원하지 않는 QTE 속성입니다.'));
  q.control = p.control as QteNode['control'];
  q.stopEvent = p.stopEvent;
  q.group = p.group;
  if (p.channel !== undefined && !/^[0-3]$/.test(p.channel)) throw Error(tr('QTE channel은 0~3 정수입니다.'));
  q.channel = Number(p.channel ?? 0) || undefined;
  if (p.replaceActive !== undefined && !['true', 'false'].includes(p.replaceActive))
    throw Error(tr('QTE replaceActive 형식 오류'));
  q.replaceActive = p.replaceActive === undefined ? undefined : p.replaceActive === 'true';
  q.feedback = p.feedback === undefined ? undefined : Number(p.feedback);
  q.anchor = (p.anchor ?? 'screen') as QteAnchor;
  q.x = q.y = q.anchor === 'screen' ? 0.5 : 0;
  q.type = (p.type ?? 'splitArc') as QteType;
  if (p.design !== undefined) {
    if (!Object.hasOwn(qteDesigns, p.design)) throw Error(tr('QTE design은 circle 또는 converge입니다.'));
    if (q.type !== 'splitArc') throw Error(tr('QTE design은 splitArc 전용입니다.'));
    if (p.design === 'converge') q.design = 'converge';
  }
  q.pressCount = Number(p.pressCount ?? 10);
  q.perfectBefore = Number(p.perfectBefore ?? 0.5);
  const inputs = xml.children.filter(n => n.name === 'Input');
  if (inputs.length && q.type !== 'keySequence') throw Error(tr('Input은 순서 입력 QTE 전용입니다.'));
  if (q.type === 'keySequence')
    q.sequence = inputs.map(n => {
      if (n.children.length || Object.keys(n.attrs).some(k => !['key', 'gamepad'].includes(k)))
        throw Error(tr('QTE Input 속성 오류'));
      return {
        key: n.attrs.key ?? '',
        gamepad: n.attrs.gamepad === undefined ? 0 : gamepadFromXml(n.attrs.gamepad, 'QTE Input.gamepad'),
      };
    });
  // Its own id unless another QTE took it (ids repeat between actions and events; the editor's keys may not).
  if (w.qtes?.some(x => x.id.toLowerCase() === (p.id ?? '').toLowerCase())) q.xmlId = p.id;
  else q.id = p.id;
  q.owner = a?.uid ?? '';
  q.step = a?.config.entry ?? '';
  if (eventName !== undefined) q.eventStart = eventName;
  else q.at = clock!(p.at, p.fallback);
  q.key = p.key ?? 'E';
  for (const key of ['speed', 'successWindow', 'perfectWindow', 'scale', 'x', 'y', 'delay'] as const)
    if (p[key] !== undefined) q[key] = Number(p[key]);
  if (p.gamepad !== undefined) q.gamepad = gamepadFromXml(p.gamepad, 'QTE.gamepad');
  // An event's QTE is the player's; an action's without the attribute follows its event's sender.
  q.inputOwner = eventName !== undefined ? 'player' : ((p.inputOwner as QteNode['inputOwner']) ?? 'sender');
  if (p.eventSource) q.eventSource = p.eventSource as QteNode['eventSource'];
  if (p.reducedMotion !== undefined && !['true', 'false'].includes(p.reducedMotion))
    throw Error(tr('QTE reducedMotion 형식 오류'));
  q.reducedMotion = p.reducedMotion === 'true';
  if (p.hidden !== undefined && !['true', 'false'].includes(p.hidden)) throw Error(tr('QTE hidden 형식 오류'));
  if (p.hidden === 'true') q.hidden = true;
  const resultKeys = eventName
    ? ['event', 'to', 'partnerTo', 'condition', 'soundPlugin', 'soundForm']
    : ['event', 'recipient', 'to', 'partnerTo', 'condition', 'soundPlugin', 'soundForm'];
  for (const k of outcomes) {
    const matches = xml.children.filter(n => n.name.toLowerCase() === k);
    if (matches.length > 1) throw Error(tr('QTE 결과 중복'));
    const r = matches[0]?.attrs;
    if (!r) continue;
    // Through a condition card (format 6): `condition`, or common conditions and rows inside it.
    const card = r.condition !== undefined || matches[0].children.length > 0;
    if (
      Object.keys(r).some(k => !resultKeys.includes(k)) ||
      (r.to && r.event) ||
      (r.partnerTo && !r.to) ||
      (r.to && r.recipient) ||
      (card && (r.event || r.recipient || r.partnerTo))
    )
      throw Error(tr('QTE 결과 속성 오류'));
    const ref = (s: string) => {
      const dest = w.actions.find(a => a.config.actionId === s);
      if (!dest) throw Error(tr('QTE 결과 HKX가 없습니다: ') + s);
      return dest.uid;
    };
    const dest = card || r.to ? through(matches[0]) : null;
    q.results[k] = {
      ...(r.soundPlugin || r.soundForm ? {soundPlugin: r.soundPlugin, soundForm: r.soundForm} : {}),
      mode: dest ? 'transition' : r.event ? 'event' : 'continue',
      event: r.event ?? '',
      recipient: (r.recipient ?? 'self') as QteResult['recipient'],
      to: dest && 'action' in dest ? dest.action : '',
      ...(dest && 'card' in dest ? {card: dest.card} : {}),
      partnerTo: r.partnerTo ? ref(r.partnerTo) : '',
    };
  }
  (w.qtes ??= []).push(q);
}
/** Reads a result's destination: an action, a card, or null (importXml.ts). */
type Through = (xml: Xml) => Ref;
export function readQtes(w: Workspace, root: Xml, clock: (s: string, f?: string) => Mark, through: Through) {
  for (const n of root.children) {
    const a = w.actions.find(a => a.config.actionId === n.attrs.id);
    if (!a) continue;
    for (const xml of n.children.filter(n => n.name === 'QTE')) readQte(w, xml, a, undefined, through, clock);
  }
}
/** The QTEs the registry's events start (runtime 0.12.248), after the actions' (their ids come first). */
export function readEventQtes(w: Workspace, registry: Xml | undefined, through: Through) {
  for (const e of registry?.children ?? [])
    for (const xml of e.children.filter(n => n.name === 'QTE')) readQte(w, xml, undefined, e.attrs.name ?? '', through);
}
