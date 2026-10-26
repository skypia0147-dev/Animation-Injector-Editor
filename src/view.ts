// Camera views (runtime 0.12.225, AnimationInjector runtime/ViewSpec.h): where an action plays.
//   - third: the third-person graphs (NPCs, the third-person player); HKX under Actors\Character\<clip>
//   - first: the player's first-person graph; HKX under Actors\Character\_1stPerson\<clip>
//   - both: either, the camera at the start chooses; the same relative path in both folders
// The project default is <AnimationSet view>; an action's own view overrides it. Pairs, carries and a
// carry's putdown Action play in third person whatever the file says. A third-person action started by
// the player in first person either does not start (block, default) or switches to third person and
// back when it ends (firstPerson="switch"). A change of view while an action plays cancels it.
import type {Action, Workspace} from './workspace.ts';
import type {Issue, Step} from './model.ts';
import {assetKey} from './package.ts';
import {registerAssets} from './assets.ts';
import {clone} from './model.ts';
import {tr} from './i18n/korean.ts';

export type View = 'third' | 'first' | 'both';
export type FirstPersonStart = 'block' | 'switch';
export const views: readonly View[] = ['third', 'first', 'both'];
export const firstPersonStarts: readonly FirstPersonStart[] = ['block', 'switch'];

/** The first-person project reads a clip's relative path under this folder of Actors\Character. */
export const FIRST_PERSON_FOLDER = '_1stPerson';
const firstPersonPrefix = /^_1stperson[\\/]+/i;
export const isFirstPersonClip = (clip: string) => firstPersonPrefix.test(clip);
/** A game-relative path under Actors\Character\_1stPerson without the folder: the XML clip. */
export const stripFirstPerson = (clip: string) => clip.replace(firstPersonPrefix, '');
/** The first-person copy of a clip, relative to Actors\Character (how the asset library keys it). */
export const firstPersonClip = (clip: string) => FIRST_PERSON_FOLDER + '\\' + stripFirstPerson(clip);

export const inThird = (v: View) => v !== 'first';
export const inFirst = (v: View) => v !== 'third';
export const projectView = (w: Workspace): View => w.view ?? 'third';
/** Why an action plays in third person whatever its view: a pair (carries are pairs) or a carry's putdown. */
export function fixedThird(w: Workspace, a: Action): 'pair' | 'putdown' | '' {
  if (a.pair) return 'pair';
  return w.actions.some(x => x.pair?.carry?.putdownAction === a.uid) ? 'putdown' : '';
}
/** The view the runtime gives the action. */
export function actionView(w: Workspace, a: Action): View {
  return fixedThird(w, a) ? 'third' : (a.view ?? projectView(w));
}
/** The player's start in first person; only a third-person action has one. */
export const firstPersonStart = (w: Workspace, a: Action): FirstPersonStart =>
  actionView(w, a) === 'third' ? (a.firstPerson ?? 'block') : 'block';

/** Sets the project default; overrides equal to it are dropped (they mean the same). */
export function setProjectView(w: Workspace, view: View): Workspace {
  const next = clone(w);
  if (view === 'third') delete next.view;
  else next.view = view;
  for (const a of next.actions) if (a.view === view) delete a.view;
  return next;
}
/** Sets an action's view: the project default is stored as no override. */
export function setActionView(w: Workspace, uid: string, view: View): Workspace {
  const next = clone(w),
    a = next.actions.find(a => a.uid === uid);
  if (!a) throw new Error(tr('동작을 찾지 못했습니다.'));
  if (fixedThird(next, a) && view !== 'third')
    throw new Error(tr('페어·운반(내려놓기 포함)은 3인칭으로만 재생됩니다.'));
  if (view === projectView(next)) delete a.view;
  else a.view = view;
  return next;
}
export function setFirstPersonStart(w: Workspace, uid: string, start: FirstPersonStart): Workspace {
  const next = clone(w),
    a = next.actions.find(a => a.uid === uid);
  if (!a) throw new Error(tr('동작을 찾지 못했습니다.'));
  if (start === 'block') delete a.firstPerson;
  else a.firstPerson = start;
  return next;
}

/** The files a step needs in the game, relative to Actors\Character: its clip in third person, its
 *  first-person copy (_1stPerson\<clip>) in first person. */
export function stepFiles(w: Workspace, a: Action, s: Step): {clip: string; firstPerson: boolean}[] {
  const view = actionView(w, a);
  return [
    ...(inThird(view) ? [{clip: s.clip, firstPerson: false}] : []),
    ...(inFirst(view) && s.clip ? [{clip: firstPersonClip(s.clip), firstPerson: true}] : []),
  ];
}
/** The registered source of a game-relative file (the asset library), '' when none. */
export const librarySource = (w: Workspace, clip: string) =>
  w.assets.find(x => assetKey(x.clip) === assetKey(clip))?.localPath ?? '';
export type Person = 'third' | 'first';
/** The person a preview of the action shows: its own for third or first, the chosen one for `both`. */
export const previewPerson = (w: Workspace, a: Action, chosen: Person = 'third'): Person => {
  const view = actionView(w, a);
  return view === 'both' ? chosen : view;
};
/** The file the editor reads for a step's HKX data (annotations, length, the viewport): the
 *  first-person copy when `person` is first (by default for a first-person action), else the clip. */
export function stepSource(
  w: Workspace,
  a: Action,
  s: Step,
  person: Person = previewPerson(w, a)
): {clip: string; path: string} {
  if (person === 'first') {
    const clip = firstPersonClip(s.clip);
    return {clip, path: librarySource(w, clip)};
  }
  return {clip: s.clip, path: s.localPath || librarySource(w, s.clip)};
}

/** Assigns a step's first-person HKX: a file under Actors\Character\_1stPerson. A first-person action
 *  takes its clip from it; for `both` it must be the third-person clip's path. `path` '' = typed path. */
export function assignFirstPerson(w: Workspace, uid: string, stepId: string, clip: string, path: string): Workspace {
  const a = w.actions.find(a => a.uid === uid),
    s = a?.config.steps.find(s => s.id === stepId);
  if (!a || !s) throw new Error(tr('HKX를 찾지 못했습니다.'));
  if (path && !isFirstPersonClip(clip))
    throw new Error(
      tr('1인칭 HKX는 meshes\\actors\\character\\{FIRST_PERSON_FOLDER} 아래의 파일을 고르세요.', {FIRST_PERSON_FOLDER})
    );
  const relative = stripFirstPerson(clip);
  if (actionView(w, a) === 'both' && assetKey(relative) !== assetKey(s.clip))
    throw new Error(tr('1인칭 파일은 3인칭과 같은 상대 경로여야 합니다: {v0}', {v0: firstPersonClip(s.clip)}));
  let next = path ? registerAssets(w, [{clip: firstPersonClip(relative), path}]) : clone(w);
  if (actionView(next, a) === 'first' && assetKey(relative) !== assetKey(s.clip)) {
    const step = next.actions.find(x => x.uid === uid)!.config.steps.find(x => x.id === stepId)!;
    step.clip = relative;
    step.localPath = ''; // a third-person source of the old clip
  }
  return next;
}

/** A file dropped or picked for a step's HKX, third- or first-person by its folder. The action's view
 *  follows the file: a first-person file on a third-person action makes it `both` when it is the same
 *  animation (same relative path), else `first`; a third-person file on a first-person action likewise
 *  makes it `both` or `third`. Pairs and putdowns take third-person files only. */
export function placeStepFile(w: Workspace, uid: string, stepId: string, clip: string, path: string): Workspace {
  const a = w.actions.find(a => a.uid === uid),
    s = a?.config.steps.find(s => s.id === stepId);
  if (!a || !s) throw new Error(tr('HKX를 찾지 못했습니다.'));
  const first = isFirstPersonClip(clip),
    view = actionView(w, a),
    same = !!s.clip && assetKey(stripFirstPerson(clip)) === assetKey(s.clip);
  if (first) {
    if (fixedThird(w, a)) throw new Error(tr('페어·운반(내려놓기 포함)은 3인칭 HKX만 씁니다.'));
    const next = view === 'first' || (view === 'both' && same) ? w : setActionView(w, uid, same ? 'both' : 'first');
    return assignFirstPerson(next, uid, stepId, clip, path);
  }
  const next = view === 'first' ? setActionView(w, uid, same ? 'both' : 'third') : clone(w);
  const step = next.actions.find(x => x.uid === uid)!.config.steps.find(x => x.id === stepId)!;
  step.clip = clip;
  step.localPath = path;
  return path ? registerAssets(next, [{clip, path}]) : next;
}

/** Warnings the runtime would not report as errors: a view nothing in the game can play. */
export function viewIssues(w: Workspace): Issue[] {
  const out: Issue[] = [];
  const warn = (node: string, message: string) => out.push({level: 'warning', node, message});
  const name = (a: Action) => a.config.name || a.config.actionId;
  const label = {third: tr('3인칭'), first: tr('1인칭'), both: tr('둘 다')} as const;
  for (const a of w.actions) {
    const view = actionView(w, a),
      fixed = fixedThird(w, a);
    if (fixed === 'putdown' && a.view && a.view !== 'third')
      warn(
        a.uid,
        tr('{v0}: 운반의 내려놓기 동작은 3인칭으로 재생됩니다. 인칭 설정({v1})은 쓰이지 않습니다.', {
          v0: name(a),
          v1: label[a.view],
        })
      );
    // Only an event start names its actor; an input start is the player's.
    if (
      view === 'first' &&
      w.starts.some(s => s.mode === 'event' && s.actor === 'npc' && s.to && 'action' in s.to && s.to.action === a.uid)
    )
      warn(
        a.uid,
        tr('{v0}: NPC는 1인칭 동작을 재생하지 않습니다. 시작 대상을 플레이어로 바꾸거나 인칭을 바꾸세요.', {
          v0: name(a),
        })
      );
    // The clip is the path under Actors\Character (third) and under _1stPerson (first person).
    for (const s of a.config.steps)
      if (isFirstPersonClip(s.clip))
        warn(
          a.uid,
          tr(
            '{v0}: HKX 경로가 {FIRST_PERSON_FOLDER} 폴더에서 시작합니다. 1인칭 파일은 1인칭 파일 칸에 지정하세요(경로는 {FIRST_PERSON_FOLDER}를 뺀 상대 경로).',
            {v0: name(a), FIRST_PERSON_FOLDER}
          )
        );
  }
  // A destination starts only where the camera shows its view: an action that follows another must
  // play in every view the source can play in.
  const follows = (from: Action, to: Action, node: string) => {
    const source = actionView(w, from),
      target = actionView(w, to);
    const missing = (inThird(source) && !inThird(target)) || (inFirst(source) && !inFirst(target));
    if (missing)
      warn(
        node,
        tr('{v0} → {v1}: 인칭이 맞지 않아 이어지지 않을 수 있습니다({v2} → {v3}).', {
          v0: name(from),
          v1: name(to),
          v2: label[source],
          v3: label[target],
        })
      );
  };
  for (const l of w.links) {
    const from = w.actions.find(a => a.uid === l.from),
      to = w.actions.find(a => a.uid === l.to);
    if (from && to) follows(from, to, l.id);
  }
  return out;
}
