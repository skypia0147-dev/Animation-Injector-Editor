import {useMemo} from 'react';
import type {Workspace} from '../../workspace.ts';
import {DetailCategory} from './DetailRow.tsx';
import {cardFlow, flowCount, type FlowEnd} from '../../graph/flow.ts';
import {checklistProjection} from '../../graph/checklist.ts';
import {renderedChecklist} from '../../graph/renderCache.ts';
import {tr} from '../../i18n/korean.ts';
import {useLanguage} from '../../i18n/index.ts';

/** A card's title is "kind · name" (cardPresentation.ts): the kind is its tag, the name what is read. */
const parts = (title: string) => {
  const at = title.indexOf(' · ');
  return at < 0 ? ['', title] : [title.slice(0, at), title.slice(at + 3)];
};
function Line({end, go}: {end: FlowEnd; go: (id: string) => void}) {
  const [kind, name] = parts(end.title);
  const note = [end.pin, end.event && '⚡ ' + end.event].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className="flow-line"
      title={end.title + tr(' · 이 카드로 이동')}
      onClick={() => go(end.node)}
    >
      {kind && <span className={'flow-kind ' + end.kind}>{end.kind === 'hkxPlay' ? 'HKX' : kind}</span>}
      <span className="flow-name">{name}</span>
      {/* Which result takes this line: kept whole, the name beside it gives way. */}
      {note && <span className="flow-pin">{note}</span>}
    </button>
  );
}

/** 「들어오는 곳」 and 「나가는 곳」 of the selected card (graph/flow.ts): each line goes to its card. A side with
 *  nothing (a start has nothing before it) is left out. 「나가는 곳」 is an HKX card's alone: the other cards
 *  choose where they go in 「연결」 right above, which already says it. */
export function FlowConnections({w, id, kind, go}: {w: Workspace; id: string; kind: string; go: (id: string) => void}) {
  // The lines hold translated titles: rebuilt on a language switch.
  const language = useLanguage();
  const flow = useMemo(() => cardFlow(w, checklistProjection(w, renderedChecklist(w)), id), [w, id, language]);
  return (
    <>
      {!!flow.incoming.length && (
        <DetailCategory title={tr('들어오는 곳') + ' · ' + flow.incoming.length} initialOpen>
          <div className="flow-list">
            {flow.incoming.map((e, i) => (
              <div key={i} className="flow-group">
                <Line end={e} go={go} />
                {!!e.before.length && (
                  <div className="flow-head after" title={e.before.join(', ')}>
                    {tr('그 앞')}: {e.before.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DetailCategory>
      )}
      {kind === 'hkxPlay' && !!flow.outgoing.length && (
        <DetailCategory title={tr('나가는 곳') + ' · ' + flowCount(flow.outgoing)} initialOpen>
          <div className="flow-list">
            {flow.outgoing.map((g, i) => (
              <div key={i} className="flow-group">
                {g.via && (
                  <button
                    type="button"
                    className="flow-head"
                    title={g.via.title + tr(' · 이 카드로 이동')}
                    onClick={() => go(g.via!.node)}
                  >
                    {g.via.title}
                  </button>
                )}
                {g.ends.map((e, j) => (
                  <Line key={j} end={e} go={go} />
                ))}
              </div>
            ))}
          </div>
        </DetailCategory>
      )}
    </>
  );
}
