// Browser standard layout to Skyrim's native ButtonEvent codes.
export const standardPadCodes = [4096, 8192, 16384, 32768, 256, 512, 9, 10, 32, 16, 64, 128, 1, 2, 4, 8] as const;
export type PadSample = {
  index: number;
  id: string;
  connected: boolean;
  mapping: string;
  buttons: readonly {pressed: boolean; value: number}[];
};
export type PadEdge = {pad: number; code: number; up: boolean};
export class QteGamepad {
  private previous = new Map<number, {id: string; held: boolean[]}>();
  poll(pads: readonly (PadSample | null)[]) {
    const edges: PadEdge[] = [],
      live = new Set<number>();
    let disconnected = false;
    for (const pad of pads) {
      if (!pad?.connected || pad.mapping !== 'standard') continue;
      live.add(pad.index);
      const held = standardPadCodes.map(
        (_, i) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value >= 0.5)
      );
      const old = this.previous.get(pad.index);
      // A held button at preview start/connection is not a new press.
      if (old?.id === pad.id)
        held.forEach((down, i) => {
          if (down !== old.held[i]) edges.push({pad: pad.index, code: standardPadCodes[i], up: !down});
        });
      else if (old) disconnected = true;
      this.previous.set(pad.index, {id: pad.id, held});
    }
    for (const index of this.previous.keys())
      if (!live.has(index)) {
        disconnected = true;
        this.previous.delete(index);
      }
    return {edges, disconnected, connected: live.size > 0};
  }
}
