import type {Workspace} from '../../workspace.ts';
import {t} from '../../i18n/index.ts';
import {DetailPanel, DetailCategory as Category} from './DetailRow.tsx';
import {Property as Prop} from './Property.tsx';
import {EventPicker} from './EventPicker.tsx';
import {markerNames} from './markerCatalog.ts';
import {labelText} from '../../labels.ts';
import {defaultPackaging} from '../../authoring.ts';
import {projectView, setProjectView} from '../../view.ts';
import type {View} from '../../view.ts';
import {viewName} from './ViewFields.tsx';
import {tr} from '../../i18n/korean.ts';
export function ProjectDetails({w, edit}: {w: Workspace; edit: (fn: (w: Workspace) => Workspace) => void}) {
  return (
    <DetailPanel>
      <Category
        title={t('shell.projectSettings')}
        initialOpen
        advanced={
          <Prop
            id="internalId"
            value={w.id}
            change={id =>
              edit(w => {
                w.id = id;
                return w;
              })
            }
          />
        }
      >
        <Prop
          id="name"
          value={w.name}
          change={name =>
            edit(w => {
              w.name = name;
              return w;
            })
          }
        />
        <Prop
          id="projectView"
          value={projectView(w)}
          initial="third"
          options={(['third', 'first', 'both'] as const).map(v => [v, viewName(v)])}
          change={(view: View) => edit(w => setProjectView(w, view))}
        />
      </Category>
      <Category title={t('menu.file.exportMod')}>
        <Prop
          id="folder"
          value={w.packaging.folder}
          initial={defaultPackaging().folder}
          change={folder =>
            edit(w => {
              w.packaging = {...w.packaging, folder};
              return w;
            })
          }
        />
      </Category>
      <Category title={t('node.cameraRestore')} initialOpen>
        <Prop
          id="restoreMarker"
          value={w.globals.cameraReset ?? ''}
          change={cameraReset =>
            edit(w => {
              w.globals = {...w.globals, cameraReset};
              return w;
            })
          }
        >
          <EventPicker
            label={labelText('restoreMarker')}
            empty={tr('없음')}
            value={w.globals.cameraReset ?? ''}
            events={markerNames(w)}
            change={cameraReset =>
              edit(w => {
                w.globals = {...w.globals, cameraReset};
                return w;
              })
            }
          />
        </Prop>
        {w.actions
          .filter(a => a.cameraEnabled && a.camera && (w.globals.cameraReset === null || a.camera.own))
          .map(a => (
            <p key={a.uid}>
              {a.config.name}
              {w.globals.cameraReset === null ? '' : tr(' (이 동작만)')}: {a.camera!.reset}
            </p>
          ))}
      </Category>
    </DetailPanel>
  );
}
