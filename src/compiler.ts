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
export const keyAttrs = (i: Pick<Input, 'key' | 'gamepad' | 'control'> | undefined) =>
  i?.control
    ? {control: i.control}
    : {
        key: i?.key || undefined,
        gamepad: i?.gamepad ? gamepadXml(i.gamepad) : undefined,
      };
/** A transition's window attributes (format 6, on <Transition>/<Vanilla>): from defaults to the clip start, until
 *  to its end, and the buffer is on. */
export const windowAttrs = (open: Mark, close: Mark, buffered: boolean) =>
  omitDefaults(
    {...clock2('from', open), ...clock2('until', close), buffer: buffered},
    {from: '0', until: 'end', buffer: true}
  );
/** An HKX card's own settings as the runtime reads them (format 6, <Action> attributes and its moments). The workspace
 *  adds the rest (workspace.ts actionElement): QTEs, vanilla transitions, pair settings, functions, transitions. */
export function actionXml(p: Project, a: {enterBlendEnabled: boolean; exitBlendEnabled: boolean}): Xml {
  const errors = validate(p).filter(i => i.level === 'error');
  if (errors.length) throw new Error(errors.map(i => i.message).join('\n'));
  const attack = p.steps[0].attack || p.attack;
  const out = node('Action', {
    id: p.actionId,
    clip: p.steps[0].clip,
    air: p.air === 'allow' ? 'both' : p.air === 'only' ? 'only' : undefined,
    attack: attack || undefined,
    // The workspace drops a blend that is off (the graph's own transition then applies).
    enter: a.enterBlendEnabled ? p.enterBlend : undefined,
    block: p.suppress ? uniqueEvents(p.suppress.events).join(',') : undefined,
  });
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
  add('Exit', {...clock2('at', p.exit), blend: a.exitBlendEnabled ? p.exitBlend : undefined}, {at: 'end-0.05'});
  if (p.rotationLocked) add('Rotate', {locked: true});
  const names = {rotate: 'Rotate', iframe: 'IFrame', armor: 'HyperArmor'};
  for (const name of Object.keys(names) as (keyof typeof names)[]) {
    const s = p.slots[name];
    if (s.enabled && !(name === 'rotate' && p.rotationLocked))
      add(names[name], {...clock2('from', s.from), ...clock2('until', s.until)}, {from: '0', until: 'end'}, true);
  }
  const recovery = p.steps[0]?.recovery ?? p.recovery;
  if (recovery.enabled) add('MoveCancel', {...clock2('at', recovery.at), blend: recovery.blend});
  if (p.cost.enabled)
    add(
      'Cost',
      {...clock2('at', p.cost.at), stamina: p.cost.stamina, magicka: p.cost.magicka},
      {at: '0', stamina: 0, magicka: 0},
      true
    );
  if (p.carryRelease) add('CarryRelease', clock2('at', p.carryRelease.at));
  return out;
}
