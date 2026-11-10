// An action's camera view (view.ts) and the HKX files its view needs, shared by the card and the Details.
import type {ReactNode} from 'react';
import type {Action, Workspace} from '../../workspace.ts';
import type {Step} from '../../model.ts';
import type {LibraryEntry} from '../../assets.ts';
import type {LabelId} from '../../labels.ts';
import {assetKey} from '../../package.ts';
import {t} from '../../i18n/index.ts';
import {
  actionView,
  actionViews,
  defaultView,
  assignFirstPerson,
  firstPersonClip,
  firstPersonStart,
  firstPersonStarts,
  fixedThird,
  isFirstPersonClip,
  placeStepFile,
  setActionView,
  setFirstPersonStart,
  views,
} from '../../view.ts';
import type {FirstPersonStart, View} from '../../view.ts';
import {AssetField} from './AssetField.tsx';
import {actionRig, isCreatureRig, rigRoot} from '../../creatureRig.ts';

/** How the caller lays out one labelled control (a card row or a Details row). */
export type ViewRow = (id: LabelId, label: string, control: ReactNode, hint?: string) => ReactNode;
type Edit = (fn: (w: Workspace) => Workspace) => void;

export const viewName = (v: View) => t('view.' + v);
/** The views offered, the default one marked: the project's, or a pair's own (third whatever the project says). */
export const viewOptions = (base: View, list: readonly View[] = views, pair = false) =>
  list.map(
    v => [v, v === base ? t(pair ? 'view.pairDefault' : 'view.default', {view: viewName(v)}) : viewName(v)] as const
  );
const cancelHint = (v: View) =>
  t(v === 'third' ? 'view.cancelThird' : v === 'first' ? 'view.cancelFirst' : 'view.cancelBoth');
// A pair written first or both plays its first-person copy in first person (runtime 1.0.8).
const hint = (pair: boolean, v: View) =>
  pair && v !== 'third' ? t(v === 'first' ? 'view.pairFirst' : 'view.pairBoth') : cancelHint(v);

/** The view select and, for a third-person action, what the player's first-person camera does. */
export function ViewFields({w, action, edit, row}: {w: Workspace; action: Action; edit: Edit; row: ViewRow}) {
  const fixed = fixedThird(w, action),
    view = actionView(w, action);
  return (
    <>
      {row(
        'view',
        t('row.view'),
        fixed ? (
          <select aria-label={t('row.view')} value="third" disabled>
            <option value="third">{t(fixed === 'carry' ? 'view.fixedCarry' : 'view.fixedPutdown')}</option>
          </select>
        ) : (
          <select
            aria-label={t('row.view')}
            value={view}
            onChange={e => edit(w => setActionView(w, action.uid, e.target.value as View))}
          >
            {viewOptions(defaultView(w, action), actionViews(w, action), !!action.pair).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        ),
        hint(!!action.pair, view)
      )}
      {view === 'third' &&
        fixed !== 'putdown' &&
        row(
          'firstPerson',
          t('row.firstPerson'),
          <select
            aria-label={t('row.firstPerson')}
            value={firstPersonStart(w, action)}
            onChange={e => edit(w => setFirstPersonStart(w, action.uid, e.target.value as FirstPersonStart))}
          >
            {firstPersonStarts.map(s => (
              <option key={s} value={s}>
                {t('view.' + s)}
              </option>
            ))}
          </select>
        )}
    </>
  );
}

/** A step's HKX slots by view: the clip (third person), its _1stPerson copy (first person), or both.
 *  `change` sets the third-person clip and source as before. */
export function StepFiles({
  w,
  action,
  step,
  library,
  selected,
  status,
  edit,
  change,
  row,
  scopeKey,
}: {
  w: Workspace;
  action: Action;
  step: Step;
  library: LibraryEntry[];
  selected?: LibraryEntry;
  status: (s: string) => void;
  edit: Edit;
  change: (clip: string, path: string) => void;
  row: ViewRow;
  scopeKey?: string;
}) {
  const view = actionView(w, action);
  const third = library.filter(e => !isFirstPersonClip(e.clip)),
    first = library.filter(e => isFirstPersonClip(e.clip));
  const firstKey = assetKey(firstPersonClip(step.clip)),
    firstEntry = first.find(e => assetKey(e.clip) === firstKey);
  const selectedIn = (list: LibraryEntry[]) => (selected && list.includes(selected) ? selected : undefined);
  return (
    <>
      {(view !== 'first' || !!action.pair) &&
        row(
          'file',
          view !== 'third' ? t('view.thirdFile') : t('row.file'),
          <AssetField
            scopeKey={scopeKey}
            clip={step.clip}
            path={step.localPath ?? ''}
            library={third}
            selected={selectedIn(third)}
            status={status}
            root={isCreatureRig(actionRig(action)) ? rigRoot(actionRig(action)) : undefined}
            // A picked first-person file goes to the first-person copy and the view follows it.
            change={(clip, path) =>
              isFirstPersonClip(clip)
                ? edit(w => placeStepFile(w, action.uid, step.id, clip, path))
                : change(clip, path)
            }
          />
        )}
      {view !== 'third' &&
        row(
          'firstFile',
          t('view.firstFile'),
          <AssetField
            scopeKey={scopeKey && scopeKey + ':1st'}
            clip={firstEntry?.clip ?? firstPersonClip(step.clip)}
            path={firstEntry?.localPath ?? ''}
            library={first}
            selected={selectedIn(first)}
            status={status}
            // `both` and a pair share the clip's relative path: the third-person file sets it.
            fixedPath={view === 'both' || !!action.pair}
            change={(clip, path) => edit(w => assignFirstPerson(w, action.uid, step.id, clip, path))}
          />
        )}
    </>
  );
}
