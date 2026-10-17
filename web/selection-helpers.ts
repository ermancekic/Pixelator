import type { Rect } from '../src/types';
import type { Point } from './view-helpers';

/** A selection's bounding rectangle plus, for lasso and wand selections, one flag per rect cell (row-major). */
export type Selection = { rect: Rect; mask: Uint8Array | null };
export type SelectionMode = 'replace' | 'add' | 'subtract';
export type SelectionTransform = { dx: number; dy: number } | { axis: 'x' | 'y' } | { turns: 1 };

export const rectSelection = (rect: Rect): Selection => ({ rect, mask: null });

export function selectionContains({ rect, mask }: Selection, x: number, y: number): boolean {
  if (x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) return false;
  return !mask || mask[(y - rect.y) * rect.width + x - rect.x] === 1;
}

/** Shrinks a canvas-sized flag raster to its bounding box; a fully set box needs no mask. */
export function fromCanvasMask(flags: Uint8Array, width: number, height: number): Selection | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < flags.length; i++) if (flags[i]) {
    const x = i % width, y = Math.floor(i / width);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const rect = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const mask = new Uint8Array(rect.width * rect.height); let full = true;
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
    const value = flags[(y + y0) * width + x + x0]; mask[y * rect.width + x] = value; if (!value) full = false;
  }
  return { rect, mask: full ? null : mask };
}

function toCanvasMask(selection: Selection | null, width: number, height: number): Uint8Array {
  const flags = new Uint8Array(width * height);
  if (!selection) return flags;
  const { rect } = selection;
  for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.width); x++) {
    if (selectionContains(selection, x, y)) flags[y * width + x] = 1;
  }
  return flags;
}

/** Combines a new selection with the current one: replace, add (Shift) or subtract (Alt). */
export function combineSelections(current: Selection | null, next: Selection | null, mode: SelectionMode, width: number, height: number): Selection | null {
  if (mode === 'replace' || (!current && mode === 'add')) return next;
  if (!current) return null;
  if (!next) return current;
  const flags = toCanvasMask(current, width, height); const other = toCanvasMask(next, width, height);
  for (let i = 0; i < flags.length; i++) flags[i] = mode === 'add' ? flags[i] | other[i] : flags[i] & (other[i] ^ 1);
  return fromCanvasMask(flags, width, height);
}

/** Lasso: pixels whose centers lie inside the closed path (even-odd), plus the pixels on the path itself. */
export function polygonSelection(points: Point[], width: number, height: number): Selection | null {
  if (!points.length) return null;
  const flags = new Uint8Array(width * height);
  const set = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < width && y < height) flags[y * width + x] = 1; };
  for (let y = 0; y < height; y++) {
    const cy = y + .5; const crossings: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y + .5 > cy) !== (b.y + .5 > cy)) crossings.push(a.x + .5 + (cy - a.y - .5) * (b.x - a.x) / (b.y - a.y));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(crossings[k] - .5)); x < Math.min(width, Math.ceil(crossings[k + 1] - .5)); x++) flags[y * width + x] = 1;
    }
  }
  for (let i = 0; i < points.length; i++) {
    const from = points[i], to = points[(i + 1) % points.length];
    let x = from.x, y = from.y; const dx = Math.abs(to.x - x), dy = -Math.abs(to.y - y), sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1; let error = dx + dy;
    for (;;) {
      set(x, y);
      if (x === to.x && y === to.y) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x += sx; }
      if (twice <= dx) { error += dx; y += sy; }
    }
  }
  return fromCanvasMask(flags, width, height);
}

/** Magic wand: the four-connected region of equal indices at (x, y), or every pixel of that index. */
export function wandSelection(indices: ArrayLike<number>, width: number, height: number, x: number, y: number, contiguous: boolean): Selection | null {
  const flags = new Uint8Array(width * height); const from = indices[y * width + x];
  if (!contiguous) {
    for (let i = 0; i < flags.length; i++) if (indices[i] === from) flags[i] = 1;
    return fromCanvasMask(flags, width, height);
  }
  const queue = [y * width + x]; flags[queue[0]] = 1;
  for (let i = 0; i < queue.length; i++) {
    const position = queue[i], px = position % width;
    for (const next of [px > 0 ? position - 1 : -1, px + 1 < width ? position + 1 : -1, position - width, position + width]) {
      if (next < 0 || next >= flags.length || flags[next] || indices[next] !== from) continue;
      flags[next] = 1; queue.push(next);
    }
  }
  return fromCanvasMask(flags, width, height);
}

/** Mask rows for EditScope.mask, or undefined for a rectangular selection. */
export const maskRows = ({ rect, mask }: Selection): string[] | undefined => mask ? Array.from({ length: rect.height }, (_, y) => Array.from(mask.subarray(y * rect.width, (y + 1) * rect.width), flag => flag ? '#' : '.').join('')) : undefined;

/** The edit scope part that confines writes to the selection. */
export const selectionScope = (selection: Selection): { rect: Rect; mask?: string[] } => {
  const mask = maskRows(selection);
  return mask ? { rect: selection.rect, mask } : { rect: selection.rect };
};

/** SVG path (in canvas pixels) along every selected cell edge that borders an unselected cell. */
export function selectionOutline(selection: Selection): string {
  const { rect } = selection; const inside = (x: number, y: number) => selectionContains(selection, x, y); const parts: string[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) parts.push(`M${x} ${y}h1`);
    if (!inside(x, y + 1)) parts.push(`M${x} ${y + 1}h1`);
    if (!inside(x - 1, y)) parts.push(`M${x} ${y}v1`);
    if (!inside(x + 1, y)) parts.push(`M${x + 1} ${y}v1`);
  }
  return parts.join('');
}

/**
 * Lifts the selected pixels of one raster, moves, flips or rotates them inside the canvas and drops them again,
 * like the engine's rect transforms but for any selection shape. Returns the changed pixels and the moved selection.
 */
export function transformSelection(pixels: ArrayLike<number>, width: number, height: number, selection: Selection, transform: SelectionTransform, copy = false): { points: [number, number, number][]; selection: Selection } {
  const { rect } = selection; const source = selection.mask ?? new Uint8Array(rect.width * rect.height).fill(1);
  const turned = 'turns' in transform;
  const target: Rect = turned ? { x: rect.x, y: rect.y, width: rect.height, height: rect.width } : 'dx' in transform ? { ...rect, x: rect.x + transform.dx, y: rect.y + transform.dy } : rect;
  if (target.x < 0 || target.y < 0 || target.x + target.width > width || target.y + target.height > height) throw new Error('Die Auswahl würde die Leinwand verlassen.');
  const result = Array.from(pixels); const mask = new Uint8Array(target.width * target.height);
  if (!copy) for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) if (source[y * rect.width + x]) result[(rect.y + y) * width + rect.x + x] = 0;
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
    if (!source[y * rect.width + x]) continue;
    let tx = x, ty = y;
    if ('axis' in transform) { if (transform.axis === 'x') tx = rect.width - 1 - x; else ty = rect.height - 1 - y; }
    if (turned) { tx = rect.height - 1 - y; ty = x; }
    mask[ty * target.width + tx] = 1;
    result[(target.y + ty) * width + target.x + tx] = pixels[(rect.y + y) * width + rect.x + x];
  }
  const points: [number, number, number][] = [];
  for (let i = 0; i < result.length; i++) if (result[i] !== pixels[i]) points.push([i % width, Math.floor(i / width), result[i]]);
  return { points, selection: { rect: target, mask: mask.every(Boolean) ? null : mask } };
}

/** The smallest rectangle covering both rectangles. */
export const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
