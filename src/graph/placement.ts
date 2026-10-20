type Point = {x: number; y: number};
// Use the actual graph panel rather than window coordinates or saved layout bounds.
export function visibleNodePosition(convert: (p: Point) => Point, point?: Point): Point {
  const rect = document.querySelector('[data-testid="graph-surface"]')?.getBoundingClientRect();
  if (!rect) return convert(point ?? {x: window.innerWidth / 2, y: window.innerHeight / 2});
  const start = convert({x: rect.left + 24, y: rect.top + 24});
  const end = convert({x: rect.right - 24, y: rect.bottom - 24});
  const desired = point ? convert(point) : {x: (start.x + end.x - 320) / 2, y: (start.y + end.y - 120) / 2};
  return {
    x: Math.max(start.x, Math.min(desired.x, end.x - 320)),
    y: Math.max(start.y, Math.min(desired.y, end.y - 120)),
  };
}

// Prefer a nearby clear patch so a pasted node's header stays clickable.
export function visiblePastePosition(
  convert: (p: Point) => Point,
  point?: Point,
  offset = 0,
  size = {width: 320, height: 170}
): Point {
  const panel = document.querySelector('[data-testid="graph-surface"]')?.getBoundingClientRect();
  if (!panel) return visibleNodePosition(convert, point);
  const a = convert({x: 0, y: 0}),
    b = convert({x: 1, y: 0}),
    zoom = 1 / (b.x - a.x);
  const width = Math.min(size.width * zoom, panel.width - 48),
    height = Math.min(size.height * zoom, panel.height - 48);
  const base = point ?? {
    x: panel.x + (panel.width - width) / 2 + offset,
    y: panel.y + (panel.height - height) / 2 + offset,
  };
  const occupied = [...document.querySelectorAll('.react-flow__node')].map(n => n.getBoundingClientRect());
  for (let ring = 0; ring < 40; ring++)
    for (let y = -ring; y <= ring; y++)
      for (let x = -ring; x <= ring; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        const p = {x: base.x + x * 24, y: base.y + y * 24};
        if (
          p.x < panel.left + 24 ||
          p.y < panel.top + 24 ||
          p.x + width > panel.right - 24 ||
          p.y + height > panel.bottom - 24
        )
          continue;
        if (
          occupied.every(
            r => p.x + width + 8 < r.left || p.x - 8 > r.right || p.y + height + 8 < r.top || p.y - 8 > r.bottom
          )
        )
          return convert(p);
      }
  return visibleNodePosition(convert, base);
}

// A new HKX card opens expanded (selected): find room for its whole size, not on top of another card.
export const freePlayPosition = (convert: (p: Point) => Point): Point =>
  visiblePastePosition(convert, undefined, 0, {width: 360, height: 360});
