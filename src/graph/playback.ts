import type {Workspace} from '../workspace.ts';
import type {Input} from '../model.ts';
import {addLink, uid} from '../workspace.ts';
import {sourceWindow, setSourceWindow} from './clipWindows.ts';
import {keyCode} from '../model.ts';
import {tr} from '../i18n/korean.ts';

/** A transition between two actions (a runtime Connect), started by a key or by an event. Either end may be a
 *  pair: from a pair the destination is the starter's (attacker's) action and the partner's action is added
 *  on the transition's partner pin; a pair destination starts both of its roles. */
export function playbackLink(w: Workspace, from: string, to: string, trigger: Input | {event: string}) {
  const n = structuredClone(w),
    a = n.actions.find(a => a.uid === from)!,
    b = n.actions.find(a => a.uid === to)!;
  if (!a || !b || from === to) throw Error(tr('서로 다른 일반·페어 HKX 재생 카드를 연결하세요.'));
  if ('event' in trigger) {
    // The name may still be empty: the transition's details name it (validation reports it until then).
    const event = trigger.event.trim();
    if (event && n.links.some(l => l.from === from && l.mode === 'event' && l.event === event))
      throw Error(tr('같은 출발 HKX에 이미 연결된 이벤트입니다.'));
    const link = addLink(n, from, to);
    Object.assign(link, {mode: 'event', event, window: false});
    n.links.push(link);
    return {workspace: n, id: `link:${link.id}|markerReceive`};
  }
  const input = trigger;
  if (
    n.links.some(
      l =>
        l.from === from &&
        l.mode === 'input' &&
        (() => {
          const x = a.config.inputs.find(i => i.id === l.input);
          return (
            x &&
            ((input.key && x.key && keyCode(x.key) === keyCode(input.key)) ||
              (input.gamepad && x.gamepad === input.gamepad) ||
              (input.control && x.control === input.control))
          );
        })()
    )
  )
    throw Error(tr('같은 출발 HKX에 이미 연결된 키입니다.'));
  const id = uid(
    'input',
    a.config.inputs.map(i => i.id)
  );
  a.config.inputs.push({...structuredClone(input), id});
  const value = sourceWindow(a, a.config.entry).value;
  // An ordinary HKX shares one detection window across its key transitions (sourceLinks); a pair's
  // transitions keep their own.
  if (!a.pair) Object.assign(a, setSourceWindow(a, a.config.entry, value));
  const link = addLink(n, from, to);
  Object.assign(link, {mode: 'input', input: id, window: true, ...structuredClone(value)});
  n.links.push(link);
  return {workspace: n, id: `link:${link.id}|keyInput`};
}

/** Whether a key transition takes its source HKX's shared detection window (unless it keeps its own). */
export function sharesSourceWindow(w: Workspace, l: Workspace['links'][number]) {
  const a = w.actions.find(a => a.uid === l.from);
  return !!a?.nodeAuthored && !a.pair && a.config.steps.length === 1 && l.mode === 'input';
}
export function sourceLinks(w: Workspace): Workspace {
  return {
    ...w,
    links: w.links.map(l => {
      const a = w.actions.find(a => a.uid === l.from);
      return a && sharesSourceWindow(w, l) && !l.ownWindow
        ? {...l, window: true, ...structuredClone(sourceWindow(a, a.config.entry).value)}
        : l;
    }),
  };
}
