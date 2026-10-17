import { createDocument, getFrame, previewOperations } from '../src/engine';
import type { Operation, PixelDocument, Rect } from '../src/types';
import type { Point } from './view-helpers';

export type ShapeOperation = Extract<Operation, { op: 'line' | 'rect' | 'ellipse' | 'polygon' }>;

export function appendStroke(points: Point[], from: Point, to: Point, pixelPerfect = false): void {
  let x = from.x, y = from.y;
  const dx = Math.abs(to.x - x), dy = Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1;
  let error = dx - dy;
  for (;;) {
    const last = points.at(-1);
    if (!last || last.x !== x || last.y !== y) {
      const earlier = points.at(-2);
      if (pixelPerfect && earlier && last
        && Math.abs(earlier.x - x) === 1 && Math.abs(earlier.y - y) === 1
        && Math.abs(earlier.x - last.x) + Math.abs(earlier.y - last.y) === 1
        && Math.abs(last.x - x) + Math.abs(last.y - y) === 1) points.pop();
      points.push({ x, y });
    }
    if (x === to.x && y === to.y) break;
    const step = error * 2;
    if (step >= -dy) { error -= dy; x += sx; }
    if (step <= dx) { error += dx; y += sy; }
  }
}

export type BrushShape = 'square' | 'circle';
/** Offsets of a brush of the given size around its hot spot; even sizes lean to the top left like Aseprite. */
export function brushOffsets(size: number, shape: BrushShape = 'square'): [number, number][] {
  if (size <= 1) return [[0, 0]];
  const start = -Math.floor(size / 2); const center = (size - 1) / 2; const limit = (size / 2) ** 2 - .5; const result: [number, number][] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (shape === 'circle' && (x - center) ** 2 + (y - center) ** 2 > limit) continue;
    result.push([start + x, start + y]);
  }
  return result;
}

export type Wrap = { x: boolean; y: boolean };
export const NO_WRAP: Wrap = { x: false, y: false };
const wrapped = (value: number, size: number) => ((value % size) + size) % size;
export type StrokeOptions = { brush?: [number, number][]; allow?: (x: number, y: number) => boolean; wrap?: Wrap };
/** Brush cells of a stroke; with wrap, cells beyond an edge continue on the opposite side like a seamless texture. */
export function strokePixels(points: Point[], width: number, height: number, color: number, mirrorX: boolean, mirrorY: boolean, selection: Rect | null = null, { brush = [[0, 0]], allow, wrap = NO_WRAP }: StrokeOptions = {}): [number, number, number][] {
  const result = new Map<number, [number, number, number]>();
  for (const point of points) for (const [bx, by] of brush) {
    const px = wrap.x ? wrapped(point.x + bx, width) : point.x + bx, py = wrap.y ? wrapped(point.y + by, height) : point.y + by;
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const xs = mirrorX ? [px, width - 1 - px] : [px];
    const ys = mirrorY ? [py, height - 1 - py] : [py];
    for (const x of xs) for (const y of ys) {
      if (selection && (x < selection.x || y < selection.y || x >= selection.x + selection.width || y >= selection.y + selection.height)) continue;
      if (allow && !allow(x, y)) continue;
      result.set(y * width + x, [x, y, color]);
    }
  }
  return [...result.values()];
}

export type Pattern = 'solid' | 'checker' | 'bayer-12' | 'bayer-25' | 'bayer-75' | 'lines-h' | 'lines-v' | 'diagonal';
export const PATTERNS: { id: Pattern; label: string }[] = [
  { id: 'solid', label: 'Voll' }, { id: 'checker', label: 'Schachbrett 50 %' }, { id: 'bayer-25', label: 'Raster 25 %' },
  { id: 'bayer-12', label: 'Raster 12,5 %' }, { id: 'bayer-75', label: 'Raster 75 %' }, { id: 'lines-h', label: 'Linien waagerecht' },
  { id: 'lines-v', label: 'Linien senkrecht' }, { id: 'diagonal', label: 'Diagonal' },
];
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** Whether a dither pattern paints the primary color at a canvas position; patterns stay aligned to the canvas between strokes. */
export function patternAt(pattern: Pattern, x: number, y: number): boolean {
  const threshold = BAYER[y & 3][x & 3];
  switch (pattern) {
    case 'checker': return (x + y) % 2 === 0;
    case 'bayer-12': return threshold < 2;
    case 'bayer-25': return threshold < 4;
    case 'bayer-75': return threshold < 12;
    case 'lines-h': return y % 2 === 0;
    case 'lines-v': return x % 2 === 0;
    case 'diagonal': return (x + y) % 4 === 0;
    default: return true;
  }
}

/** Colors a painted region with a dither pattern: primary where it applies, otherwise secondary or untouched. */
export function patternPoints(region: Iterable<[number, number]>, pattern: Pattern, primary: number, secondary: number | null): [number, number, number][] {
  const result: [number, number, number][] = [];
  for (const [x, y] of region) {
    if (patternAt(pattern, x, y)) result.push([x, y, primary]);
    else if (secondary !== null) result.push([x, y, secondary]);
  }
  return result;
}

export type ShadeRamp = 'palette' | 'luminance';
/** Opaque palette indices from dark to light along the chosen ramp. */
export function shadeRamp(palette: string[], ramp: ShadeRamp): number[] {
  const indices = palette.map((_, index) => index).slice(1);
  if (ramp === 'palette') return indices;
  const luma = (hex: string) => .2126 * parseInt(hex.slice(1, 3), 16) + .7152 * parseInt(hex.slice(3, 5), 16) + .0722 * parseInt(hex.slice(5, 7), 16);
  return indices.sort((a, b) => luma(palette[a]) - luma(palette[b]) || a - b);
}

/** Shading ink: moves every opaque pixel of the region one step along the ramp (direction 1 lightens); transparent pixels stay. */
export function shadePoints(region: Iterable<[number, number]>, pixels: ArrayLike<number>, width: number, ramp: number[], direction: 1 | -1): [number, number, number][] {
  const position = new Map(ramp.map((index, at) => [index, at])); const result: [number, number, number][] = [];
  for (const [x, y] of region) {
    const at = position.get(pixels[y * width + x]);
    if (at === undefined) continue;
    const next = ramp[Math.max(0, Math.min(ramp.length - 1, at + direction))];
    if (next !== pixels[y * width + x]) result.push([x, y, next]);
  }
  return result;
}

export function mirroredShapes(operation: ShapeOperation, width: number, height: number, mirrorX: boolean, mirrorY: boolean): ShapeOperation[] {
  const result: ShapeOperation[] = [];
  for (const flipX of mirrorX ? [false, true] : [false]) for (const flipY of mirrorY ? [false, true] : [false]) {
    if (operation.op === 'polygon') result.push({ ...operation, points: operation.points.map(([x, y]) => [flipX ? width - 1 - x : x, flipY ? height - 1 - y : y] as [number, number]) });
    else if (operation.op === 'line') result.push({ ...operation,
      x1: flipX ? width - 1 - operation.x1 : operation.x1, x2: flipX ? width - 1 - operation.x2 : operation.x2,
      y1: flipY ? height - 1 - operation.y1 : operation.y1, y2: flipY ? height - 1 - operation.y2 : operation.y2,
    });
    else result.push({ ...operation,
      x: flipX ? width - operation.width - operation.x : operation.x,
      y: flipY ? height - operation.height - operation.y : operation.y,
    });
  }
  return result;
}

/** Cells a batch of shape operations would paint on one layer and frame, whatever colors are already there. */
export function paintedRegion(doc: PixelDocument, operations: ShapeOperation[], layerId: string, frameId: string, allow?: (x: number, y: number) => boolean): [number, number][] {
  // Draw with index 1 onto an empty, unlocked copy of the target raster; every nonzero result cell was painted.
  const blank: PixelDocument = {
    ...doc, layers: doc.layers.map(layer => layer.id === layerId ? { ...layer, locked: false } : layer),
    frames: doc.frames.map(frame => frame.id === frameId ? { ...frame, cels: { ...frame.cels, [layerId]: new Array(doc.width * doc.height).fill(0) } } : frame),
  };
  const painted = getFrame(previewOperations(blank, operations.map(operation => ({ ...operation, color: 1 })), { layerIds: [layerId], frameIds: [frameId] }), frameId).cels[layerId];
  const result: [number, number][] = [];
  for (let i = 0; i < painted.length; i++) {
    const x = i % doc.width, y = Math.floor(i / doc.width);
    if (painted[i] && (!allow || allow(x, y))) result.push([x, y]);
  }
  return result;
}

/** Cells of shapes that may reach past the canvas edges, folded back onto the canvas on the wrapping axes. */
export function wrappedRegion(width: number, height: number, operations: ShapeOperation[], wrap: Wrap, allow?: (x: number, y: number) => boolean): [number, number][] {
  // Draw on a 3× canvas with the real one in the middle; pointer positions stay within one canvas size beyond each edge.
  const ox = wrap.x ? width : 0, oy = wrap.y ? height : 0;
  const probe = createDocument({ width: width + 2 * ox, height: height + 2 * oy, palette: ['#00000000', '#000000'], layers: [{ id: 'probe', name: 'Probe' }] });
  const shifted = operations.map(({ frameId: _frame, ...operation }): ShapeOperation => {
    const base = { ...operation, layerId: 'probe', color: 1 };
    if (base.op === 'line') return { ...base, x1: base.x1 + ox, y1: base.y1 + oy, x2: base.x2 + ox, y2: base.y2 + oy };
    if (base.op === 'polygon') return { ...base, points: base.points.map(([x, y]) => [x + ox, y + oy] as [number, number]) };
    return { ...base, x: base.x + ox, y: base.y + oy };
  });
  const painted = getFrame(previewOperations(probe, shifted, { layerIds: ['probe'] })).cels.probe;
  const cells = new Map<number, [number, number]>();
  for (let i = 0; i < painted.length; i++) {
    if (!painted[i]) continue;
    const x = wrapped(i % probe.width - ox, width), y = wrapped(Math.floor(i / probe.width) - oy, height);
    if (!allow || allow(x, y)) cells.set(y * width + x, [x, y]);
  }
  return [...cells.values()];
}
