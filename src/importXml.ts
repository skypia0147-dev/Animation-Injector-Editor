import {extensionKinds, formKinds, keywordKinds, readExtension, subjectlessKinds} from './graph/conditionExtensions.ts';
import {shareEventReceivers} from './graph/sharing.ts';
import {eventListError, uniqueEvents, equippedTypes, attackStates} from './runtimeExtensions.ts';
import {pairedRigs} from './pairedRigs.ts';
import {XML_FORMAT_VERSION} from './xmlFormat.ts';
import {selfDirections} from './graph/conditions.ts';
import {valuesError} from './graph/multiValue.ts';
import {createProject, fullBodyGraph, mark} from './model.ts';
import type {Mark, Input} from './model.ts';
import {gamepadFromXml, gameControlFromXml, type GameControl} from './keys.ts';
import {emptyWorkspace, wrap, defaultPair, arrange, validateWorkspace, uid} from './workspace.ts';
import {readDo, readEventValues, readRegistry} from './eventRegistry.ts';
import type {EventRow} from './eventRegistry.ts';
import type {Workspace, Link} from './workspace.ts';
import {parseXml, shapeXml, one} from './xml.ts';
import type {Xml} from './xml.ts';
import {views, firstPersonStarts, actionView, fixedThird} from './view.ts';
import {readQtes, readEventQtes} from './qte.ts';
import {checkKinds} from './cardChecks.ts';
import {
  groupRuleError,
  menuControl,
  startPresses,
  type CardRow,
  type CardTest,
  type ConditionCard,
  type Ref,
  type StartCard,
  type StartPress,
} from './cards.ts';
import {tr} from './i18n/korean.ts';

// Opening an XML (format 6, runtime 0.12.291): the document is the file's starts, condition cards and HKX cards, one
// to one (docs/설계-형식6-에디터.md). Formats 4 and 5 are converted to format 6 first (format6Convert.ts), as the
// runtime's tools/convert_format6.py converts them.

const get = (n: Xml | undefined, k: string, d = '') => n?.attrs[k] ?? d;
function num(n: Xml | undefined, k: string, d: number) {
  const s = n?.attrs[k];
  if (s === undefined) return d;
  if (!s.trim() || !Number.isFinite(Number(s))) throw new Error(tr('{v0}.{k}: 숫자 오류', {v0: n?.name, k}));
  return Number(s);
}
function bool(n: Xml | undefined, k: string, d: boolean) {
  const s = n?.attrs[k];
  if (s === undefined) return d;
  if (!['true', 'false'].includes(s)) throw new Error(tr('{v0}.{k}: true/false가 필요합니다.', {v0: n?.name, k}));
  return s === 'true';
}
function choice<T extends string>(n: Xml | undefined, k: string, values: readonly T[], d: T): T {
  const s = get(n, k, d);
  if (!values.includes(s as T)) throw new Error(tr('{v0}.{k}: 지원하지 않는 값 {s}', {v0: n?.name, k, s}));
  return s as T;
}
/** A start's press kind (runtime PressKinds.h): keys and game controls only, and a menu control only 'down'.
 *  `control`: the start's game control; undefined for an event start. */
function startPress(n: Xml, control: GameControl | undefined | null): StartPress {
  const press = choice(n, 'press', startPresses, 'down');
  if (press === 'down') return press;
  if (control === undefined && n.attrs.event !== undefined)
    throw new Error(tr('Start: press는 키·패드 버튼·게임 동작 시작에서만 씁니다.'));
  if (menuControl(control ?? undefined))
    throw new Error(tr('Start: 메뉴를 여는 게임 동작은 누르는 순간 메뉴가 열려 press="down"만 씁니다.'));
  return press;
}
/** A value list (runtime 0.12.301): every value one of `choices`, none twice. */
function values(n: Xml, k: string, choices: readonly string[]): string {
  const s = required(n, k),
    error = valuesError(s, choices);
  if (error) throw new Error(tr('{v0}.{k}: 지원하지 않는 값 {s}', {v0: n.name, k, s}));
  return s;
}
const required = (n: Xml, k: string) => {
  const s = get(n, k);
  if (!s) throw new Error(tr('{name}.{k}: 필수 값', {name: n.name, k}));
  return s;
};
function child(n: Xml, name: string, attrs: string[], children: string[] = []) {
  const c = one(n, name);
  if (c) shapeXml(c, attrs, children);
  return c;
}
function clock(raw: string): Mark {
  const numeric = (s: string) => {
    s = s.replace(/^@/, '');
    if (/^end(?:-\d+(?:\.\d+)?)?$/.test(s)) return mark(s === 'end' ? 0 : Number(s.slice(4)), 'end');
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return mark(Number(s));
    throw new Error(tr('시각 구문 오류: ') + s);
  };
  if (!raw.startsWith('event:')) return numeric(raw);
  const result = mark();
  result.basis = 'event';
  result.event = raw.slice(6);
  return result;
}
/** A gamepad attribute (a button name or code:N); 0 when absent. */
const pad = (n: Xml | undefined) =>
  n?.attrs.gamepad === undefined ? 0 : gamepadFromXml(n.attrs.gamepad, n.name + '.gamepad');
function inputs(n: Xml | undefined): Input[] {
  if (!n) return [];
  shapeXml(n, [], ['Input']);
  return n.children.map(c => {
    shapeXml(c, ['id', 'key', 'gamepad', 'control']);
    const id = required(c, 'id');
    if (c.attrs.control !== undefined) {
      if (c.attrs.key !== undefined || c.attrs.gamepad !== undefined)
        throw new Error(tr('{name}: control은 key·gamepad와 함께 쓰지 않습니다.', {name: c.name}));
      return {id, label: id, key: '', gamepad: 0, control: gameControlFromXml(c.attrs.control, 'Input.control')};
    }
    return {id, label: id, key: key(get(c, 'key')), gamepad: pad(c)};
  });
}
function key(k: string) {
  return /^0x[\da-f]+$/i.test(k) ? 'code:' + parseInt(k, 16) : /^\d+$/.test(k) ? 'code:' + k : k === 'None' ? '' : k;
}
/** A transition's window (format 6: from, until, buffer on <Transition>/<Vanilla>). */
const windowTimes = (n: Xml) => ({
  open: clock(get(n, 'from', '0')),
  close: clock(get(n, 'until', 'end')),
  buffered: bool(n, 'buffer', true),
});
const hasWindow = (n: Xml) => ['from', 'until', 'buffer'].some(k => n.attrs[k] !== undefined);
const readEvents = (text: string) => {
  const list = text.split(',');
  const error = eventListError(list);
  if (error) throw Error(error);
  return uniqueEvents(list);
};
/** What a card holds: its common conditions, rows, True and False. */
const CARD = ['Check', 'And', 'Or', 'Row', 'True', 'False'];
const isGuard = (n: Xml) => ['Check', 'And', 'Or'].includes(n.name);

export function importWorkspaceXml(text: string): Workspace {
  const root = parseXml(text);
  if (root.name !== 'AnimationSet')
    throw new Error(tr('지원하지 않는 XML 형식입니다. 현재 AnimationSet XML을 사용하세요.'));
  if (get(root, 'version') !== String(XML_FORMAT_VERSION))
    throw new Error(tr('형식 {version} XML만 엽니다.', {version: XML_FORMAT_VERSION}));
  shapeXml(root, ['id', 'version', 'view'], ['Inputs', 'EventRegistry', 'Start', 'Condition', 'Action', 'Pair']);
  const w = emptyWorkspace();
  w.id = required(root, 'id');
  w.name = w.id;
  const fileView = choice(root, 'view', views, 'third');
  if (fileView !== 'third') w.view = fileView;
  const globalInputs = inputs(one(root, 'Inputs'));
  // A key: an <Inputs> name, key=/gamepad=, or a game control (control=, runtime 0.12.292); only one of them.
  const inputKey = (n: Xml): {key: string; gamepad: number; control?: GameControl} => {
    const given = [n.attrs.input, n.attrs.key ?? n.attrs.gamepad, n.attrs.control].filter(v => v !== undefined);
    if (given.length > 1) throw new Error(tr('{name}: input, key·gamepad, control 중 하나만 씁니다.', {name: n.name}));
    if (n.attrs.control !== undefined)
      return {key: '', gamepad: 0, control: gameControlFromXml(n.attrs.control, n.name + '.control')};
    if (n.attrs.input === undefined) return {key: key(get(n, 'key')), gamepad: pad(n)};
    const i = globalInputs.find(i => i.id === n.attrs.input);
    if (!i) throw new Error(tr('정의되지 않은 입력: ') + n.attrs.input);
    return {key: i.key, gamepad: i.gamepad, ...(i.control ? {control: i.control} : {})};
  };
  const keyed = (n: Xml) =>
    n.attrs.input !== undefined ||
    n.attrs.key !== undefined ||
    n.attrs.gamepad !== undefined ||
    n.attrs.control !== undefined;
  const rows: EventRow[] = [];
  const registryNode = one(root, 'EventRegistry');
  if (registryNode) readRegistry(registryNode, rows);
  const source = new Map<string, Xml>();
  // HKX cards.
  for (const n of root.children.filter(n => n.name === 'Action' || n.name === 'Pair')) {
    const pair = n.name === 'Pair';
    shapeXml(
      n,
      [
        'id',
        'clip',
        'view',
        'firstPerson',
        'air',
        'attack',
        'enter',
        'block',
        'safety',
        'loop',
        'maxHold',
        ...(pair ? ['lostBlend', 'reorient', 'interruptOnHit'] : []),
      ],
      [
        'Exit',
        'Rotate',
        'IFrame',
        'HyperArmor',
        'Cost',
        'MoveCancel',
        'Vanilla',
        'Transition',
        'QTE',
        'CarryRelease',
        'EventValues',
        'Do',
        'Camera',
        ...(pair ? ['FindPartner', 'Carry'] : []),
      ]
    );
    const p = createProject();
    p.actionId = required(n, 'id');
    p.name = p.actionId;
    p.inputs = [];
    p.events = [];
    const a = wrap(p, 'a' + (w.actions.length + 1));
    a.config = p;
    a.position = {x: 100 + (w.actions.length % 3) * 500, y: 80 + Math.floor(w.actions.length / 3) * 230};
    if (pair) a.pair = defaultPair();
    p.graph = [pair ? 'RootBehaviorGraph' : fullBodyGraph];
    p.steps = [
      {id: 'A1', label: 'A1', clip: required(n, 'clip'), localPath: '', attack: '', position: {x: 360, y: 140}},
    ];
    p.entry = 'A1';
    // A key written on this card (a transition's, a carry's): the same key is the same editor input.
    const addInput = (n: Xml) => {
      const k = inputKey(n);
      if (!k.key && !k.gamepad && !k.control)
        throw new Error(tr('{name}: 키 또는 패드 버튼이 필요합니다.', {name: n.name}));
      const same = p.inputs.find(i => i.key === k.key && i.gamepad === k.gamepad && i.control === k.control);
      if (same) return same.id;
      const id = 'binding' + (p.inputs.length + 1);
      p.inputs.push({id, label: id, key: k.key, gamepad: k.gamepad, ...(k.control ? {control: k.control} : {})});
      return id;
    };
    const air = choice(n, 'air', ['both', 'only'] as const, 'both');
    p.air = n.attrs.air === undefined ? 'deny' : air === 'both' ? 'allow' : 'only';
    // Charge (runtime 10-30): a clip that plays on until its key is let go or maxHold.
    if (bool(n, 'loop', false)) p.loop = {maxHold: num(n, 'maxHold', 3)};
    else if (n.attrs.maxHold !== undefined)
      throw new Error(tr('{v0}: maxHold는 loop="true"와 함께 씁니다.', {v0: p.actionId || n.attrs.id}));
    if (n.attrs.block !== undefined) p.suppress = {events: readEvents(required(n, 'block')), when: 'active'};
    p.attack = get(n, 'attack');
    a.enterBlendEnabled = n.attrs.enter !== undefined;
    p.enterBlend = num(n, 'enter', 0.1);
    const exit = child(n, 'Exit', ['at', 'blend']);
    a.exitBlendEnabled = exit?.attrs.blend !== undefined;
    p.exitBlend = num(exit, 'blend', 0.2);
    p.exit = clock(get(exit, 'at', 'end-0.05'));
    for (const [xml, k] of [
      ['Rotate', 'rotate'],
      ['IFrame', 'iframe'],
      ['HyperArmor', 'armor'],
    ] as const) {
      const s = child(n, xml, ['from', 'until', ...(k === 'rotate' ? ['locked'] : [])]);
      if (!s) continue;
      if (k === 'rotate' && s.attrs.locked !== undefined) {
        if (pair || Object.keys(s.attrs).some(key => key !== 'locked'))
          throw new Error(tr('Rotate locked는 일반 동작 전용이며 구간 설정과 함께 사용할 수 없습니다.'));
        p.rotationLocked = bool(s, 'locked', false);
        p.slots.rotate.enabled = false;
        continue;
      }
      p.slots[k] = {enabled: true, from: clock(get(s, 'from', '0')), until: clock(get(s, 'until', 'end'))};
    }
    const release = child(n, 'CarryRelease', ['at']);
    if (release) {
      if (pair) throw Error(tr('대상 놓기(CarryRelease)는 한 사람 일반 동작에만 씁니다.'));
      p.carryRelease = {at: clock(required(release, 'at'))};
    }
    const cost = child(n, 'Cost', ['at', 'stamina', 'magicka']);
    if (cost)
      p.cost = {
        enabled: true,
        at: clock(get(cost, 'at', '0')),
        stamina: num(cost, 'stamina', 0),
        magicka: num(cost, 'magicka', 0),
      };
    const recovery = child(n, 'MoveCancel', ['at', 'blend']);
    if (recovery)
      p.recovery = {enabled: true, at: clock(required(recovery, 'at')), blend: num(recovery, 'blend', 0.15)};
    let cancels = 0;
    for (const t of n.children.filter(c => c.name === 'Vanilla')) {
      shapeXml(t, ['id', 'to', 'blend', 'from', 'until', 'buffer']);
      // The runtime names an unnamed one by its place among the action's: cancel1, cancel2, ...
      const id = get(t, 'id') || 'cancel' + (cancels + 1);
      cancels++;
      a.cancels.push({
        id,
        to: required(t, 'to')
          .split(',')
          .map(x => (x.trim().startsWith('event:') ? x.trim() : 'vanilla:' + x.trim()))
          .join(','),
        ...(hasWindow(t) ? windowTimes(t) : {open: mark(), close: mark(0, 'end'), buffered: true}),
        blend: t.attrs.blend === undefined ? null : num(t, 'blend', 0),
        ...(hasWindow(t) ? {} : {always: true as const}),
      });
    }
    // Camera restore and clip-time functions sit in the action itself (format 6).
    const camera = child(n, 'Camera', ['reset', 'restore', 'timeout']);
    a.cameraEnabled = !!camera;
    if (camera)
      a.camera = {
        reset: get(camera, 'reset'),
        restore: choice(camera, 'restore', ['end', 'event'], 'end'),
        timeout: num(camera, 'timeout', 10),
      };
    const dos = n.children.filter(c => c.name === 'Do');
    if (a.pair) {
      const pair = a.pair,
        target = child(n, 'FindPartner', ['range', 'angle', 'rig']);
      pair.targetRig = choice(
        target,
        'rig',
        pairedRigs.map(r => r.id),
        'character'
      );
      pair.range = num(target, 'range', 150);
      pair.angle = num(target, 'angle', 60);
      pair.lossEnabled = n.attrs.lostBlend !== undefined;
      pair.lossBlend = num(n, 'lostBlend', defaultPair().lossBlend);
      pair.reorientSupport = bool(n, 'reorient', true);
      pair.interruptOnThirdPartyHit = bool(n, 'interruptOnHit', false);
      pair.effects = dos.map((e, i) => ({id: 'effect' + (i + 1), values: readDo(e, true)}));
      const carry = child(
        n,
        'Carry',
        ['bone', 'targetRoot', 'putdown', 'input', 'key', 'gamepad', 'control', 'target', 'part', 'weapon'],
        ['Hold', 'Fix']
      );
      if (carry) {
        const target = choice(carry, 'target', ['pose', 'physics'], 'pose');
        if (carry.attrs.part !== undefined && (target !== 'physics' || !carry.attrs.part))
          throw new Error(tr('Carry.part: target="physics"에서 본 이름으로 씁니다.'));
        const weapon = choice(carry, 'weapon', ['sheathed', 'sheathe'], 'sheathed');
        const h = child(carry, 'Hold', ['blendIn', 'blendOut'], ['Bone']);
        const fix = child(carry, 'Fix', ['at']);
        const fixAt = fix ? required(fix, 'at') : '';
        if (fix && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(fixAt) || Number(fixAt) > 600))
          throw new Error(tr('Carry.Fix.at: 클립 시작 기준 초(0~600)로 씁니다. 이벤트는 지원하지 않습니다.'));
        if (!keyed(carry)) throw new Error(tr('Carry: 내려놓기 키(key·gamepad 또는 input)가 필요합니다.'));
        pair.carry = {
          bone: required(carry, 'bone'),
          targetRoot: required(carry, 'targetRoot'),
          putdownAction: required(carry, 'putdown'),
          input: addInput(carry),
          target,
          part: get(carry, 'part'),
          hold: h
            ? {
                pose: 'lift-end',
                blendIn: num(h, 'blendIn', 0.2),
                blendOut: num(h, 'blendOut', 0.2),
                bones: h.children.map(b => {
                  shapeXml(b, ['name', 'weight']);
                  return {name: required(b, 'name'), weight: num(b, 'weight', 1)};
                }),
              }
            : null,
          fix: fix ? {at: mark(Number(fixAt))} : null,
          weapon,
        };
      }
    } else if (dos.length) a.config.effects = dos.map((e, i) => ({id: 'effect' + (i + 1), values: readDo(e, true)}));
    // The numbers its clip runs registered functions with (runtime 0.12.281), matched to the registry read above.
    const values = one(n, 'EventValues');
    if (values) readEventValues(values, rows, a);
    w.actions.push(a);
    source.set(a.uid, n);
    // Transition keys are this action's editor inputs too.
    for (const t of n.children.filter(c => c.name === 'Transition'))
      if (keyed(t)) (t.attrs as Record<string, string>)['data-input'] = addInput(t);
  }
  const actionUid = (id: string, where: string) => {
    const a = w.actions.find(a => a.config.actionId === id);
    if (!a) throw new Error(tr('{where}: 없는 HKX {id}', {where, id}));
    return a.uid;
  };
  // Condition cards: the root's named ones first (anything may name them), then each owner's own.
  const named = new Map<string, string>();
  const shared = root.children.filter(n => n.name === 'Condition');
  for (const c of shared) {
    shapeXml(c, ['id'], CARD);
    const id = required(c, 'id');
    if ([...named.keys()].some(k => k.toLowerCase() === id.toLowerCase()))
      throw new Error(tr('조건 카드 ID 중복: ') + id);
    const card: ConditionCard = {
      uid: newUid(w, 'card'),
      xmlId: id,
      tests: [],
      guards: [],
      rows: [],
      false: null,
      position: {x: 0, y: 0},
    };
    w.cards.push(card);
    named.set(id, card.uid);
  }
  const condition = (n: Xml) => {
    const uid = named.get(required(n, 'condition'));
    if (!uid) throw new Error(tr('정의되지 않은 조건 카드: ') + n.attrs.condition);
    return uid;
  };
  /** One condition (Check, And, Or) into a card's tests: its id. `candidate`: the measured action by default. */
  const readCondition = (card: ConditionCard, n: Xml): string => {
    let i = 1;
    while (card.tests.some(t => t.id === 'Condition' + i)) i++;
    const id = 'Condition' + i;
    const negate = bool(n, 'not', false);
    if (n.name === 'And' || n.name === 'Or') {
      shapeXml(n, ['not'], ['Check', 'And', 'Or']);
      const t: CardTest = {
        id,
        kind: n.name === 'And' ? 'all' : 'any',
        subject: 'self',
        minimum: 0,
        operands: [],
        ...(negate ? {negate} : {}),
      };
      card.tests.push(t);
      t.operands = n.children.map(c => readCondition(card, c));
      return id;
    }
    if (n.name !== 'Check') throw new Error(tr('조건은 <Check>·<And>·<Or>로 씁니다.'));
    card.tests.push({id, ...checkSettings(w, n), ...(negate ? {negate} : {})});
    return id;
  };
  /** A card's content (common conditions, rows or True, False) into `card`. */
  const readContent = (card: ConditionCard, n: Xml) => {
    for (const c of n.children) {
      if (isGuard(c)) card.guards.push(readCondition(card, c));
      else if (c.name === 'Row') {
        shapeXml(c, ['to', 'condition', 'match'], ['Check', 'And', 'Or', 'Condition']);
        if (c.attrs.match !== undefined && c.attrs.match !== 'any') throw new Error(tr('Row.match는 any만 씁니다.'));
        const row: CardRow = {id: 'row' + (card.rows.length + 1), guards: [], to: null};
        if (c.attrs.match === 'any') row.any = true;
        for (const g of c.children.filter(isGuard)) row.guards.push(readCondition(card, g));
        const inner = c.children.find(g => g.name === 'Condition');
        if (c.attrs.to !== undefined) row.to = {action: actionUid(c.attrs.to, 'Row')};
        else if (c.attrs.condition !== undefined) row.to = {card: condition(c)};
        else if (inner) {
          shapeXml(inner, [], CARD);
          row.to = inner.children.length ? {card: newCard(inner)} : null;
        }
        card.rows.push(row);
      } else if (c.name === 'True') card.true = destination(c);
      else if (c.name === 'False') card.false = destination(c);
      else throw new Error(tr('조건 카드에 쓸 수 없는 요소: ') + c.name);
    }
  };
  const newCard = (n: Xml): string => {
    const card: ConditionCard = {
      uid: newUid(w, 'card'),
      tests: [],
      guards: [],
      rows: [],
      false: null,
      position: {x: 0, y: 0},
    };
    w.cards.push(card);
    readContent(card, n);
    return card.uid;
  };
  /** A True's or False's destination: to, condition or the card it holds. */
  const destination = (n: Xml): Ref => {
    shapeXml(n, ['to', 'condition'], CARD);
    if (n.attrs.to !== undefined) return {action: actionUid(n.attrs.to, n.name)};
    if (n.attrs.condition !== undefined) return {card: condition(n)};
    return n.children.length ? {card: newCard(n)} : null;
  };
  /** A start's, transition's or QTE result's destination: to (with common conditions, a card whose True is it),
   *  condition, or the card it holds. */
  const owner = (n: Xml): Ref => {
    const guards = n.children.filter(c => CARD.includes(c.name));
    if (n.attrs.condition !== undefined) return {card: condition(n)};
    if (n.attrs.to !== undefined) {
      const to: Ref = {action: actionUid(n.attrs.to, n.name)};
      if (!guards.length) return to;
      const card: ConditionCard = {
        uid: newUid(w, 'card'),
        tests: [],
        guards: [],
        rows: [],
        false: null,
        position: {x: 0, y: 0},
      };
      w.cards.push(card);
      for (const g of guards) {
        if (!isGuard(g)) throw new Error(tr('to를 쓴 곳에는 공통 조건(<Check>·<And>·<Or>)만 붙입니다.'));
        card.guards.push(readCondition(card, g));
      }
      card.true = to;
      return {card: card.uid};
    }
    return guards.length ? {card: newCard({...n, children: guards})} : null;
  };
  for (const c of shared)
    readContent(
      w.cards.find(x => x.uid === named.get(c.attrs.id))!,
      c
    );
  // Starts, in the file's order.
  for (const n of root.children.filter(n => n.name === 'Start')) {
    shapeXml(
      n,
      [
        'id',
        'to',
        'condition',
        'input',
        'key',
        'gamepad',
        'control',
        'event',
        'actor',
        'target',
        'range',
        'angle',
        'press',
        'cooldown',
        'block',
        'blockWhen',
      ],
      CARD
    );
    const event = get(n, 'event');
    if (event && keyed(n)) throw new Error(tr('Start: 키(input 또는 key·gamepad)와 event 중 하나만 씁니다.'));
    const k: {key: string; gamepad: number; control?: GameControl} = keyed(n) ? inputKey(n) : {key: '', gamepad: 0};
    const s: StartCard = {
      uid: newUid(w, 'start'),
      ...(n.attrs.id ? {xmlId: n.attrs.id} : {}),
      mode: event ? 'event' : 'input',
      key: k.key,
      gamepad: k.gamepad,
      ...(k.control ? {control: k.control} : {}),
      event,
      actor: choice(n, 'actor', ['both', 'player', 'npc'], 'both'),
      target: choice(n, 'target', ['nearest', 'combatTarget'], 'nearest'),
      ...(n.attrs.range !== undefined ? {range: num(n, 'range', 200)} : {}),
      ...(n.attrs.angle !== undefined ? {angle: num(n, 'angle', 90)} : {}),
      press: startPress(n, event ? undefined : (k.control ?? null)),
      cooldown: num(n, 'cooldown', 0),
      ...(n.attrs.block !== undefined
        ? {
            block: {
              events: readEvents(required(n, 'block')),
              when: choice(n, 'blockWhen', ['startable', 'active', 'both'], 'startable'),
            },
          }
        : {}),
      to: owner(n),
      position: {x: 0, y: 0},
    };
    w.starts.push(s);
    (n.attrs as Record<string, string>)['data-uid'] = s.uid;
  }
  // Transitions (after every card: they name actions and cards).
  for (const a of w.actions)
    for (const n of source.get(a.uid)!.children.filter(c => c.name === 'Transition')) {
      shapeXml(
        n,
        [
          'to',
          'condition',
          'partnerTo',
          'input',
          'key',
          'gamepad',
          'control',
          'event',
          'from',
          'until',
          'buffer',
          'blend',
          'on',
          'data-input',
        ],
        CARD
      );
      const to = owner(n);
      const partner = n.attrs.partnerTo ? actionUid(n.attrs.partnerTo, 'Transition') : '';
      const l: Link = {
        id: uid(
          'link',
          w.links.map(l => l.id)
        ),
        from: a.uid,
        to: to && 'action' in to ? to.action : '',
        ...(to && 'card' in to ? {card: to.card} : {}),
        partnerTo: partner,
        mode:
          n.attrs.on === 'end'
            ? 'end'
            : n.attrs.on === 'release'
              ? 'release'
              : n.attrs.on === 'move'
                ? 'move'
                : n.attrs.event
                  ? 'event'
                  : 'input',
        input: n.attrs['data-input'] ?? '',
        event: get(n, 'event'),
        window: hasWindow(n),
        open: mark(0.3),
        close: mark(1.5),
        buffered: true,
        position: {x: 0, y: 0},
      };
      if (n.attrs.blend !== undefined) l.blend = num(n, 'blend', 0);
      if (l.window) Object.assign(l, windowTimes(n));
      if (n.attrs.on !== undefined && !['end', 'release', 'move'].includes(n.attrs.on))
        throw new Error(tr('Transition: on은 end, release, move 중 하나입니다.'));
      if (l.mode === 'move' && (l.input || l.event))
        throw new Error(tr('Transition: 이동키를 누르면(on="move") 전환에는 키·이벤트를 쓰지 않습니다.'));
      if (l.mode === 'end' && (l.input || l.event || l.window))
        throw new Error(tr('Transition: 끝나면(on="end") 전환에는 키·이벤트·구간을 쓰지 않습니다.'));
      if (l.mode === 'release' && l.event) throw new Error(tr('Transition: on을 쓴 전환에는 event를 쓰지 않습니다.'));
      if (l.mode === 'input' || l.mode === 'event') {
        if (l.event && l.input) throw new Error(tr('Transition: 키(input 또는 key·gamepad)와 event 중 하나만 씁니다.'));
        if (!l.event && !l.input)
          throw new Error(tr('Transition: 키(input 또는 key·gamepad) 또는 event가 필요합니다.'));
      }
      w.links.push(l);
    }
  for (const a of w.actions)
    if (a.pair?.carry) {
      const destination = w.actions.find(x => x.config.actionId === a.pair!.carry!.putdownAction);
      if (!destination) throw Error(tr('운반: 내려놓기 동작이 없습니다.'));
      a.pair.carry.putdownAction = destination.uid;
    }
  // Views, once the putdowns are known: pairs and putdowns play in third person whatever the file says.
  for (const a of w.actions) {
    const n = source.get(a.uid)!;
    const view = choice(n, 'view', views, fixedThird(w, a) ? 'third' : (w.view ?? 'third'));
    if (fixedThird(w, a)) {
      if (view !== 'third')
        throw new Error(
          tr('{actionId}: 페어·운반(내려놓기 포함)은 3인칭(view="third")으로만 재생됩니다.', {
            actionId: a.config.actionId,
          })
        );
    } else if (view !== (w.view ?? 'third')) a.view = view;
    const start = choice(n, 'firstPerson', firstPersonStarts, 'block');
    if (n.attrs.firstPerson !== undefined && actionView(w, a) !== 'third')
      throw new Error(
        tr('{actionId}: firstPerson은 3인칭 동작(view="third")에만 씁니다.', {actionId: a.config.actionId})
      );
    if (start === 'switch') a.firstPerson = start;
  }
  // QTE results may go through a card too.
  readQtes(w, root, clock, owner);
  readEventQtes(w, registryNode, owner);
  if (rows.length) w.eventRegistry = rows;
  // The file's order of starts, HKX cards and named cards.
  for (const n of root.children) {
    if (n.name === 'Start') w.order.push(n.attrs['data-uid']);
    else if (n.name === 'Action' || n.name === 'Pair')
      w.order.push(w.actions.find(a => a.config.actionId === n.attrs.id)!.uid);
    else if (n.name === 'Condition') w.order.push(named.get(n.attrs.id)!);
  }
  const errors = validateWorkspace(w).filter(i => i.level === 'error');
  if (errors.length) throw new Error(errors.map(i => i.node + ': ' + i.message).join('\n'));
  for (const c of w.cards) {
    const error = groupRuleError(c);
    if (error) throw new Error(error);
  }
  return shareEventReceivers(arrange(w));
}
const newUid = (w: Workspace, prefix: 'card' | 'start') => {
  const taken = new Set(prefix === 'card' ? w.cards.map(c => c.uid) : w.starts.map(s => s.uid));
  let i = 1;
  while (taken.has(prefix + i)) i++;
  return prefix + i;
};
/** A <Check>'s settings (the runtime's ReadCheck): its kind and that kind's attributes. */
function checkSettings(w: Workspace, n: Xml): Omit<CardTest, 'id'> {
  shapeXml(n, [
    'kind',
    'not',
    'hand',
    'type',
    'state',
    'option',
    'compare',
    'measure',
    'value',
    'upper',
    'subject',
    'distance',
    'direction',
    'maxRise',
    'maxDrop',
    'maxSlope',
    'radius',
    'plugin',
    'form',
    'keyword',
    'equals',
    'actions',
    'within',
    'ended',
  ]);
  const kind = required(n, 'kind');
  if (!checkKinds.includes(kind)) throw Error(tr('지원하지 않는 조건입니다: ') + kind);
  if (kind === 'equippedType') {
    required(n, 'hand');
    required(n, 'type');
  } else if (n.attrs.hand !== undefined || n.attrs.type !== undefined)
    throw Error(tr('손·장비 종류는 장착 종류 검사에서만 사용하세요.'));
  if (kind === 'attackState') required(n, 'state');
  else if (n.attrs.state !== undefined) throw Error(tr('공격 상태는 공격 상태 검사에서만 사용하세요.'));
  // A keyword check names its keyword by editor ID or by plugin and form, one or the other.
  const byName = keywordKinds.includes(kind) && n.attrs.keyword !== undefined;
  if (n.attrs.keyword !== undefined && !keywordKinds.includes(kind))
    throw Error(tr('키워드 이름은 키워드 검사에서만 사용하세요.'));
  if (byName) {
    if (n.attrs.plugin !== undefined || n.attrs.form !== undefined)
      throw Error(tr('키워드 이름과 플러그인·Form ID는 함께 쓸 수 없습니다.'));
    required(n, 'keyword');
  } else if (formKinds.includes(kind)) {
    required(n, 'plugin');
    required(n, 'form');
  } else if (n.attrs.plugin !== undefined || n.attrs.form !== undefined)
    throw Error(tr('폼 설정은 폼 검사에서만 사용하세요.'));
  // The last action the subject finished (runtime 0.12.296): actions by XML id, within, ended.
  if (kind === 'previousAction') required(n, 'actions');
  else if (['actions', 'ended'].some(k => n.attrs[k] !== undefined) || (kind !== 'hitReceived' && n.attrs.within))
    throw Error(tr('직전 동작 설정은 직전 동작 조건에서만 사용하세요.'));
  if (kind === 'global') required(n, 'equals');
  else if (n.attrs.equals !== undefined) throw Error(tr('일치 값은 전역 값 비교에서만 사용하세요.'));
  if (subjectlessKinds.includes(kind) && (n.attrs.subject ?? 'self') !== 'self')
    throw Error(tr('검사 대상을 쓰지 않는 조건입니다: ') + kind);
  if (kind === 'space' || kind === 'ground') {
    required(n, 'distance');
    required(n, 'direction');
  } else if (['distance', 'direction'].some(k => n.attrs[k] !== undefined))
    throw Error(tr('공간 설정은 공간 조건에서만 사용하세요.'));
  if (kind !== 'ground' && ['maxRise', 'maxDrop', 'maxSlope', 'radius'].some(k => n.attrs[k] !== undefined))
    throw Error(tr('지면 설정은 지면 조건에서만 사용하세요.'));
  return {
    kind: kind as CardTest['kind'],
    ...(byName
      ? {keyword: required(n, 'keyword')}
      : formKinds.includes(kind)
        ? {form: {plugin: required(n, 'plugin'), id: required(n, 'form')}}
        : {}),
    ...(extensionKinds.includes(kind as never) ? readExtension(kind, n.attrs) : {}),
    ...(kind === 'global' ? {equals: num(n, 'equals', 1)} : {}),
    ...(kind === 'hitReceived' && n.attrs.within !== undefined ? {within: num(n, 'within', 0)} : {}),
    ...(kind === 'previousAction'
      ? {
          actions: required(n, 'actions')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(id => {
              const a = w.actions.find(x => x.config.actionId === id);
              if (!a) throw Error(tr('직전 동작이 없는 동작을 가리킵니다: ') + id);
              return a.uid;
            }),
          ...(n.attrs.within !== undefined ? {within: num(n, 'within', 0)} : {}),
          ended: choice(n, 'ended', ['any', 'completed', 'cancelled'] as const, 'any'),
        }
      : {}),
    ...(kind === 'equippedType'
      ? {
          hand: choice(n, 'hand', ['left', 'right'] as const, 'left'),
          equipmentType: values(n, 'type', equippedTypes),
        }
      : {}),
    ...(kind === 'attackState' ? {attackState: values(n, 'state', attackStates)} : {}),
    ...(kind === 'space' || kind === 'ground'
      ? {
          space: {
            distance: num(n, 'distance', 0),
            direction: choice(n, 'direction', selfDirections, 'selfForward'),
          },
        }
      : {}),
    ...(kind === 'ground'
      ? {
          ground: {
            maxRise: num(n, 'maxRise', 20),
            maxDrop: num(n, 'maxDrop', 40),
            maxSlope: num(n, 'maxSlope', 45),
            radius: num(n, 'radius', 20),
          },
        }
      : {}),
    subject: choice(n, 'subject', ['self', 'partner'], 'self'),
    minimum: 0,
  };
}
