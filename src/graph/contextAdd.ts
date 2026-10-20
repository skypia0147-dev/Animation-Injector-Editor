import {addTableRow} from './conditionTables.ts';
import type {Workspace} from '../workspace.ts';
import {addFlat, connectFlat, flatGraph, flatNode, notifyKinds} from './flat.ts';
import {compactGraph} from './sharing.ts';
import {blendNodes, animId} from './blends.ts';
import {title} from '../timeline/model.ts';
import {branchTest, parseNodeId} from './nodeRef.ts';
import {tr} from '../i18n/korean.ts';
export type AddOption = {label: string; kind: string; before?: boolean; port?: string; entry?: boolean};
/** The start or end blend an HKX play card's features add (10-20: 0.2 s was too short to read as a blend). */
export const HKX_BLEND_SECONDS = 0.3;
export function addConnected(w: Workspace, source: string, option: AddOption, position: {x: number; y: number}) {
  const sourceRef = parseNodeId(source);
  if (sourceRef.kind === 'table' && option.kind === 'tableRow')
    return {workspace: addTableRow(w, sourceRef.owner), id: source};
  const node = flatNode(w, source);
  if (!node) throw Error(tr('연결할 카드를 찾지 못했습니다.'));
  const branch =
    node.kind === 'conditionBranch' && node.action
      ? w.actions.find(a => a.uid === node.action)?.flow?.tests.find(t => t.id === branchTest(source))
      : undefined;
  const prior = branch && (option.port === 'pass' || option.port === 'fail') ? branch[option.port] : undefined;
  if (prior && option.kind === 'playNode')
    throw Error(tr('이미 연결된 목적지가 있습니다. 연결선을 해제한 뒤 추가하세요.'));
  const oldIds = new Set(flatGraph(w).nodes.map(n => n.id));
  if (option.kind === 'blend' && node.kind === 'hkxPlay' && node.action) {
    const a = w.actions.find(a => a.uid === node.action)!;
    const existing = blendNodes(w).find(b =>
      option.before ? b.target === source || b.target === a.uid : b.source === source || b.source === a.uid
    );
    if (existing) return {workspace: w, id: existing.id};
    const result = addFlat(w, node.action, 'blend', position);
    const b = result.workspace.blends!.find(b => b.id === result.id)!;
    // An HKX's start or end blend added from its features starts at 0.3 s (10-20).
    b.seconds = HKX_BLEND_SECONDS;
    b.source =
      option.before && node.step !== a.config.entry
        ? ''
        : option.before
          ? a.config.start.mode === 'none'
            ? 'entry'
            : `start:${a.uid}|${a.config.start.mode === 'event' ? 'markerReceive' : 'keyInput'}`
          : source;
    b.target = option.before ? source : animId(a.uid, 'outputPose');
    return result;
  }
  // A transition's blend: between its key or event node and the destination it already has.
  const link = node.scope.kind === 'link' ? w.links.find(l => l.id === (node.scope as {link: string}).link) : undefined;
  const destination = link && w.actions.find(a => a.uid === link.to);
  if (option.kind === 'blend' && link && destination && ['keyInput', 'markerReceive'].includes(node.kind)) {
    const existing = blendNodes(w).find(b => b.source === source);
    if (existing) return {workspace: w, id: existing.id};
    const result = addFlat(w, node.action ?? link.from, 'blend', position);
    const b = result.workspace.blends!.find(b => b.id === result.id)!;
    b.source = source;
    b.target = destination.nodeAuthored ? animId(destination.uid, 'clip_' + destination.config.entry) : destination.uid;
    return result;
  }
  const result = addFlat(structuredClone(w), node.action ?? '', option.kind, position);
  let next = result.workspace;
  if (prior && option.kind === 'conditionBranch') {
    const key = branchTest(result.id)!;
    next.actions.find(a => a.uid === node.action)!.flow!.tests.find(t => t.id === key)!.pass = {...prior};
  }
  if (option.entry) {
    const a = next.actions.find(a => a.uid === node.action)!,
      previous = w.actions.find(a => a.uid === node.action)?.flow?.entry;
    const key = branchTest(result.id)!;
    if (previous) a.flow!.tests.find(t => t.id === key)!.pass = {node: previous};
    a.flow!.entry = key;
    delete a.flow!.detached;
  } else next = connectFlat(next, option.before ? result.id : source, option.before ? source : result.id, option.port);
  const graph = compactGraph(next, flatGraph(next));
  const added = graph.nodes.find(n => n.id === result.id) ?? graph.nodes.find(n => !oldIds.has(n.id));
  if (!added || !graph.edges.some(e => e.source === added.id || e.target === added.id))
    throw Error(tr('연결된 새 카드를 만들 수 없습니다.'));
  return {workspace: next, id: added.id};
}
export function contextualAdds(w: Workspace, id: string, graph = flatGraph(w)): AddOption[] {
  const idRef = parseNodeId(id);
  if (idRef.kind === 'table') {
    const owner = idRef.owner;
    return w.actions.some(a => a.uid === owner && a.flow) ? [{label: tr('조건 규칙 추가'), kind: 'tableRow'}] : [];
  }
  const node = graph.nodes.find(n => n.id === id);
  if (!node) return [];
  const a = w.actions.find(a => a.uid === node.action),
    options: AddOption[] = [];
  if (node.kind === 'hkxPlay') {
    options.push(
      {label: tr('시작 키 입력 추가'), kind: 'keyInput', before: true},
      {label: tr('시작 이벤트 추가'), kind: 'markerReceive', before: true},
      {label: tr('전환 키 입력 추가'), kind: 'keyInput'},
      {label: tr('전환 이벤트 추가'), kind: 'markerReceive'},
      {label: tr('상태 조건 추가'), kind: 'stateCondition', before: true},
      {label: tr('진입 조건 분기 추가'), kind: 'conditionBranch', entry: true},
      {label: tr('앞에 블렌드 추가'), kind: 'blend', before: true},
      {label: tr('뒤에 블렌드 추가'), kind: 'blend'},
      {label: tr('다음 동작 추가'), kind: 'playNode'}
    );
    options.push({label: tr('바닐라 이벤트 차단 추가'), kind: 'suppress'});
    options.push({label: tr('QTE 추가'), kind: 'qte'});
    if (!a?.pair) options.push({label: tr('활 발사 추가'), kind: 'fireArrow'});
    // Only a carry's putdown Action takes a release moment (the runtime rejects it elsewhere).
    if (a && !a.pair && w.actions.some(x => x.pair?.carry?.putdownAction === a.uid))
      options.push({label: tr('대상 놓기 추가'), kind: 'carryRelease'});
    // A carry brings its fix item with it (at the lift's end by default), so there is no add for it.
    // Camera restore: any action (10-16, runtime 0.12.260); a carry is a pair's.
    options.push({label: tr('카메라 복구 추가'), kind: 'cameraRestore'});
    if (a?.pair) options.push({label: tr('운반 추가'), kind: 'carry'});
    for (const kind of notifyKinds.filter(k =>
      a?.pair ? k !== 'vanillaCancel' : ['rotate', 'iframe', 'armor', 'cost', 'recovery', 'vanillaCancel'].includes(k)
    ))
      options.push({label: title(kind) + tr(' 추가'), kind: 'notify:' + kind});
  } else if (node.kind === 'conditionBranch') {
    for (const port of ['pass', 'fail'])
      for (const kind of ['conditionBranch', 'playNode'])
        options.push({
          label: tr('{v0} → {v1} 추가', {
            v0: port === 'pass' ? tr('통과') : tr('실패'),
            v1: kind === 'playNode' ? tr('HKX 재생') : tr('조건 분기'),
          }),
          kind,
          port,
        });
  } else if (['keyInput', 'markerReceive', 'stateCondition', 'blend'].includes(node.kind)) {
    options.push({label: tr('다음 동작 추가'), kind: 'playNode'});
    if (['keyInput', 'markerReceive'].includes(node.kind)) options.push({label: tr('블렌드 추가'), kind: 'blend'});
  }
  return options
    .sort((a, b) => Number(b.kind === 'blend') - Number(a.kind === 'blend'))
    .filter(o => {
      if (o.kind === 'conditionBranch') return !!a;
      if (node.kind === 'conditionBranch' && o.kind === 'playNode') {
        const branch = a?.flow?.tests.find(t => t.id === branchTest(id));
        return !branch?.[o.port as 'pass' | 'fail'];
      }
      if (node.kind !== 'hkxPlay') return true;
      // A start needs a free start; a transition (key or event) leaves any single or pair HKX.
      if (o.kind === 'markerReceive') return o.before ? a?.config.start.mode === 'none' : a?.config.kind === 'single';
      if (o.kind === 'keyInput') return o.before ? a?.config.start.mode === 'none' : true;
      if (o.kind === 'stateCondition')
        return !graph.nodes.some(n => n.action === node.action && n.kind === 'stateCondition');
      if (o.kind === 'cameraRestore')
        return !graph.nodes.some(n => n.action === node.action && n.kind === 'cameraRestore');
      if (o.kind === 'carry') return !a?.pair?.carry;
      if (o.kind === 'suppress' || o.kind === 'fireArrow' || o.kind === 'carryRelease') return !a?.config[o.kind];
      // The next action: a new HKX joined by a transition (combos went with XML format 4).
      if (o.kind === 'playNode') return !!a && !!node.step;
      return true;
    });
}
