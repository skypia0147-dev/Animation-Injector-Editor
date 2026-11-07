import {definition} from '../src/graph/conditionExtensions.ts';

/** A valid setting for a condition kind, as a user would fill it in (11-02: a new condition starts with nothing
 *  chosen, so the tests fill in what the editor once chose by itself). */
export function sampleSettings(kind) {
  const d = definition(kind);
  if (!d) return {};
  return {
    ...(d.choices ? {option: d.choices[0][0]} : {}),
    ...(d.numeric
      ? {
          compare: 'le',
          value:
            kind === 'resource'
              ? 20
              : kind === 'relativeAngle'
                ? 45
                : kind === 'scale' || kind === 'scaleRatio'
                  ? 1
                  : 150,
          upper: kind === 'relativeAngle' ? 180 : 200,
        }
      : {}),
    ...(kind === 'resource' ? {measure: 'percent'} : {}),
    ...(kind === 'chance' ? {value: 30} : {}),
    ...(kind === 'slope' ? {compare: 'ge', value: 25} : {}),
    ...(kind === 'actorValue' ? {option: 'OneHanded', compare: 'ge', value: 50, measure: 'current'} : {}),
    ...(kind === 'gameHour' ? {compare: 'range', value: 20, upper: 5} : {}),
    ...(kind === 'heldTime' ? {compare: 'ge', value: 1.5} : {}),
    ...(kind === 'weather' ? {option: 'rainy'} : {}),
    ...(kind === 'hitReceived' ? {option: 'power', within: 0.5} : {}),
    ...(kind === 'recentEvent' ? {events: ['attackStop', 'attackPowerStop'], within: 0.5} : {}),
  };
}
