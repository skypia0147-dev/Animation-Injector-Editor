import type {Workspace} from './workspace.ts';
import type {Issue} from './model.ts';
import {
  cardLoop,
  cardUses,
  descendants,
  isGroup,
  refAction,
  refCard,
  type CardTest,
  type ConditionCard,
  type Ref,
  choosesOrdinary,
  playsPair,
} from './cards.ts';
import {extensionError, extensionKinds, formKinds} from './graph/conditionExtensions.ts';
import {selfDirections} from './graph/conditions.ts';
import {attackStates, equippedTypes, eventListError} from './runtimeExtensions.ts';
import {keyCode} from './model.ts';
import {isGameControl} from './keys.ts';
import {tr} from './i18n/korean.ts';

const idOk = (s: unknown) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s);
const eventOk = (s: string) => !!s.trim() && s.length <= 256 && !/[\s|@<>\x00-\x1f]/.test(s);
const number = (v: unknown, min = 0, max = 600) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const position = (p: any) => !!p && typeof p === 'object' && number(p.x, -1e6, 1e6) && number(p.y, -1e6, 1e6);
const refOk = (r: any) =>
  r === null ||
  (!!r &&
    typeof r === 'object' &&
    Object.keys(r).length === 1 &&
    (typeof r.action === 'string' || typeof r.card === 'string'));
export const checkKinds = [
  'air',
  'weaponDrawn',
  'combat',
  'alive',
  'stamina',
  'magicka',
  'space',
  'ground',
  'magicEffect',
  'global',
  'equippedType',
  'attackState',
  'sneaking',
  'female',
  ...extensionKinds,
];

/** The shape of starts, cards and the root order on open (parseWorkspace): throws on the first problem. */
export function checkCards(w: any) {
  const {starts, cards, order} = w;
  if (!Array.isArray(starts) || starts.length > 500) throw Error(tr('시작 카드 목록 형식 오류'));
  if (!Array.isArray(cards) || cards.length > 2000) throw Error(tr('조건 카드 목록 형식 오류'));
  if (!Array.isArray(order) || order.length > 5000 || order.some((u: unknown) => typeof u !== 'string'))
    throw Error(tr('순서 형식 오류'));
  const uids = new Set<string>();
  for (const s of starts) {
    if (
      !s ||
      typeof s !== 'object' ||
      !idOk(s.uid) ||
      uids.has(s.uid) ||
      (s.xmlId !== undefined && !idOk(s.xmlId)) ||
      !['input', 'event'].includes(s.mode) ||
      typeof s.key !== 'string' ||
      !number(s.gamepad, 0, 65535) ||
      (s.control !== undefined && !isGameControl(s.control)) ||
      typeof s.event !== 'string' ||
      !['both', 'player', 'npc'].includes(s.actor) ||
      !['nearest', 'combatTarget'].includes(s.target) ||
      (s.range !== undefined && !number(s.range, 1, 2000)) ||
      (s.angle !== undefined && !number(s.angle, 1, 360)) ||
      typeof s.onKeyUp !== 'boolean' ||
      !number(s.cooldown) ||
      !refOk(s.to) ||
      !position(s.position) ||
      (s.block !== undefined &&
        (!s.block ||
          !Array.isArray(s.block.events) ||
          s.block.events.some((e: unknown) => typeof e !== 'string') ||
          !['startable', 'active', 'both'].includes(s.block.when))) ||
      Object.keys(s).some(
        k =>
          ![
            'uid',
            'xmlId',
            'mode',
            'key',
            'gamepad',
            'control',
            'event',
            'actor',
            'target',
            'range',
            'angle',
            'onKeyUp',
            'cooldown',
            'block',
            'to',
            'position',
          ].includes(k)
      )
    )
      throw Error(tr('시작 카드 형식 오류'));
    uids.add(s.uid);
  }
  for (const c of cards) {
    if (
      !c ||
      typeof c !== 'object' ||
      !idOk(c.uid) ||
      uids.has(c.uid) ||
      (c.xmlId !== undefined && !idOk(c.xmlId)) ||
      !Array.isArray(c.tests) ||
      c.tests.length > 256 ||
      !Array.isArray(c.guards) ||
      !Array.isArray(c.rows) ||
      c.rows.length > 256 ||
      (c.true !== undefined && !refOk(c.true)) ||
      !refOk(c.false) ||
      !position(c.position) ||
      Object.keys(c).some(k => !['uid', 'xmlId', 'tests', 'guards', 'rows', 'true', 'false', 'position'].includes(k))
    )
      throw Error(tr('조건 카드 형식 오류'));
    uids.add(c.uid);
    const ids = new Set<string>();
    for (const t of c.tests) {
      if (
        !t ||
        !idOk(t.id) ||
        ids.has(t.id) ||
        typeof t.kind !== 'string' ||
        typeof t.subject !== 'string' ||
        typeof t.minimum !== 'number' ||
        'pass' in t ||
        'fail' in t ||
        (t.negate !== undefined && typeof t.negate !== 'boolean') ||
        (t.operands !== undefined &&
          (!Array.isArray(t.operands) || t.operands.some((o: unknown) => typeof o !== 'string')))
      )
        throw Error(tr('조건 형식 오류'));
      ids.add(t.id);
    }
    const known = (id: unknown) => typeof id === 'string' && ids.has(id);
    if (!c.guards.every(known)) throw Error(tr('조건 카드 형식 오류'));
    const rows = new Set<string>();
    for (const r of c.rows) {
      if (
        !r ||
        !idOk(r.id) ||
        rows.has(r.id) ||
        !Array.isArray(r.guards) ||
        !r.guards.every(known) ||
        !refOk(r.to) ||
        Object.keys(r).some(k => !['id', 'guards', 'to'].includes(k))
      )
        throw Error(tr('조건 카드 행 형식 오류'));
      rows.add(r.id);
    }
  }
}

/** One condition's settings, as the runtime checks them (XmlV2 ReadCheck). */
function testErrors(w: Workspace, t: CardTest): string[] {
  const errors: string[] = [];
  if (isGroup(t)) {
    if (!(t.operands ?? []).length) errors.push(tr('빈 조건 그룹이 있습니다. 조건을 넣거나 그룹을 지우세요.'));
    return errors;
  }
  if (!checkKinds.includes(t.kind) || !['self', 'partner'].includes(t.subject))
    errors.push(tr('지원하지 않는 조건입니다.'));
  const extendedError = extensionError(t as never);
  if (extendedError) errors.push(extendedError);
  if (
    t.kind === 'equippedType' &&
    (!['left', 'right'].includes(t.hand ?? '') || !equippedTypes.includes(t.equipmentType!))
  )
    errors.push(tr('검사할 손과 장착 종류를 선택하세요.'));
  if (t.kind === 'attackState' && !attackStates.includes(t.attackState!))
    errors.push(tr('검사할 공격 상태를 선택하세요.'));
  if (formKinds.includes(t.kind)) {
    if (
      !t.form?.plugin ||
      /[\\/\r\n]/.test(t.form.plugin) ||
      !/^0*[0-9a-fA-F]{1,6}$/.test(t.form.id) ||
      parseInt(t.form.id, 16) === 0
    )
      errors.push(tr('플러그인 이름과 로컬 Form ID(16진수)를 확인하세요.'));
    if (
      t.kind === 'global' &&
      (t.subject !== 'self' || !Number.isFinite(t.equals) || Math.abs(t.equals!) > 3.4028234663852886e38)
    )
      errors.push(tr('전역 값의 비교 값을 확인하세요.'));
  }
  // The last action the subject finished (runtime 0.12.296): every action it names is in the project.
  if (t.kind === 'previousAction' && (t.actions ?? []).some(uid => !w.actions.some(a => a.uid === uid)))
    errors.push(tr('직전 동작: 지워진 동작을 가리킵니다. 다시 고르세요.'));
  if (t.kind === 'space' || t.kind === 'ground') {
    const s = t.space;
    if (
      !s ||
      !Number.isFinite(s.distance) ||
      s.distance < 0 ||
      (s.distance === 0 && t.kind === 'space') ||
      s.distance > 2000 ||
      !(selfDirections as readonly string[]).includes(s.direction) ||
      t.subject !== 'self'
    )
      errors.push(tr('검사 방향과 거리(지면 0 이상, 공간 0 초과, 최대 2000)를 확인하세요.'));
    if (t.kind === 'ground' && t.ground) {
      const g = t.ground;
      if (
        ![g.maxRise, g.maxDrop, g.maxSlope, g.radius].every(Number.isFinite) ||
        g.maxRise < 0 ||
        g.maxRise > 200 ||
        g.maxDrop < 0 ||
        g.maxDrop > 500 ||
        g.maxSlope < 0 ||
        g.maxSlope > 80 ||
        g.radius <= 0 ||
        g.radius > 100
      )
        errors.push(tr('지면 검사의 높이·경사·반경을 확인하세요.'));
    }
  }
  if (!Number.isFinite(t.minimum) || t.minimum < 0 || t.minimum > 1000000)
    errors.push(tr('자원 최솟값이 잘못되었습니다.'));
  return errors;
}

/** What the runtime would refuse in the starts and cards, and what plays nothing (validateWorkspace). */
/** Whether `r` compiles to nothing at all, as the runtime's Cards::card decides it (it refuses an owner whose card
 *  does): no common conditions, and a True that goes nowhere, or no True and no rows and a False that goes nowhere.
 *  A card with conditions compiles to its tests even when it plays nothing. */
function absent(w: Workspace, r: Ref, seen = new Set<string>()): boolean {
  if (refAction(r)) return false;
  const c = w.cards.find(c => c.uid === refCard(r));
  if (!c || seen.has(c.uid)) return true;
  seen.add(c.uid);
  if (c.guards.length) return false;
  if (c.true !== undefined) return absent(w, c.true, seen);
  if (c.rows.length) return false;
  return absent(w, c.false, seen);
}
export function cardIssues(w: Workspace): Issue[] {
  const out: Issue[] = [];
  const err = (node: string, message: string) => out.push({level: 'error', node, message});
  const warn = (node: string, message: string) => out.push({level: 'warning', node, message});
  const actions = new Map(w.actions.map(a => [a.uid, a]));
  const cards = new Map(w.cards.map(c => [c.uid, c]));
  const refError = (node: string, r: Ref) => {
    const a = refAction(r),
      c = refCard(r);
    if (a && !actions.has(a)) err(node, tr('사라진 HKX 카드로 갑니다. 갈 곳을 다시 고르세요.'));
    if (c && !cards.has(c)) err(node, tr('사라진 조건 카드로 갑니다. 갈 곳을 다시 고르세요.'));
  };
  const loop = cardLoop(w);
  if (loop) err(loop[0], tr('조건 카드가 서로를 가리켜 순환합니다. 선 하나를 끊으세요.'));
  const uses = cardUses(w);
  // A start's, transition's or QTE result's card must reach some HKX (the runtime refuses one playing nothing).
  const playsNothing = new Set<string>();
  for (const r of [
    ...w.starts.map(s => s.to),
    ...w.links.map(l => (l.card ? {card: l.card} : null)),
    ...(w.qtes ?? []).flatMap(q => Object.values(q.results).map(r => (r.card ? {card: r.card} : null))),
  ])
    if (refCard(r) && cards.has(refCard(r)) && absent(w, r)) playsNothing.add(refCard(r));
  for (const uid of playsNothing)
    err(uid, tr('조건 카드에 재생할 곳이 없습니다. 행·True·False 중 하나를 HKX로 이으세요.'));
  for (const s of w.starts) {
    if (s.mode === 'input') {
      if (s.control) {
        if (s.key || s.gamepad) err(s.uid, tr('게임 동작을 고르면 키·패드 버튼은 쓰지 않습니다.'));
      } else if ((!s.key && !s.gamepad) || (s.key && (!keyCode(s.key) || keyCode(s.key) > 265)))
        err(s.uid, tr('시작 키 또는 패드 버튼을 지정하세요.'));
    } else if (!eventOk(s.event)) err(s.uid, tr('시작 이벤트 이름을 입력하세요.'));
    if (s.block) {
      const e = eventListError(s.block.events);
      if (e) err(s.uid, e);
    }
    if (!s.to) warn(s.uid, tr('이 시작은 갈 곳이 없어 XML에 쓰지 않습니다. HKX나 조건 카드로 이으세요.'));
    refError(s.uid, s.to);
    // The combat target: a pair's event start, or a start choosing among ordinary actions (runtime 0.12.299).
    const ordinary = choosesOrdinary(w, s);
    if (s.target === 'combatTarget' && !ordinary && (s.mode !== 'event' || !playsPair(w, s.to)))
      err(s.uid, tr('전투 대상은 페어로 가는 이벤트 시작이나 일반 동작을 고르는 조건 카드 시작에만 사용하세요.'));
  }
  for (const c of w.cards) {
    const n = uses.get(c.uid) ?? 0;
    if (!n) warn(c.uid, tr('어디서도 들어오지 않는 조건 카드입니다. XML에는 쓰지 않습니다.'));
    if (c.true !== undefined && c.rows.length)
      err(c.uid, tr('True는 공통 조건만 쓴 카드의 유일한 행입니다. 행과 함께 쓰지 않습니다.'));
    for (const r of c.rows) {
      if (!r.guards.filter(g => c.tests.find(t => t.id === g)?.enabled !== false).length)
        err(c.uid, tr('조건 없는 행이 있습니다. 조건을 넣거나, 공통 조건만으로 정하면 True를 쓰세요.'));
      refError(c.uid, r.to);
    }
    if (c.true !== undefined) refError(c.uid, c.true);
    refError(c.uid, c.false);
    // A card with nothing in it writes nothing: where it sits would go nowhere (the runtime refuses it).
    if (n && !c.guards.length && !c.rows.length && c.true === undefined && !c.false)
      err(c.uid, tr('빈 조건 카드입니다. 조건이나 목적지(True·행·False)를 넣으세요.'));
    // Each root's conditions.
    const seen = new Set<string>(),
      roots = [c.guards, ...c.rows.map(r => r.guards)];
    for (const ids of roots)
      for (const id of descendants(c, ids)) {
        const t = c.tests.find(t => t.id === id);
        if (!t) {
          err(c.uid, tr('구성 조건을 찾지 못했습니다.'));
          continue;
        }
        for (const m of testErrors(w, t)) if (!seen.has(m)) (seen.add(m), err(c.uid, m));
      }
    if (descendants(c, roots.flat()).size > 200) err(c.uid, tr('조건 카드의 조건이 너무 많습니다(런타임 한도).'));
  }
  // A transition through a card has no blend of its own (the runtime refuses one).
  for (const l of w.links) {
    if (l.card) {
      if (!cards.has(l.card)) err(l.id, tr('사라진 조건 카드로 갑니다. 갈 곳을 다시 고르세요.'));
      if (l.blend !== undefined)
        err(l.id, tr('조건 카드를 거치는 전환에는 블렌드를 둘 수 없습니다(런타임 미지원). 전환의 블렌드를 지우세요.'));
      if (l.partnerTo) err(l.id, tr('상대 동작은 HKX로 바로 가는 전환에만 지정합니다.'));
    }
  }
  return out;
}
export type {ConditionCard};
