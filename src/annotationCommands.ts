import {tr} from './i18n/korean.ts';
import {functionParts, opInfo, ragdollDirections, settingLabels, type EventOp} from './eventRegistry.ts';

/** Commands a clip's annotation carries under the reserved event "AI" (runtime 0.12.274, AnnotationCommands.h),
 *  the way Payload Interpreter reads "PIE.@COMMAND|...": "AI.CamShake|1.5|0.5" is the event "AI" with the payload
 *  "CamShake|1.5|0.5". No XML declares them. Every event function but a strike is one (runtime 11-02,
 *  docs/mockup-ai-commands), run on the actor that sent it with the annotation's values. */
export const commandEvent = 'AI';

type Field = {key: string; check: (text: string) => boolean};
const numberText = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/; // std::from_chars takes no leading '+'
const num = (key: string, min: number, max: number): Field => ({
  key,
  check: t => numberText.test(t) && Number.isFinite(Number(t)) && Number(t) >= min && Number(t) <= max,
});
const any = (key: string): Field => num(key, -3.4e38, 3.4e38);
const plugin: Field = {key: 'plugin', check: t => !!t && !/[\\/:]/.test(t)};
const form: Field = {key: 'form', check: t => /^(?:0x)?[\da-f]{1,8}$/i.test(t)};
const file: Field = {key: 'file', check: t => !!t && !/:|^[\\/]|\.\./.test(t)};
const bone: Field = {key: 'bone', check: t => ['spine', 'head', 'rightHand', 'leftHand', 'root'].includes(t)};
const direction: Field = {key: 'direction', check: t => (ragdollDirections as readonly string[]).includes(t)};
const costs = (most: number) => [num('stamina', 0, most), num('magicka', 0, most), num('health', 0, most)];
/** Each command: its function, its values in order, and whether a window's on may add a span last. */
const commands: {name: string; op: EventOp; fields: Field[]; span?: true; extra?: Record<string, string>}[] = [
  {name: 'IFrameOn', op: 'iframeOn', fields: [], span: true},
  {name: 'IFrameOff', op: 'iframeOff', fields: []},
  {name: 'ArmorOn', op: 'armorOn', fields: [], span: true},
  {name: 'ArmorOff', op: 'armorOff', fields: []},
  {name: 'RotateOn', op: 'rotateOn', fields: [], span: true},
  {name: 'RotateOff', op: 'rotateOff', fields: []},
  {name: 'TimeOn', op: 'timeOn', fields: [num('factor', 0.05, 5), num('ease', 0, 2)], span: true},
  {name: 'TimeOff', op: 'timeOff', fields: []},
  {name: 'Hide', op: 'hide', fields: []},
  {name: 'Show', op: 'show', fields: []},
  {name: 'MagicAdd', op: 'magicAdd', fields: [plugin, form]},
  {name: 'MagicRemove', op: 'magicRemove', fields: [plugin, form]},
  {name: 'MagicCast', op: 'magicCast', fields: [plugin, form]},
  {name: 'Cost', op: 'cost', fields: costs(100000)},
  {name: 'CostPercent', op: 'cost', fields: costs(100), extra: {measure: 'percent'}},
  {name: 'CamShake', op: 'shake', fields: [num('strength', 0, 10), num('duration', 0, 30)]},
  {name: 'StopVelocity', op: 'stopVelocity', fields: []},
  {name: 'Ragdoll', op: 'ragdoll', fields: [direction, num('force', 0, 20)]},
  {name: 'FireArrow', op: 'fireArrow', fields: [num('damage', 1, 1000)]},
  {name: 'Sound', op: 'sound', fields: [file, bone, num('volume', 0, 1)]},
  {name: 'SoundForm', op: 'sound', fields: [plugin, form, bone, num('volume', 0, 1)]},
  {name: 'GlobalSet', op: 'globalSet', fields: [plugin, form, any('value')]},
  {
    name: 'ModEvent',
    op: 'modEvent',
    fields: [{key: 'name', check: t => !!t}, {key: 'text', check: () => true}, any('number')],
  },
  {name: 'CancelPair', op: 'cancel', fields: []},
];
const byName = (payload: string) => commands.find(c => c.name.toLowerCase() === payload.split('|')[0].toLowerCase());

/** The runtime's Parse: "Name|value|..." with every value written (runtime 0.12.275; the name ignores case), a
 *  window's on with an optional span (0~60 seconds) last. The function's values as a registered one holds them (a
 *  span as its `duration`); undefined for anything else. */
export function parseCommand(payload: string): Record<string, string> | undefined {
  const c = byName(payload);
  if (!c) return undefined;
  const fields = payload.split('|').slice(1);
  const timed = !!c.span && fields.length === c.fields.length + 1;
  if (fields.length !== c.fields.length && !timed) return undefined;
  const values: Record<string, string> = {op: c.op, ...c.extra};
  for (const [i, f] of c.fields.entries()) {
    if (!f.check(fields[i])) return undefined;
    values[f.key] = f.key === 'form' ? fields[i].replace(/^0x/i, '') : fields[i];
  }
  if (timed) {
    if (!num('duration', 0, 60).check(fields[c.fields.length])) return undefined;
    if (Number(fields[c.fields.length]) > 0) values.duration = fields[c.fields.length];
  }
  return values;
}
/** How a known command is written, for a warning: "AI.TimeOn|배율|전환 시간(초)[|지속 시간(초)]". */
export function commandUsage(payload: string): string | undefined {
  const c = byName(payload);
  return (
    c &&
    ['AI.' + c.name, ...c.fields.map(f => settingLabels[f.key] ?? f.key)].join('|') +
      (c.span ? '[|' + tr('지속 시간(초)') + ']' : '')
  );
}
/** What a command does, for the HKX card. */
export function commandSummary(payload: string): string | undefined {
  const v = parseCommand(payload);
  return v && [opInfo[v.op as EventOp].label, ...functionParts(v)].join(' · ');
}
