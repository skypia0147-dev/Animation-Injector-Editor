import {tr} from './i18n/korean.ts';

/** Commands a clip's annotation carries under the reserved event "AI" (runtime 0.12.274, AnnotationCommands.h),
 *  the way Payload Interpreter reads "PIE.@COMMAND|...": "AI.CamShake|1.5|0.5" is the event "AI" with the payload
 *  "CamShake|1.5|0.5". No XML declares them. */
export const commandEvent = 'AI';
export type AnnotationCommand = {command: 'CamShake'; strength: number; duration: number};

/** The runtime's Parse: "CamShake|strength|duration" (strength 0~10, duration 0~30, both written: runtime
 *  0.12.275; the name ignores case). undefined for anything else. */
export function parseCommand(payload: string): AnnotationCommand | undefined {
  const fields = payload.split('|');
  if (fields.length !== 3 || fields[0].toLowerCase() !== 'camshake') return undefined;
  const number = (text: string, max: number) => {
    // std::from_chars takes no leading '+'.
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return undefined;
    const v = Number(text);
    return Number.isFinite(v) && v >= 0 && v <= max ? v : undefined;
  };
  const strength = number(fields[1], 10),
    duration = number(fields[2], 30);
  if (strength === undefined || duration === undefined) return undefined;
  return {command: 'CamShake', strength, duration};
}
/** What a command does, for the HKX card. */
export function commandSummary(payload: string): string | undefined {
  const c = parseCommand(payload);
  return c && tr('카메라 흔들림 · 세기 {s} · {d}초', {s: c.strength, d: c.duration});
}
/** The annotation text for a shake. */
export const camShakeText = (strength: number, duration: number) => `${commandEvent}.CamShake|${strength}|${duration}`;
