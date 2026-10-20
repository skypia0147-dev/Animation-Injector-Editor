import {memo} from 'react';
import {BaseEdge, useStore} from '@xyflow/react';
import type {EdgeProps, ReactFlowState} from '@xyflow/react';
import {connectionPath, forwardRoute, isReturnEdge, returnLane, type Box} from './edgeRouting.ts';

// The cards' boxes, built once per store state and shared by every edge that routes around them.
const boxCache = new WeakMap<ReactFlowState, Box[]>();
function boxes(state: ReactFlowState): Box[] {
  let list = boxCache.get(state);
  if (!list) {
    list = [];
    for (const n of state.nodeLookup.values()) {
      const w = n.measured.width ?? n.width ?? 0,
        h = n.measured.height ?? n.height ?? 0;
      if (!n.hidden && w > 0 && h > 0)
        list.push({id: n.id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h});
    }
    boxCache.set(state, list);
  }
  return list;
}

export const ConnectionEdge = memo(function ConnectionEdge(p: EdgeProps) {
  // Subscribe only to the resulting lane: selection, pan and zoom do not
  // recalculate routing or rerender every edge in a large graph.
  const lane = useStore(state => {
    if (!isReturnEdge(p)) return undefined;
    const source = state.nodeLookup.get(p.source),
      target = state.nodeLookup.get(p.target);
    if (!source || !target) return undefined;
    const span = (n: typeof source) => ({
      top: n.internals.positionAbsolute.y,
      bottom: n.internals.positionAbsolute.y + (n.measured.height ?? n.height ?? 0),
    });
    return returnLane(span(source), span(target));
  });
  // A long forward line's route around the cards, as a string so an unchanged route rerenders nothing.
  const route = useStore(state => {
    const r = forwardRoute(p, boxes(state), p.source, p.target);
    return r ? `${r.x}|${r.gutter ?? ''}|${r.lane ?? ''}` : '';
  });
  const [x, gutter, routeLane] = route.split('|').map(v => (v === '' ? undefined : Number(v)));
  const [path, labelX, labelY] = connectionPath(p, lane, x === undefined ? undefined : {x, gutter, lane: routeLane});
  return (
    <BaseEdge
      id={p.id}
      path={path}
      labelX={labelX}
      labelY={labelY}
      style={p.style}
      markerStart={p.markerStart}
      markerEnd={p.markerEnd}
      interactionWidth={p.interactionWidth}
      label={p.label}
      labelStyle={p.labelStyle}
      labelShowBg={p.labelShowBg}
      labelBgStyle={p.labelBgStyle}
      labelBgPadding={p.labelBgPadding}
      labelBgBorderRadius={p.labelBgBorderRadius}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
});
