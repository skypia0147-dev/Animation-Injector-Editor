import {useRef} from 'react';

type Fn = (...args: any[]) => any;
/** Callbacks with a fixed identity that call the function given at the latest render. The app shell
 *  re-renders for state its panels do not use (a playing clip ticks every frame, notices, panel sizes);
 *  a memoized panel whose callbacks come from here skips those renders instead of redrawing. */
export function useStableCallbacks() {
  const latest = useRef(new Map<string, Fn>()),
    wrappers = useRef(new Map<string, Fn>());
  return useRef(<F extends Fn>(key: string, fn: F): F => {
    latest.current.set(key, fn);
    let wrapper = wrappers.current.get(key);
    if (!wrapper) {
      wrapper = (...args: unknown[]) => latest.current.get(key)!(...args);
      wrappers.current.set(key, wrapper);
    }
    return wrapper as F;
  }).current;
}
