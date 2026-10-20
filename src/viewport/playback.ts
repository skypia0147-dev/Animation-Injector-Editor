import {useCallback, useEffect, useReducer, useRef} from 'react';

export const clampPlayhead = (time: number, duration: number) => Math.max(0, Math.min(duration, time));
export const advancePlayhead = (time: number, elapsedSeconds: number, duration: number) =>
  clampPlayhead(time + Math.max(0, elapsedSeconds), duration);

export type PlaybackState = {identity: string; duration: number; time: number; playing: boolean};
export type PlaybackAction =
  | {type: 'sync'; identity: string; duration: number}
  | {type: 'seek'; time: number}
  | {type: 'play'}
  | {type: 'pause'}
  | {type: 'stop'}
  | {type: 'tick'; identity: string; elapsed: number};

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  if (action.type === 'sync') {
    if (action.identity !== state.identity)
      return {identity: action.identity, duration: action.duration, time: 0, playing: false};
    const time = clampPlayhead(state.time, action.duration);
    return {
      ...state,
      duration: action.duration,
      time,
      playing: state.playing && action.duration > 0 && time < action.duration,
    };
  }
  if (action.type === 'tick') {
    if (action.identity !== state.identity || !state.playing) return state;
    const time = advancePlayhead(state.time, action.elapsed, state.duration);
    return {...state, time, playing: time < state.duration};
  }
  if (action.type === 'seek') return {...state, time: clampPlayhead(action.time, state.duration)};
  if (action.type === 'play')
    return state.duration <= 0 ? state : {...state, time: state.time >= state.duration ? 0 : state.time, playing: true};
  if (action.type === 'pause') return {...state, playing: false};
  return {...state, time: 0, playing: false};
}

export function usePlayback(duration: number, identity: string) {
  const [state, dispatch] = useReducer(playbackReducer, {identity, duration, time: 0, playing: false}),
    identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => dispatch({type: 'sync', identity, duration}), [identity, duration]);
  useEffect(() => {
    if (!state.playing || state.duration <= 0) return;
    let frame = 0,
      last = performance.now();
    const playbackIdentity = state.identity;
    const tick = (now: number) => {
      if (identityRef.current !== playbackIdentity) return;
      dispatch({type: 'tick', identity: playbackIdentity, elapsed: (now - last) / 1000});
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing, state.identity, state.duration]);
  const seek = useCallback((time: number) => dispatch({type: 'seek', time}), []),
    play = useCallback(() => dispatch({type: 'play'}), []),
    pause = useCallback(() => dispatch({type: 'pause'}), []),
    stop = useCallback(() => dispatch({type: 'stop'}), []);
  return {time: state.time, playing: state.playing, play, pause, stop, seek};
}
