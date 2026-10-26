import type {Workspace, Action} from '../../workspace.ts';
import {attachInput, updateSharedInput} from '../../sharedSettings.ts';
import {parameterFields, parameterValue, applyParameter} from '../../authoring.ts';
import {t} from '../../i18n/index.ts';
import {DetailPanel, DetailCategory as Category, DetailRow} from './DetailRow.tsx';
import {Property as Prop} from './Property.tsx';
import {KeyField} from './KeyField.tsx';
export function InputDetails({
  w,
  selected,
  edit,
  changeAction,
  status,
}: {
  w: Workspace;
  selected: string;
  edit: (f: (w: Workspace) => Workspace) => void;
  changeAction: (a: Action) => unknown;
  status: (s: string) => void;
}) {
  const [scope, id] = selected.split(':');
  const a = w.actions.find(a => a.uid === scope);
  const shared = scope === 'shared' ? w.sharedInputs.find(i => i.id === id) : undefined;
  const input = shared ?? a?.config.inputs.find(i => i.id === id) ?? w.sharedInputs[0];
  if (!input) return <p>{t('detail.noSelection')}</p>;
  const set = (v: Partial<typeof input>) => {
    if (shared || !a) edit(w => updateSharedInput(w, {...input, ...v}));
    else
      changeAction({
        ...a,
        config: {...a.config, inputs: a.config.inputs.map(i => (i.id === input.id ? {...i, ...v} : i))},
      });
  };
  return (
    <DetailPanel>
      <Category title={t('node.keyInput')} initialOpen advanced={<code>{input.id}</code>}>
        <Prop id="name" value={input.label} change={label => set({label})} />
        <DetailRow id="input">
          <KeyField
            value={input.key}
            gamepad={input.gamepad}
            change={key => set({key})}
            changeGamepad={gamepad => set({gamepad})}
            control={input.control}
            changeControl={control => set(control ? {control, key: '', gamepad: 0} : {control: undefined, key: 'G'})}
          />
        </DetailRow>
      </Category>
      {(shared || !a) && (
        <Category title={t('node.state')} initialOpen>
          {w.actions.map(a => (
            <DetailRow key={a.uid} label={a.config.name} hint={t('tip.input')}>
              <input
                type="checkbox"
                checked={a.config.inputs.some(i => i.id === input.id)}
                onChange={e => {
                  try {
                    const next = attachInput(w, input.id, a.uid, e.target.checked);
                    edit(() => next);
                  } catch (err) {
                    status(String(err));
                  }
                }}
              />
            </DetailRow>
          ))}
        </Category>
      )}
    </DetailPanel>
  );
}
export function ParameterDetails({
  w,
  selected,
  edit,
  status,
}: {
  w: Workspace;
  selected: string;
  edit: (f: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
}) {
  const p = w.parameters.find(p => p.id === selected) ?? w.parameters[0];
  if (!p) return <p>{t('detail.noSelection')}</p>;
  const a = w.actions.find(a => a.uid === p.action),
    value = parameterValue(w, p);
  const patch = (v: Partial<typeof p>) =>
    edit(w => {
      w.parameters = w.parameters.map(x => (x.id === p.id ? {...x, ...v} : x));
      return w;
    });
  const set = (v: string | number) => {
    try {
      const next = applyParameter(w, p.id, v);
      edit(() => next);
    } catch (e) {
      status(String(e));
    }
  };
  return (
    <DetailPanel>
      <Category
        title={t('myProject.sharedSettings')}
        initialOpen
        advanced={
          <DetailRow id="internalId">
            <code>{p.id}</code>
          </DetailRow>
        }
      >
        <Prop id="name" value={p.label} change={label => patch({label})} />
        <DetailRow label={t('detail.help')}>
          <input value={p.help} onChange={e => patch({help: e.target.value})} />
        </DetailRow>
        <Prop
          id="destination"
          value={p.action}
          change={action => patch({action, input: ''})}
          options={[['', t('detail.none')], ...w.actions.map(a => [a.uid, a.config.name] as [string, string])]}
        />
        <Prop
          id="kind"
          value={p.field}
          change={field =>
            patch({
              field,
              min: field === 'lossBlend' ? 0.01 : 0,
              max: field === 'lossBlend' ? 5 : field === 'cooldown' ? 600 : 100000,
            })
          }
          options={parameterFields.map((v, i) => [
            v,
            t(['node.keyInput', 'row.cooldown', 'detail.stamina', 'row.lossBlend'][i]),
          ])}
        />
        {p.field === 'inputKey' ? (
          <Prop
            id="input"
            value={p.input}
            change={input => patch({input})}
            options={[
              ['', t('detail.none')],
              ...(a?.config.inputs.map(i => [i.id, i.label] as [string, string]) ?? []),
            ]}
          />
        ) : (
          <>
            <DetailRow label={t('detail.min')}>
              <input type="number" value={p.min} onChange={e => patch({min: Number(e.target.value)})} />
            </DetailRow>
            <DetailRow label={t('detail.max')}>
              <input type="number" value={p.max} onChange={e => patch({max: Number(e.target.value)})} />
            </DetailRow>
          </>
        )}
        {value !== undefined && (
          <DetailRow label={t('detail.value')} hint={p.help}>
            <input
              type={typeof value === 'number' ? 'number' : 'text'}
              value={value}
              min={p.min}
              max={p.max}
              onChange={e => set(typeof value === 'number' ? Number(e.target.value) : e.target.value)}
            />
          </DetailRow>
        )}
      </Category>
    </DetailPanel>
  );
}
