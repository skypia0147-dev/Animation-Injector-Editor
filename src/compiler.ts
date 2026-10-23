import {uniqueEvents} from './runtimeExtensions.ts';
import {validate} from './model.ts';
import type {Project, Mark, Input} from './model.ts';
import {gamepadXml} from './keys.ts';
import {node} from './xml.ts';
import type {Xml} from './xml.ts';
const stamp = (m: Mark, basis = m.basis) =>
  basis === 'end' ? (m.seconds ? 'end-' + m.seconds : 'end') : String(m.seconds);
// An event moment waits for its event only (runtime 0.12.278): no time for when it does not come.
export const clock2 = (name: string, m: Mark) => ({
  [name]: m.basis === 'event' ? 'event:' + m.event : stamp(m),
});
/** The attributes without those whose value is the runtime's omitted one (format 4: the omitted value is the
 *  editor's new value and the documented one, so the XML shows only what was chosen). */
export function omitDefaults(attrs: Record<string, unknown>, defaults: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(attrs).filter(
      ([k, v]) => v !== undefined && !(Object.hasOwn(defaults, k) && String(v) === String(defaults[k]))
    )
  );
}
/** A key written where it is used (format 4): key= and gamepad= by the button's name. */
export const keyAttrs = (i: Pick<Input, 'key' | 'gamepad'> | undefined) => ({
  key: i?.key || undefined,
  gamepad: i?.gamepad ? gamepadXml(i.gamepad) : undefined,
});
/** A <Window>'s attributes: from defaults to the clip start, until to its end, and the buffer is on. */
export const windowAttrs = (open: Mark, close: Mark, buffered: boolean) =>
  omitDefaults(
    {...clock2('from', open), ...clock2('until', close), buffer: buffered},
    {from: '0', until: 'end', buffer: true}
  );
/** An action's own settings as the runtime reads them (format 4). The workspace adds the rest (workspace.ts). */
export function actionXml(p: Project, pair = false, selecting = false): Xml {
  const errors = validate(p, selecting).filter(i => i.level === 'error');
  if (errors.length) throw new Error(errors.map(i => i.message).join('\n'));
  // A selecting action (workspace.ts selectsOnly) has no clip of its own (runtime 0.12.244).
  const out = node('Action', {id: p.actionId, clip: selecting ? undefined : p.steps[0].clip});
  // An element whose every attribute is the default is left out, unless its presence is the setting.
  const add = (
    name: string,
    attrs: Record<string, unknown>,
    defaults: Record<string, unknown> = {},
    always = false
  ) => {
    const kept = omitDefaults(attrs, defaults);
    if (always || Object.keys(kept).length) out.children.push(node(name, kept));
  };
  if (p.start.mode === 'input')
    add(
      'Start',
      {...keyAttrs(p.inputs.find(i => i.id === p.start.input)), onKeyUp: p.start.onKeyUp},
      {onKeyUp: false},
      true
    );
  else if (p.start.mode === 'event')
    add(
      'Start',
      {event: p.start.event, actor: p.start.actor, onKeyUp: p.start.onKeyUp},
      {actor: 'both', onKeyUp: false},
      true
    );
  add(
    'Require',
    // 시작 제한 (runtime 0.12.276): the action's own nature; a state check is a condition branch's test.
    {air: p.air, cooldown: p.cooldown},
    {air: 'deny', cooldown: 0}
  );
  // The workspace drops a blend that is off (the graph's own transition then applies).
  add('Enter', {blend: p.enterBlend}, {}, true);
  add('Exit', {...clock2('at', p.exit), blend: p.exitBlend}, {at: 'end-0.05'}, true);
  if (p.rotationLocked) add('Rotate', {locked: true});
  const names = {rotate: 'Rotate', iframe: 'IFrame', armor: 'HyperArmor'};
  for (const name of Object.keys(names) as (keyof typeof names)[]) {
    const s = p.slots[name];
    if (s.enabled && !(name === 'rotate' && p.rotationLocked))
      add(names[name], {...clock2('from', s.from), ...clock2('until', s.until)}, {from: '0', until: 'end'}, true);
  }
  const recovery = p.steps[0]?.recovery ?? p.recovery;
  if (recovery.enabled) add('Recovery', {...clock2('at', recovery.at), blend: recovery.blend});
  if (p.cost.enabled)
    add(
      'Cost',
      {...clock2('at', p.cost.at), stamina: p.cost.stamina, magicka: p.cost.magicka},
      {at: '0', stamina: 0, magicka: 0},
      true
    );
  // A direct shot (runtime 0.12.268) has no release shot: no onRelease, its damage percent instead. Without its own
  // shot (no time, no release) the action writes none: the HKX shoots only on the registry's events.
  if (p.fireArrow && (p.fireArrow.at || p.fireArrow.onRelease))
    add(
      'FireArrow',
      p.fireArrow.mode === 'direct'
        ? {
            ...(p.fireArrow.at ? clock2('at', p.fireArrow.at) : {}),
            mode: 'direct',
            damage: p.fireArrow.damage ?? 100,
          }
        : {...(p.fireArrow.at ? clock2('at', p.fireArrow.at) : {}), onRelease: p.fireArrow.onRelease},
      {onRelease: true, damage: 100},
      true
    );
  if (p.carryRelease) add('CarryRelease', clock2('at', p.carryRelease.at));
  if (p.suppress)
    add('Suppress', {events: uniqueEvents(p.suppress.events).join(','), when: p.suppress.when}, {when: 'startable'});
  const attack = p.steps[0].attack || p.attack;
  if (attack) add('Attack', {data: attack});
  return out;
}
