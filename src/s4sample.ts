import {emptyWorkspace, addAction, addLink} from './workspace.ts';
import type {Workspace} from './workspace.ts';
import {tr} from './i18n/korean.ts';
export function s4sample(): Workspace {
  const w = emptyWorkspace();
  w.id = 'EditorS4';
  w.name = tr('S4 페어와 양쪽 동작');
  const definitions = [
    ['pair', 'EditorS4Pair', tr('페어 · 시작'), 'Animations\\ComboTest\\test_Null.hkx', 'NumEnter'],
    ['pair', 'EditorS4PairNext', tr('페어 · 다음'), 'Animations\\ComboTest\\test_Null.hkx', ''],
    ['single', 'EditorS4Intro', tr('일반 → 페어'), 'Animations\\ComboTest\\test_Attack1.hkx', 'NumPlus'],
    ['single', 'EditorS4UserOut', tr('사용자 · 일반 동작'), 'Animations\\ComboTest\\test_Attack1.hkx', ''],
    ['single', 'EditorS4TargetOut', tr('대상 · 일반 동작'), 'Animations\\ComboTest\\test_Attack3.hkx', ''],
  ] as const;
  for (const [kind, id, name, clip, key] of definitions) {
    const a = addAction(w, kind);
    a.config.actionId = id;
    a.config.name = name;
    a.config.steps[0].clip = clip;
    a.config.inputs = [
      {id: 'use', label: tr('시작'), key: key || 'NumEnter', gamepad: 0},
      {id: 'pairNext', label: tr('다음 페어'), key: 'NumMul', gamepad: 0},
      {id: 'leave', label: tr('양쪽 일반 동작'), key: 'NumMinus', gamepad: 0},
    ];
    a.config.start.mode = key ? 'input' : 'none';
    a.config.start.input = 'use';
    a.config.graph = ['RootBehaviorGraph'];
    a.config.cost.enabled = false;
    a.config.safety = 15;
    a.config.cooldown = 0.3;
    if (!a.pair) {
      a.config.attack = 'attackStart';
      a.config.safety = 3;
    }
    w.actions.push(a);
  }
  const [first, next, intro, user, target] = w.actions;
  first.position = {x: 310, y: 0};
  next.position = {x: 860, y: 0};
  intro.position = {x: 20, y: 230};
  user.position = {x: 860, y: 215};
  target.position = {x: 860, y: 420};
  for (const [from, to, input, partner] of [
    [intro, first, 'pairNext', undefined],
    [first, next, 'pairNext', undefined],
    [first, user, 'leave', target],
    [next, user, 'leave', target],
  ] as const) {
    const l = addLink(w, from.uid, to.uid);
    l.mode = 'input';
    l.input = input;
    l.window = true;
    l.open.seconds = 0.15;
    l.close.seconds = 10.5;
    l.partnerTo = partner?.uid ?? '';
    l.position = {
      x: from === intro ? 20 : 585,
      y: from === intro ? 0 : from === next ? 420 : input === 'pairNext' ? 0 : 215,
    };
    w.links.push(l);
  }
  return w;
}
