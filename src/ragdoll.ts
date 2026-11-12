import {documentXml, node, parseXml} from './xml.ts';
import {rigBones} from './rigBones.ts';
import {tr} from './i18n/korean.ts';
import type {Action, Workspace} from './workspace.ts';

// A carry's ragdoll values (runtime/RagdollProfile.h): one file per lift action next to its action XML,
// <folder>/Ragdoll/<lift action id>.xml, every value written. Without a file the runtime uses vanilla values
// (RagdollProfile::BuiltIn), which builtInRagdoll mirrors. Ranges and names are the runtime parser's.

export type RagdollMotion = {
  follow: number;
  gravity: number;
  drag: number;
  spin: number;
  inertia: number;
  /** null = the native joints' friction. */
  friction: number | null;
};
export type RagdollBody = {
  bone: string;
  /** false: the body follows the lift pose instead of swaying. */
  simulate: boolean;
  /** This body's own values; null = the Motion value (or the native joint for friction and the limits). */
  drag: number | null;
  spin: number | null;
  gravity: number | null;
  inertia: number | null;
  friction: number | null;
  /** The joint to the body above, degrees: cone maximum, plane and twist minimum and maximum. */
  cone: number | null;
  plane: [number, number] | null;
  twist: [number, number] | null;
  /** A bodiless bone between this body and the one above that the joint pivots on; '' = none. */
  swingFrom: string;
};
export type Ragdoll = {rig: string; motion: RagdollMotion; bodies: RagdollBody[]};

/** Each value's range, as RagdollProfile::Parse reads it. */
export const ragdollRanges = {
  follow: [0, 1],
  gravity: [1, 4],
  drag: [0, 10],
  spin: [0, 10],
  inertia: [1, 10],
  friction: [0, 100],
  cone: [0, 180],
  plane: [-90, 90],
  twist: [-180, 180],
} as const;

export const emptyRagdollBody = (bone: string, simulate = true): RagdollBody => ({
  bone,
  simulate,
  drag: null,
  spin: null,
  gravity: null,
  inertia: null,
  friction: null,
  cone: null,
  plane: null,
  twist: null,
  swingFrom: '',
});
/** The ragdoll bodies of a rig (skeleton.nif, rigBones.ts); none for a rig without a table. */
export const ragdollBodies = (rig: string): string[] => rigBones[rig]?.bodies ?? [];

/** The built-in values (RagdollProfile::BuiltIn): vanilla for every rig — the game's own ragdoll values (damping
 *  "at least 0" and gravity 1 keep the native ones, no follow share, every body simulating), every body listed. */
export function builtInRagdoll(rig: string): Ragdoll {
  return completeRagdoll({
    rig,
    motion: {follow: 0, gravity: 1, drag: 0, spin: 0, inertia: 1, friction: null},
    bodies: [],
  });
}

/** Every body of the rig listed, in the rig's order (a body the file leaves out swings with the Motion values);
 *  bodies the rig table does not know are kept after them. */
export function completeRagdoll(r: Ragdoll): Ragdoll {
  const listed = new Map(r.bodies.map(b => [b.bone.toLowerCase(), b]));
  const rigOrder = ragdollBodies(r.rig);
  const bodies = rigOrder.map(bone => listed.get(bone.toLowerCase()) ?? emptyRagdollBody(bone));
  const known = new Set(rigOrder.map(b => b.toLowerCase()));
  return {...r, bodies: [...bodies, ...r.bodies.filter(b => !known.has(b.bone.toLowerCase()))]};
}

/** The values a lift's own file starts from in the editor, whatever the rig (user decision 11-04): follow 1,
 *  gravity 4, damping 10 / 10, inertia 10, vanilla joint friction, every body simulating. */
export function appDefaultRagdoll(rig: string): Ragdoll {
  return completeRagdoll({
    rig,
    motion: {follow: 1, gravity: 4, drag: 10, spin: 10, inertia: 10, friction: null},
    bodies: [],
  });
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);
const pair = (v: [number, number]) => num(v[0]) + ' ' + num(v[1]);
/** The file the runtime reads: every value written, every body listed. */
export function ragdollXml(r: Ragdoll): string {
  const m = r.motion;
  return documentXml(
    node('Ragdoll', {rig: r.rig, version: 1}, [
      node('Motion', {
        follow: num(m.follow),
        gravity: num(m.gravity),
        drag: num(m.drag),
        spin: num(m.spin),
        inertia: num(m.inertia),
        friction: m.friction === null ? undefined : num(m.friction),
      }),
      ...completeRagdoll(r).bodies.map(b =>
        node('Body', {
          bone: b.bone,
          simulate: b.simulate ? 'true' : 'false',
          drag: b.drag === null ? undefined : num(b.drag),
          spin: b.spin === null ? undefined : num(b.spin),
          gravity: b.gravity === null ? undefined : num(b.gravity),
          inertia: b.inertia === null ? undefined : num(b.inertia),
          friction: b.friction === null ? undefined : num(b.friction),
          cone: b.cone === null ? undefined : num(b.cone),
          plane: b.plane ? pair(b.plane) : undefined,
          twist: b.twist ? pair(b.twist) : undefined,
          swingFrom: b.swingFrom || undefined,
        })
      ),
    ])
  );
}

/** A ragdoll file read with the runtime's rules (RagdollProfile::Parse): an unknown element or attribute, a value
 *  out of range or a repeated bone rejects it. `rig` is the lift target's: another rig's file is rejected too. */
export function parseRagdoll(text: string, rig: string): {ragdoll: Ragdoll} | {error: string} {
  try {
    const root = parseXml(text);
    if (root.name !== 'Ragdoll') return {error: tr('최상위 요소가 <Ragdoll>이 아닙니다.')};
    const known = (attrs: Record<string, string>, names: string[], where: string) => {
      for (const k of Object.keys(attrs))
        if (!names.includes(k)) throw new Error(tr('{where}: 알 수 없는 속성 {name}', {where, name: k}));
    };
    known(root.attrs, ['rig', 'version'], '<Ragdoll>');
    if (root.attrs.version !== '1') return {error: tr('<Ragdoll version>은 1이어야 합니다.')};
    const fileRig = root.attrs.rig ?? '';
    if (!fileRig || fileRig.toLowerCase() !== rig.toLowerCase())
      return {error: tr('파일의 리그 {file}가 들기 대상 리그 {rig}와 다릅니다.', {file: fileRig, rig})};
    const scalar = (attrs: Record<string, string>, key: keyof typeof ragdollRanges, where: string) => {
      const text = attrs[key];
      if (text === undefined) return null;
      const v = Number(text.trim());
      const [lo, hi] = ragdollRanges[key];
      if (!text.trim() || !Number.isFinite(v) || v < lo || v > hi)
        throw new Error(tr('{where} {key}="{text}": {lo}~{hi} 사이의 숫자여야 합니다.', {where, key, text, lo, hi}));
      return v;
    };
    const range = (attrs: Record<string, string>, key: 'plane' | 'twist', where: string): [number, number] | null => {
      const text = attrs[key];
      if (text === undefined) return null;
      const parts = text.trim().split(/[\s,]+/);
      const [lo, hi] = parts.map(Number);
      const limit = ragdollRanges[key][1];
      if (parts.length !== 2 || !Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi || lo < -limit || hi > limit)
        throw new Error(
          tr('{where} {key}="{text}": 「최소 최대」 도, ±{limit} 안이어야 합니다.', {where, key, text, limit})
        );
      return [lo, hi];
    };
    let motion: RagdollMotion | null = null;
    const bodies: RagdollBody[] = [];
    for (const c of root.children) {
      if (c.name === 'Motion') {
        if (motion) throw new Error(tr('<Motion>은 하나만 쓸 수 있습니다.'));
        known(c.attrs, ['follow', 'gravity', 'drag', 'spin', 'inertia', 'friction'], '<Motion>');
        // An attribute the file leaves out keeps the runtime's Dynamics default.
        motion = {
          follow: scalar(c.attrs, 'follow', '<Motion>') ?? 0,
          gravity: scalar(c.attrs, 'gravity', '<Motion>') ?? 1,
          drag: scalar(c.attrs, 'drag', '<Motion>') ?? 0.8,
          spin: scalar(c.attrs, 'spin', '<Motion>') ?? 3,
          inertia: scalar(c.attrs, 'inertia', '<Motion>') ?? 1,
          friction: scalar(c.attrs, 'friction', '<Motion>'),
        };
      } else if (c.name === 'Body') {
        const bone = c.attrs.bone ?? '';
        const where = `<Body bone="${bone}">`;
        known(
          c.attrs,
          ['bone', 'simulate', 'drag', 'spin', 'gravity', 'inertia', 'friction', 'cone', 'plane', 'twist', 'swingFrom'],
          where
        );
        if (!bone) throw new Error(tr('<Body>에 bone이 없습니다.'));
        if (bodies.some(b => b.bone.toLowerCase() === bone.toLowerCase()))
          throw new Error(tr('{where}: 같은 뼈가 두 번 있습니다.', {where}));
        const simulate = c.attrs.simulate;
        if (simulate !== undefined && simulate !== 'true' && simulate !== 'false')
          throw new Error(tr('{where} simulate: true 또는 false여야 합니다.', {where}));
        if (c.attrs.swingFrom !== undefined && !c.attrs.swingFrom)
          throw new Error(tr('{where} swingFrom: 뼈 이름이 비었습니다.', {where}));
        bodies.push({
          bone,
          simulate: simulate !== 'false',
          drag: scalar(c.attrs, 'drag', where),
          spin: scalar(c.attrs, 'spin', where),
          gravity: scalar(c.attrs, 'gravity', where),
          inertia: scalar(c.attrs, 'inertia', where),
          friction: scalar(c.attrs, 'friction', where),
          cone: scalar(c.attrs, 'cone', where),
          plane: range(c.attrs, 'plane', where),
          twist: range(c.attrs, 'twist', where),
          swingFrom: c.attrs.swingFrom ?? '',
        });
      } else throw new Error(tr('알 수 없는 요소 <{name}>', {name: c.name}));
    }
    return {
      ragdoll: completeRagdoll({
        rig: fileRig,
        motion: motion ?? {follow: 0, gravity: 1, drag: 0.8, spin: 3, inertia: 1, friction: null},
        bodies,
      }),
    };
  } catch (e) {
    return {error: e instanceof Error ? e.message : String(e)};
  }
}

/** A project's ragdoll values as stored (workspace.ts parse): every field present and in range. */
export function validRagdoll(r: unknown): r is Ragdoll {
  if (!r || typeof r !== 'object') return false;
  const v = r as Ragdoll;
  if (typeof v.rig !== 'string' || !v.motion || !Array.isArray(v.bodies) || v.bodies.length > 512) return false;
  return 'ragdoll' in parseRagdoll(ragdollXml(v), v.rig);
}

// ---- the project's ragdoll files ----

/** The carry lift actions: their file name (the action ID) and the lifted target's rig. */
export function carryLifts(w: Workspace): {action: Action; id: string; rig: string}[] {
  return w.actions
    .filter(a => a.pair?.carry)
    .map(a => ({action: a, id: a.config.actionId, rig: a.pair!.targetRig ?? 'character'}));
}

/** The files read beside an opened XML put into the lifts: a valid one becomes its values, a missing one the
 *  built-in values (null), a rejected one is reported and kept on disk untouched (`rejected`). A file that could not
 *  be read at all (`error`: not UTF-8, too large) is rejected the same way, so the document still opens. */
export function applyRagdollFiles(
  w: Workspace,
  read: {id: string; contents: string | null; error?: string | null}[]
): {workspace: Workspace; errors: string[]; rejected: string[]} {
  const byId = new Map(read.map(r => [r.id.toLowerCase(), r]));
  const errors: string[] = [],
    rejected: string[] = [];
  const actions = w.actions.map(a => {
    const carry = a.pair?.carry;
    if (!carry) return a;
    const file = byId.get(a.config.actionId.toLowerCase());
    const contents = file?.contents ?? null;
    let ragdoll: Ragdoll | null = null;
    if (file?.error) {
      errors.push(`Ragdoll\\${a.config.actionId}.xml: ${file.error}`);
      rejected.push(a.config.actionId);
    } else if (contents !== null) {
      const parsed = parseRagdoll(contents, a.pair!.targetRig ?? 'character');
      if ('ragdoll' in parsed) ragdoll = parsed.ragdoll;
      else {
        errors.push(`Ragdoll\\${a.config.actionId}.xml: ${parsed.error}`);
        rejected.push(a.config.actionId);
      }
    }
    return {...a, pair: {...a.pair!, carry: {...carry, ragdoll}}};
  });
  return {workspace: {...w, actions}, errors, rejected};
}

/** What Save writes beside the XML: every lift with its own values; removed are the lifts back on the built-in
 *  values and the files of lifts since renamed or deleted (`previous`, the ids read or written last). A file that
 *  was rejected when the document opened is left alone. */
export function ragdollWrites(
  w: Workspace,
  previous: string[],
  rejected: string[]
): {files: {id: string; contents: string}[]; remove: string[]} {
  const keep = new Set(rejected.map(id => id.toLowerCase()));
  const lifts = carryLifts(w);
  const files = lifts
    .filter(l => l.action.pair!.carry!.ragdoll)
    .map(l => ({id: l.id, contents: ragdollXml({...l.action.pair!.carry!.ragdoll!, rig: l.rig})}));
  const written = new Set(files.map(f => f.id.toLowerCase()));
  const remove = [...new Set([...lifts.map(l => l.id), ...previous])].filter(
    id => !written.has(id.toLowerCase()) && !keep.has(id.toLowerCase())
  );
  return {files, remove};
}

/** The project as the XML's editor block keeps it: without the carries' ragdoll values, which their files hold. */
export function withoutRagdolls(project: string): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        if (k === 'carry' && v && typeof v === 'object' && !Array.isArray(v)) {
          const {ragdoll: _ragdoll, ...carry} = v as Record<string, unknown>;
          return [k, carry];
        }
        return [k, strip(v)];
      })
    );
  };
  return JSON.stringify(strip(JSON.parse(project)));
}
