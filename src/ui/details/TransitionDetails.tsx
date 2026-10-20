import type {Workspace, Link} from '../../workspace.ts';
import {mark} from '../../model.ts';
import {t} from '../../i18n/index.ts';
import {DetailPanel, DetailCategory as Category} from './DetailRow.tsx';
import {Property as Prop} from './Property.tsx';
import {TimeField} from './TimeField.tsx';
import {labelText} from '../../labels.ts';
import {sharesSourceWindow} from '../../graph/playback.ts';
import {sourceWindow} from '../../graph/clipWindows.ts';
import {HelpNote} from '../HelpTip.tsx';
import {tr} from '../../i18n/korean.ts';
export function TransitionDetails({w, l, change}: {w: Workspace; l: Link; change: (l: Link) => void}) {
  const source = w.actions.find(a => a.uid === l.from),
    dest = w.actions.find(a => a.uid === l.to);
  // An ordinary HKX's key transitions share its detection window unless one keeps its own (sourceLinks).
  const shared = sharesSourceWindow(w, l),
    managed = shared && !l.ownWindow;
  return (
    <DetailPanel>
      <Category title={t('node.transition')} initialOpen advanced={<code>{l.id}</code>}>
        <Prop
          id="sender"
          value={l.from}
          change={from => change({...l, from, input: '', partnerTo: ''})}
          options={w.actions.map(a => [a.uid, a.config.name])}
        />
        <Prop
          id="destination"
          value={l.to}
          change={to => change({...l, to, partnerTo: w.actions.find(a => a.uid === to)?.pair ? '' : l.partnerTo})}
          options={w.actions.filter(a => a.uid !== l.from).map(a => [a.uid, a.config.name])}
        />
      </Category>
      <Category title={t('detail.transitionRule')} initialOpen>
        <Prop
          id="mode"
          value={l.mode}
          initial="event"
          change={mode => change({...l, mode, window: mode === 'input' || l.window})}
          options={['input', 'event'].map(v => [v, t('detail.' + v)])}
        />
        {l.mode === 'input' ? (
          <Prop
            id="input"
            value={l.input}
            change={input => change({...l, input})}
            options={[
              ['', t('detail.none')],
              ...(source?.config.inputs.map(i => [i.id, i.label] as [string, string]) ?? []),
            ]}
          />
        ) : (
          <Prop id="marker" value={l.event} change={event => change({...l, event})} />
        )}
      </Category>
      <Category title={t('node.detectionWindow')} initialOpen>
        {/* Off: the whole clip (no <Window>, format 4). */}
        {(l.mode === 'event' || !managed) && (
          <Prop
            id="enabled"
            label={tr('감지 구간 사용')}
            value={l.window}
            initial={false}
            hint={tr('끄면 클립 전체에서 받습니다(XML에 Window를 쓰지 않음).')}
            change={window => change({...l, window})}
          />
        )}
        {shared && source && (
          <Prop
            id="mode"
            label={tr('감지 구간')}
            value={l.ownWindow ? 'own' : 'shared'}
            options={[
              ['shared', tr('이 HKX 공통')],
              ['own', tr('이 전환만')],
            ]}
            change={v => {
              const {ownWindow, ...rest} = l;
              change(
                v === 'own'
                  ? {
                      ...rest,
                      ownWindow: true,
                      window: true,
                      ...structuredClone(sourceWindow(source, source.config.entry).value),
                    }
                  : rest
              );
            }}
          />
        )}
        {managed && (
          <HelpNote label={tr('감지 구간')}>{tr('감지 구간과 선입력은 출발 HKX 재생 카드에서 설정하세요.')}</HelpNote>
        )}
        {l.window && !managed && (
          <>
            {(['open', 'close'] as const).map(key => (
              <Prop
                key={key}
                id={key}
                value={l[key]}
                initial={mark(key === 'open' ? 0.3 : 1.5)}
                change={v => change({...l, [key]: v})}
              >
                <TimeField
                  value={l[key]}
                  label={labelText(key)}
                  bases={key === 'close' ? ['seconds', 'end', 'event'] : ['seconds', 'event']}
                  fallback={key === 'close' ? 'either' : 'seconds'}
                  change={v => change({...l, [key]: v})}
                />
              </Prop>
            ))}
            <Prop id="buffered" value={l.buffered} initial={true} change={buffered => change({...l, buffered})} />
          </>
        )}
      </Category>
      <Category title={t('node.result')}>
        {source?.pair && !dest?.pair && (
          <Prop
            id="partnerDestination"
            value={l.partnerTo}
            initial=""
            change={partnerTo => change({...l, partnerTo})}
            options={[
              ['', t('detail.none')],
              ...w.actions.filter(a => !a.pair).map(a => [a.uid, a.config.name] as [string, string]),
            ]}
          />
        )}
      </Category>
    </DetailPanel>
  );
}
