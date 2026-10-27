/** One condition of a group as its chip reads: its name, its value, and NOT. */
export type GroupPart = {name: string; value: string; not?: boolean};

/**
 * A group chip in one line (docs/mockup-group-summary A + B): conditions of the same name (and the same NOT) are
 * written once with their values joined by 「·」; when more than one entry is left, only the first is shown and the
 * rest is counted. `parts` is every entry, for the chip's tooltip.
 */
export function groupSummary(parts: GroupPart[]): {first?: GroupPart; more: number; parts: GroupPart[]} {
  const merged: GroupPart[] = [];
  for (const p of parts) {
    const same = p.value ? merged.find(m => m.name === p.name && !!m.not === !!p.not && m.value) : undefined;
    if (same) same.value += '·' + p.value;
    else merged.push({...p});
  }
  return {first: merged[0], more: Math.max(0, merged.length - 1), parts: merged};
}

/** An entry as text: 「NOT 」, the name, the value. */
export const partText = (p: GroupPart) => (p.not ? 'NOT ' : '') + p.name + (p.value ? ' ' + p.value : '');
