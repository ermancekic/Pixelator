import type { Operation, Rect } from '../src/types';
import type { Point } from './view-helpers';

export type ShapeOperation = Extract<Operation, { op: 'line' | 'rect' | 'ellipse' }>;

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

export function strokePixels(points: Point[], width: number, height: number, color: number, mirrorX: boolean, mirrorY: boolean, selection: Rect | null = null): [number, number, number][] {
  const result = new Map<number, [number, number, number]>();
  for (const point of points) {
    const xs = mirrorX ? [point.x, width - 1 - point.x] : [point.x];
    const ys = mirrorY ? [point.y, height - 1 - point.y] : [point.y];
    for (const x of xs) for (const y of ys) {
      if (selection && (x < selection.x || y < selection.y || x >= selection.x + selection.width || y >= selection.y + selection.height)) continue;
      result.set(y * width + x, [x, y, color]);
    }
  }
  return [...result.values()];
}

export function mirroredShapes(operation: ShapeOperation, width: number, height: number, mirrorX: boolean, mirrorY: boolean): ShapeOperation[] {
  const result: ShapeOperation[] = [];
  for (const flipX of mirrorX ? [false, true] : [false]) for (const flipY of mirrorY ? [false, true] : [false]) {
    if (operation.op === 'line') result.push({ ...operation,
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
