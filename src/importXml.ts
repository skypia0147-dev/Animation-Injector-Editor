import {extensionKinds, formKinds, readExtension} from './graph/conditionExtensions.ts';
import {foldNotConditions} from './graph/conditions.ts';
import {shareEventReceivers} from './graph/sharing.ts';
import {eventListError, uniqueEvents, equippedTypes, attackStates} from './runtimeExtensions.ts';
import {pairedRigs} from './pairedRigs.ts';
import {XML_FORMAT_VERSION} from './xmlFormat.ts';
import {createProject, fullBodyGraph, mark} from './model.ts';
import type {Mark, Input} from './model.ts';
import {gamepadFromXml} from './keys.ts';
import {emptyWorkspace, wrap, defaultPair, addLink, arrange, validateWorkspace} from './workspace.ts';
import {readDo, readRegistry} from './eventRegistry.ts';
import {liftStartLimits} from './startLimits.ts';
import type {EventRow} from './eventRegistry.ts';
import type {Workspace, Action} from './workspace.ts';
import {parseXml, shapeXml, one} from './xml.ts';
import type {Xml} from './xml.ts';
import {views, firstPersonStarts, actionView, fixedThird} from './view.ts';
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
function clock(raw: string, fallback = ''): Mark {
  const numeric = (s: string) => {
    s = s.replace(/^@/, '');
    if (/^end(?:-\d+(?:\.\d+)?)?$/.test(s)) return mark(s === 'end' ? 0 : Number(s.slice(4)), 'end');
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return mark(Number(s));
    throw new Error(tr('시각 구문 오류: ') + s);
  };
  const event = raw.startsWith('event:');
  if (!event) {
    if (fallback) throw new Error(tr('대체 시각은 이벤트에만 지정합니다.'));
    return numeric(raw);
  }
  const result = mark();
  result.basis = 'event';
  result.event = raw.slice(6);
  if (fallback) {
    const m = numeric(fallback);
    result.fallback = true;
    result.seconds = m.seconds;
    result.fallbackBasis = m.basis === 'end' ? 'end' : 'seconds';
  }
  return result;
}
/** A gamepad attribute (format 4: a button name or code:N); 0 when absent. */
const pad = (n: Xml | undefined) =>
  n?.attrs.gamepad === undefined ? 0 : gamepadFromXml(n.attrs.gamepad, n.name + '.gamepad');
function inputs(n: Xml | undefined): Input[] {
  if (!n) return [];
  shapeXml(n, [], ['Input']);
  return n.children.map(c => {
    shapeXml(c, ['id', 'key', 'gamepad']);
    const id = required(c, 'id');
    return {id, label: id, key: key(get(c, 'key')), gamepad: pad(c)};
  });
}
function key(k: string) {
  return /^0x[\da-f]+$/i.test(k) ? 'code:' + parseInt(k, 16) : /^\d+$/.test(k) ? 'code:' + k : k === 'None' ? '' : k;
}
/** A window's times (format 4): from defaults to the clip start, until to its end. */
const windowTimes = (win: Xml) => ({
  open: clock(get(win, 'from', '0'), get(win, 'fromFallback')),
  close: clock(get(win, 'until', 'end'), get(win, 'untilFallback')),
  buffered: bool(win, 'buffer', true),
});
import {readQtes, readEventQtes} from './qte.ts';
import {tr} from './i18n/korean.ts';
// Motion is the HKX's AMR annotations only (runtime 0.12.231); the runtime rejects these forms with the same words.
function noMotion(n: Xml) {
  const gone = (what: string, instead: string) => {
    throw new Error(tr('{what}은(는) 없어졌습니다(0.12.231): {instead}', {what, instead}));
  };
  const toFlow = tr('방향마다 동작을 두고 이동 입력 방향 조건(Flow)으로 고르세요');
  if (one(n, 'Motion'))
    gone('Motion', tr('이동은 HKX의 AMR 주석(animmotion)으로만 합니다. 움직이지 않게 하려면 주석을 지우세요'));
  if (one(n, 'Clips')) gone(tr('Clips(방향별 클립)'), toFlow);
  const start = one(n, 'Start');
  for (const k of ['direction', 'defaultDirection', 'strict'])
    if (start?.attrs[k] !== undefined) gone('Start ' + k, toFlow);
}
// Format 4 (runtime 0.12.233) refuses these with what replaces them; the editor says the same.
const comboGone = (what: string) =>
  new Error(
    tr('{what}는 콤보와 함께 없어졌습니다(형식 4): HKX마다 Action을 두고 <Connect to="다음" key="…">로 이으세요.', {
      what,
    })
  );
const gone4 = (what: string, instead: string) =>
  new Error(tr('{what}은(는) 없어졌습니다(형식 4): {instead}', {what, instead}));
const removed3 = (what: string) =>
  new Error(what + tr(': 형식 3에서 없어진 문법입니다. 이벤트 기능은 EventRegistry에 등록합니다.'));
/** An action's <Effects><Camera>: its camera restore (any action since 10-16). */
function readCamera(a: Action, fx: Xml) {
  const camera = child(fx, 'Camera', ['reset', 'restore', 'timeout']);
  a.cameraEnabled = !!camera;
  if (camera)
    a.camera = {
      reset: get(camera, 'reset'),
      restore: choice(camera, 'restore', ['end', 'event'], 'end'),
      timeout: num(camera, 'timeout', 10),
    };
}
export function importWorkspaceXml(text: string): Workspace {
  const root = parseXml(text);
  if (root.name !== 'AnimationSet')
    throw new Error(tr('지원하지 않는 XML 형식입니다. 현재 AnimationSet XML을 사용하세요.'));
  const version = get(root, 'version');
  if (version === '2' || version === '3')
    throw new Error(
      tr(
        '형식 {version} XML은 열 수 없습니다. 이 에디터는 형식 4(version="4")만 엽니다. 에디터에서 동작을 다시 만들어 저장하세요.',
        {version}
      )
    );
  if (version !== String(XML_FORMAT_VERSION)) throw new Error(tr('XML 버전 불일치'));
  if (root.children.some(n => n.name === 'Combo')) throw comboGone('Combo');
  // External (an action another declaration file provides) went in runtime 0.12.238.
  if (root.children.some(n => n.name === 'External'))
    throw new Error(tr('External은 없어졌습니다(런타임 0.12.238): 연결·조건 분기는 같은 파일의 동작만 가리킵니다.'));
  shapeXml(root, ['id', 'version', 'view'], ['Action', 'Pair', 'Inputs', 'EventRegistry']);
  const w = emptyWorkspace();
  w.id = required(root, 'id');
  w.name = w.id;
  // The file's view (runtime 0.12.225); third person is the default and is not stored.
  const fileView = choice(root, 'view', views, 'third');
  if (fileView !== 'third') w.view = fileView;
  const globalInputs = inputs(one(root, 'Inputs'));
  const rows: EventRow[] = [];
  const registryNode = one(root, 'EventRegistry');
  if (registryNode) readRegistry(registryNode, rows);
  const source = new Map<string, Xml>(),
    connectKeys = new Map<string, string[]>();
  for (const n of root.children.filter(n => n.name !== 'Inputs' && n.name !== 'EventRegistry')) {
    noMotion(n);
    const pair = n.name === 'Pair';
    for (const old of ['Step', 'Transition']) if (one(n, old)) throw comboGone(old);
    if (one(n, 'Events')) throw removed3('Events extra');
    if (one(n, 'Lock')) throw new Error(tr('Lock(조작 잠금 구간)은 없어졌습니다(런타임 0.12.238).'));
    shapeXml(
      n,
      ['id', 'clip', 'view', 'firstPerson'],
      [
        'Start',
        'Require',
        'Suppress',
        'FireArrow',
        'QTE',
        'Attack',
        'Enter',
        'Exit',
        'Rotate',
        'IFrame',
        'HyperArmor',
        'Cost',
        'Recovery',
        'Cancel',
        'Connect',
        'Advanced',
        'Target',
        'OnPartnerLost',
        // Read and dropped: the runtime refuses it since 0.12.255 (the end position applies to every pair), so an
        // older XML opens and is written without it.
        'EndPosition',
        'Carry',
        'Effects',
        'Flow',
        'CarryRelease',
      ]
    );
    if (!pair && n.children.some(c => ['Target', 'OnPartnerLost', 'Carry'].includes(c.name)))
      throw new Error(tr('페어 전용 요소 위치 오류'));

    const p = createProject();
    p.actionId = required(n, 'id');
    p.name = p.actionId;
    p.inputs = structuredClone(globalInputs);
    p.events = [];
    p.start.mode = 'none';
    p.start.input = '';
    const a = wrap(p, 'a' + (w.actions.length + 1));
    a.config = p;
    a.position = {x: 100 + (w.actions.length % 3) * 500, y: 80 + Math.floor(w.actions.length / 3) * 230};
    if (pair) {
      a.pair = defaultPair();
      a.pair.lossEnabled = false;
    }
    if (one(n, 'Advanced')?.attrs.graph !== undefined)
      throw gone4('Advanced graph', tr('일반 동작은 1·3인칭 모두 FullBody 경로, 페어는 RootBehaviorGraph입니다'));
    const adv = child(
      n,
      'Advanced',
      pair ? ['safety', 'getToMarkTime', 'markErrorThreshold', 'reorientSupport', 'applyMotionFromRoot'] : ['safety']
    );
    p.graph = [pair ? 'RootBehaviorGraph' : fullBodyGraph];
    // Advanced safety is read and left out: the runtime keeps its own default (10-23).
    p.steps = [
      // No clip: a selecting action (runtime 0.12.244); the workspace check requires one if it plays itself.
      {id: 'A1', label: 'A1', clip: n.attrs.clip ?? '', localPath: '', attack: '', position: {x: 360, y: 140}},
    ];
    p.entry = 'A1';

    // A key: an <Inputs> name (input=) or the key written in place (key= / gamepad=). A key written again on
    // the same action is the same editor input.
    const addInput = (n: Xml) => {
      const direct = n.attrs.key !== undefined || n.attrs.gamepad !== undefined;
      if (n.attrs.input !== undefined) {
        if (direct) throw new Error(tr('{name}: input과 key·gamepad 중 하나만 씁니다.', {name: n.name}));
        return n.attrs.input;
      }
      const k = key(get(n, 'key')),
        g = pad(n);
      if (!k && !g) throw new Error(tr('{name}: 키 또는 패드 버튼이 필요합니다.', {name: n.name}));
      const same = p.inputs.find(i => i.key === k && i.gamepad === g);
      if (same) return same.id;
      const id = 'binding' + (p.inputs.length + 1);
      p.inputs.push({id, label: id, key: k, gamepad: g});
      return id;
    };
    const keyed = (n: Xml) => n.attrs.input !== undefined || n.attrs.key !== undefined || n.attrs.gamepad !== undefined;
    const start = child(n, 'Start', ['input', 'key', 'gamepad', 'event', 'actor', 'target', 'onKeyUp']);
    if (start) {
      const ev = get(start, 'event');
      if (ev && keyed(start)) throw new Error(tr('Start: 키(input 또는 key·gamepad)와 event 중 하나만 씁니다.'));
      p.start.mode = ev ? 'event' : keyed(start) ? 'input' : 'none';
      p.start.event = ev;
      p.start.actor = choice(start, 'actor', ['both', 'player', 'npc'], 'both');
      p.start.onKeyUp = bool(start, 'onKeyUp', false);
      if (p.start.mode === 'input') p.start.input = addInput(start);
      if (a.pair) a.pair.target = choice(start, 'target', ['nearest', 'combatTarget'], 'nearest');
      else if (get(start, 'target', 'nearest') !== 'nearest')
        throw new Error(tr('일반 동작에 페어 대상이 지정되었습니다.'));
    }
    const require = child(n, 'Require', ['weapon', 'air', 'blockWhileAttacking', 'cooldown', 'stamina']);
    p.air = choice(require, 'air', ['deny', 'allow', 'only'], 'deny');
    p.cooldown = num(require, 'cooldown', 0);
    // An older file's state checks (runtime 0.12.276 refuses them): liftStartLimits moves them into a branch.
    Object.assign(p, {
      weapon: choice(require, 'weapon', ['drawn', 'any'], 'any') === 'drawn',
      requiredStamina: num(require, 'stamina', 0),
      blockWhileAttacking: bool(require, 'blockWhileAttacking', false),
    });
    const readEvents = (text: string) => {
      const list = text.split(',');
      const error = eventListError(list);
      if (error) throw Error(error);
      return uniqueEvents(list);
    };
    const suppress = child(n, 'Suppress', ['events', 'when']);
    if (suppress)
      p.suppress = {
        events: readEvents(required(suppress, 'events')),
        when: choice(suppress, 'when', ['startable', 'active', 'both'], 'startable'),
      };
    if (p.start.mode === 'none' && p.start.onKeyUp)
      throw new Error(tr('비활성 Trigger의 키업 설정은 지원하지 않습니다.'));
    p.attack = get(child(n, 'Attack', ['data']), 'data');
    const enter = child(n, 'Enter', ['blend']),
      exit = child(n, 'Exit', ['at', 'fallback', 'blend']);
    a.enterBlendEnabled = enter?.attrs.blend !== undefined;
    a.exitBlendEnabled = exit?.attrs.blend !== undefined;
    p.enterBlend = num(enter, 'blend', 0.1);
    p.exitBlend = num(exit, 'blend', 0.2);

    p.exit = clock(get(exit, 'at', 'end-0.05'), get(exit, 'fallback'));
    for (const [xml, k] of [
      ['Rotate', 'rotate'],
      ['IFrame', 'iframe'],
      ['HyperArmor', 'armor'],
    ] as const) {
      const s = child(n, xml, [
        ...['from', 'until', 'fromFallback', 'untilFallback'],
        ...(k === 'rotate' ? ['locked'] : []),
      ]);
      if (!s) continue;
      if (['from', 'until'].some(a => get(s, a).startsWith('event:')) || s.attrs.fromFallback || s.attrs.untilFallback)
        throw removed3(xml + tr('의 이벤트 시각'));
      if (k === 'rotate' && s.attrs.locked !== undefined) {
        if (pair || Object.keys(s.attrs).some(key => key !== 'locked'))
          throw new Error(tr('Rotate locked는 일반 동작 전용이며 구간 설정과 함께 사용할 수 없습니다.'));
        p.rotationLocked = bool(s, 'locked', false);
        p.slots.rotate.enabled = false;
        continue;
      }
      p.slots[k] = {
        enabled: true,
        from: clock(get(s, 'from', '0')),
        until: clock(get(s, 'until', 'end')),
      };
    }
    const release = child(n, 'CarryRelease', ['at', 'fallback']);
    if (release) {
      if (pair) throw Error(tr('대상 놓기(CarryRelease)는 한 사람 일반 동작에만 씁니다.'));
      p.carryRelease = {at: clock(required(release, 'at'), get(release, 'fallback'))};
    }
    const fire = child(n, 'FireArrow', ['at', 'onRelease', 'mode', 'damage']);
    if (fire) {
      if (pair) throw Error(tr('페어에는 활 발사를 사용할 수 없습니다.'));
      const at = get(fire, 'at'),
        mode = get(fire, 'mode') || 'drawn';
      if (at.startsWith('event:')) throw removed3(tr('FireArrow의 이벤트 시각'));
      if (!['drawn', 'direct'].includes(mode)) throw Error(tr('FireArrow.mode: drawn 또는 direct입니다.'));
      if (mode === 'direct') {
        if (bool(fire, 'onRelease', false))
          throw Error(tr('FireArrow: mode="direct"(바로 발사)는 onRelease를 쓸 수 없습니다.'));
        const damage = get(fire, 'damage') ? Number(get(fire, 'damage')) : 100;
        if (!(damage >= 1 && damage <= 1000)) throw Error(tr('FireArrow.damage: 1~1000%입니다.'));
        p.fireArrow = {
          at: at ? clock(at) : null,
          onRelease: false,
          mode: 'direct',
          ...(damage !== 100 ? {damage} : {}),
        };
        if (!p.fireArrow.at) throw Error(tr('FireArrow: mode="direct"(바로 발사)에는 at이 필요합니다.'));
      } else {
        if (get(fire, 'damage')) throw Error(tr('FireArrow.damage는 mode="direct"(바로 발사)에서만 씁니다.'));
        p.fireArrow = {at: at ? clock(at) : null, onRelease: bool(fire, 'onRelease', true)};
        if (!p.fireArrow.at && !p.fireArrow.onRelease)
          throw Error(tr('FireArrow: at 또는 onRelease="true"가 필요합니다.'));
      }
    }
    const cost = child(n, 'Cost', ['at', 'stamina', 'magicka']);
    if (cost) {
      if (get(cost, 'at').startsWith('event:')) throw removed3(tr('Cost의 이벤트 시각'));
      p.cost = {
        enabled: true,
        at: clock(get(cost, 'at', '0')),
        stamina: num(cost, 'stamina', 0),
        magicka: num(cost, 'magicka', 0),
      };
    }
    const recovery = child(n, 'Recovery', ['at', 'fallback', 'blend']);
    if (recovery) {
      p.recovery = {
        enabled: true,
        at: clock(required(recovery, 'at'), get(recovery, 'fallback')),
        blend: num(recovery, 'blend', 0.15),
      };
    }
    let cancels = 0;
    for (const t of n.children.filter(c => c.name === 'Cancel')) {
      shapeXml(t, ['id', 'to', 'blend'], ['Window']);
      // The runtime names an unnamed cancel by its position among the action's cancels: cancel1, cancel2, ...
      const id = get(t, 'id') || 'cancel' + (cancels + 1);
      cancels++;
      if (one(t, 'Window')?.attrs.always !== undefined)
        throw gone4('Window always', tr('<Window>를 쓰지 않으면 클립 전체에서 받습니다'));
      const win = child(t, 'Window', ['from', 'until', 'fromFallback', 'untilFallback', 'buffer']);
      // No <Window>: open for the whole clip.
      a.cancels.push({
        id,
        to: required(t, 'to'),
        ...(win ? windowTimes(win) : {open: mark(), close: mark(0, 'end'), buffered: true}),
        blend: t.attrs.blend === undefined ? null : num(t, 'blend', 0),
        ...(win ? {} : {always: true as const}),
      });
    }
    if (a.pair) {
      const pair = a.pair,
        settings = adv,
        target = child(n, 'Target', ['range', 'angle', 'rig']);
      pair.targetRig = choice(
        target,
        'rig',
        pairedRigs.map(r => r.id),
        'character'
      );
      pair.range = num(target, 'range', 150);
      pair.angle = num(target, 'angle', 60);
      const loss = child(n, 'OnPartnerLost', ['blend']);
      pair.lossEnabled = loss?.attrs['blend'] !== undefined;
      pair.lossBlend = num(loss, 'blend', defaultPair().lossBlend);
      const carryNode = one(n, 'Carry');
      if (carryNode?.attrs.release !== undefined)
        throw new Error(
          tr('Carry.release: 내려놓기는 이제 putdown(한 사람 Action)과 그 안의 CarryRelease 시점으로 지정합니다.')
        );
      if (carryNode?.attrs.alignStart !== undefined) throw gone4('Carry alignStart', tr('쓰이지 않던 값입니다'));
      if (carryNode && one(carryNode, 'Hold')?.attrs.pose !== undefined)
        throw gone4('Hold pose', tr('들기의 마지막 자세만 씁니다. <Hold>만 쓰세요'));
      if (carryNode && (carryNode.attrs.weapon === 'keep' || carryNode.attrs.weaponShow !== undefined))
        throw new Error(
          tr(
            'Carry weapon="keep"·weaponShow는 없어졌습니다(런타임 0.12.238): 무기를 든 채 들려면 weapon="sheathe"(들기 시작 때 넣기)를 쓰세요.'
          )
        );
      const carry = child(
        n,
        'Carry',
        ['bone', 'targetRoot', 'putdown', 'input', 'key', 'gamepad', 'target', 'part', 'weapon'],
        ['Hold', 'Fix']
      );
      if (carry) {
        const target = choice(carry, 'target', ['pose', 'physics'], 'pose');
        if (carry.attrs.part !== undefined && (target !== 'physics' || !carry.attrs.part))
          throw new Error(tr('Carry.part: target="physics"에서 본 이름으로 씁니다.'));
        const weapon = choice(carry, 'weapon', ['sheathed', 'sheathe'], 'sheathed');
        const h = child(carry, 'Hold', ['blendIn', 'blendOut'], ['Bone']);
        // The fix moment: plain seconds from the lift clip's start, like the runtime.
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
      // getToMarkTime, markErrorThreshold and applyMotionFromRoot are read and dropped (runtime 0.12.259 fixes them).
      pair.reorientSupport = bool(settings, 'reorientSupport', true);
      if (one(n, 'Effects') && one(one(n, 'Effects')!, 'Effect')) throw removed3('Effects/Effect');
      const fx = child(n, 'Effects', ['interruptOnThirdPartyHit'], ['Camera', 'Do']);
      pair.effectsEnabled = !!fx;
      if (fx) {
        pair.interruptOnThirdPartyHit = bool(fx, 'interruptOnThirdPartyHit', false);
        readCamera(a, fx);
        pair.effects = [];
        for (const e of fx.children.filter(c => c.name === 'Do'))
          pair.effects.push({id: 'effect' + (pair.effects.length + 1), values: readDo(e, true)});
      }
    } else {
      if (n.children.some(c => c.name === 'PairFeatures'))
        throw new Error(tr('페어 전용 설정이 일반 동작에 있습니다.'));
      // An ordinary action's Effects: a camera restore (runtime 0.12.260) and clip-time functions (0.12.274).
      const fx = child(n, 'Effects', [], ['Camera', 'Do']);
      if (fx) {
        readCamera(a, fx);
        const dos = fx.children.filter(c => c.name === 'Do');
        if (dos.length) a.config.effects = dos.map((e, i) => ({id: 'effect' + (i + 1), values: readDo(e, true)}));
      }
    }
    w.actions.push(a);
    source.set(a.uid, n);
    // Connect keys are this action's editor inputs too; read here, while `addInput` sees this action.
    connectKeys.set(
      a.uid,
      n.children.filter(c => c.name === 'Connect').map(c => (keyed(c) ? addInput(c) : ''))
    );
  }
  for (const a of w.actions) {
    const flow = one(source.get(a.uid)!, 'Flow');
    if (flow) {
      shapeXml(flow, ['entry'], ['Test', 'All', 'Any', 'Not', 'Play', 'Stop']);
      const ids = new Set<string>();
      for (const n of flow.children) {
        const id = required(n, 'id');
        if (ids.has(id)) throw Error(tr('조건 ID 중복'));
        ids.add(id);
      }
      const target = (id: string | undefined): import('./graph/conditions.ts').BranchTarget | undefined => {
        if (!id) return undefined;
        const n = flow.children.find(n => n.attrs.id === id);
        if (!n) throw Error(tr('없는 조건 목적지'));
        if (['Test', 'All', 'Any', 'Not'].includes(n.name)) return {node: id};
        if (n.name === 'Stop') return undefined;
        const dest = w.actions.find(a => a.config.actionId === n.attrs.action);
        if (!dest) throw Error(tr('없는 HKX 목적지'));
        return {action: dest.uid};
      };
      for (const n of flow.children)
        if (['All', 'Any', 'Not'].includes(n.name)) {
          shapeXml(n, ['id', 'pass', 'fail'], ['Use']);
          for (const c of n.children) {
            shapeXml(c, ['node']);
            required(c, 'node');
          }
        } else
          shapeXml(
            n,
            n.name === 'Test'
              ? [
                  'id',
                  'kind',
                  'hand',
                  'type',
                  'state',
                  'option',
                  'compare',
                  'measure',
                  'value',
                  'upper',
                  'subject',
                  'minimum',
                  'pass',
                  'fail',
                  'candidate',
                  'distance',
                  'direction',
                  'maxRise',
                  'maxDrop',
                  'maxSlope',
                  'radius',
                  'plugin',
                  'form',
                  'equals',
                ]
              : n.name === 'Play'
                ? ['id', 'action']
                : ['id']
          );
      for (const n of flow.children.filter(n => n.name === 'Test')) {
        required(n, 'kind');
        if (n.attrs.kind === 'equippedType') {
          required(n, 'hand');
          required(n, 'type');
        } else if (n.attrs.hand !== undefined || n.attrs.type !== undefined)
          throw Error(tr('손·장비 종류는 장착 종류 검사에서만 사용하세요.'));
        if (n.attrs.kind === 'attackState') required(n, 'state');
        else if (n.attrs.state !== undefined) throw Error(tr('공격 상태는 공격 상태 검사에서만 사용하세요.'));
        if (formKinds.includes(n.attrs.kind)) {
          required(n, 'plugin');
          required(n, 'form');
        } else if (n.attrs.plugin !== undefined || n.attrs.form !== undefined)
          throw Error(tr('폼 설정은 폼 검사에서만 사용하세요.'));
        if (n.attrs.kind === 'global') required(n, 'equals');
        else if (n.attrs.equals !== undefined) throw Error(tr('일치 값은 전역 값 비교에서만 사용하세요.'));
        if (['stamina', 'magicka'].includes(n.attrs.kind)) required(n, 'minimum');
        else if (n.attrs.minimum !== undefined) throw Error(tr('자원 조건에만 최솟값을 지정하세요.'));
        if (n.attrs.kind === 'space' || n.attrs.kind === 'ground') {
          required(n, 'candidate');
          required(n, 'distance');
          required(n, 'direction');
        } else if (['candidate', 'distance', 'direction'].some(k => n.attrs[k] !== undefined))
          throw Error(tr('공간 설정은 공간 조건에서만 사용하세요.'));
        if (
          n.attrs.kind !== 'ground' &&
          ['maxRise', 'maxDrop', 'maxSlope', 'radius'].some(k => n.attrs[k] !== undefined)
        )
          throw Error(tr('지면 설정은 지면 조건에서만 사용하세요.'));
      }
      a.flow = {
        entry: required(flow, 'entry'),
        tests: flow.children
          .filter(n => ['Test', 'All', 'Any', 'Not'].includes(n.name))
          .map(n => ({
            id: required(n, 'id'),
            ...(n.name !== 'Test' ? {operands: n.children.map(c => required(c, 'node'))} : {}),
            kind:
              n.name !== 'Test'
                ? (n.name.toLowerCase() as 'all' | 'any' | 'not')
                : choice(
                    n,
                    'kind',
                    [
                      'air',
                      'weaponDrawn',
                      'combat',
                      'alive',
                      'stamina',
                      'magicka',
                      'space',
                      'ground',
                      'unarmedRight',
                      'equippedType',
                      'attackState',
                      'sneaking',
                      'female',
                      ...extensionKinds,
                      'magicEffect',
                      'global',
                    ],
                    'alive'
                  ),
            ...(formKinds.includes(n.attrs.kind)
              ? {form: {plugin: required(n, 'plugin'), id: required(n, 'form')}}
              : {}),
            ...readExtension(n.attrs.kind, n.attrs),
            ...(n.attrs.kind === 'global' ? {equals: num(n, 'equals', 1)} : {}),
            ...(n.attrs.kind === 'equippedType'
              ? {
                  hand: choice(n, 'hand', ['left', 'right'] as const, 'left'),
                  equipmentType: choice(n, 'type', equippedTypes, 'bow'),
                }
              : {}),
            ...(n.attrs.kind === 'attackState' ? {attackState: choice(n, 'state', attackStates, 'none')} : {}),
            ...(['space', 'ground'].includes(n.attrs.kind)
              ? {
                  space: {
                    candidate: w.actions.find(x => x.config.actionId === n.attrs.candidate)?.uid ?? '',
                    distance: num(n, 'distance', 0),
                    direction: choice(
                      n,
                      'direction',
                      ['partnerForward', 'partnerBack', 'partnerRight', 'partnerLeft'],
                      'partnerForward'
                    ),
                  },
                }
              : {}),
            ...(n.attrs.kind === 'ground'
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
            minimum: num(n, 'minimum', 0),
            pass: target(n.attrs.pass),
            fail: target(n.attrs.fail),
          })),
      };
    }
    const keys = connectKeys.get(a.uid)!;
    for (const [index, n] of source
      .get(a.uid)!
      .children.filter(c => c.name === 'Connect')
      .entries()) {
      shapeXml(n, ['blend', 'to', 'partnerTo', 'event', 'input', 'key', 'gamepad'], ['Window']);
      const target = (name: string) =>
        w.actions.find(a => a.config.actionId === get(n, name).replace(/^action:/, ''))?.uid ?? '';
      const to = target('to'),
        partner = target('partnerTo');
      if (!to || (get(n, 'partnerTo') && !partner))
        throw new Error(tr('다른 파일의 목적지는 관련 동작을 같은 XML에 넣은 후 가져오세요.'));
      const l = addLink(w, a.uid, to);
      if (get(n, 'blend') !== '') l.blend = num(n, 'blend', 0);
      l.partnerTo = partner;
      l.event = get(n, 'event');
      l.mode = l.event ? 'event' : 'input';
      l.input = keys[index];
      if (l.event && l.input) throw new Error(tr('Connect: 키(input 또는 key·gamepad)와 event 중 하나만 씁니다.'));
      if (!l.event && !l.input) throw new Error(tr('Connect: 키(input 또는 key·gamepad) 또는 event가 필요합니다.'));
      // No <Window>: the whole clip.
      const win = child(n, 'Window', ['from', 'until', 'fromFallback', 'untilFallback', 'buffer']);
      l.window = !!win;
      if (win) Object.assign(l, windowTimes(win));
      w.links.push(l);
    }
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
  readQtes(w, root, clock);
  readEventQtes(w, registryNode);
  if (rows.length) w.eventRegistry = rows;
  liftStartLimits(w);
  const errors = validateWorkspace(w).filter(i => i.level === 'error');
  if (errors.length) throw new Error(errors.map(i => i.node + ': ' + i.message).join('\n'));
  return shareEventReceivers(arrange(foldNotConditions(w)));
}
