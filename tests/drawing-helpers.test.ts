import { describe, expect, it } from 'vitest';
import { applyOperations, createDocument } from '../src/engine.js';
import { appendStroke, mirroredShapes, strokePixels } from '../web/drawing-helpers.js';
import type { Point } from '../web/view-helpers.js';
import { cel } from './helpers.js';

describe('drawing symmetry', () => {
  it('reflects coordinates around even and odd canvas centers without duplicate middle pixels', () => {
    expect(strokePixels([{ x: 0, y: 1 }], 4, 4, 2, true, true)).toEqual([[0, 1, 2], [0, 2, 2], [3, 1, 2], [3, 2, 2]]);
    expect(strokePixels([{ x: 2, y: 2 }], 5, 5, 2, true, true)).toEqual([[2, 2, 2]]);
    expect(strokePixels([{ x: 1, y: 2 }], 5, 5, 2, true, true)).toEqual([[1, 2, 2], [3, 2, 2]]);
  });

  it('clips every reflected target to the selection', () => {
    const selection = { x: 0, y: 0, width: 2, height: 4 };
    expect(strokePixels([{ x: 0, y: 1 }], 4, 4, 2, true, true, selection)).toEqual([[0, 1, 2], [0, 2, 2]]);
    expect(strokePixels([{ x: 3, y: 1 }], 4, 4, 2, true, false, selection)).toEqual([[0, 1, 2]]);
  });

  it('writes the mirrored target even if the source is already transparent or already the drawing color', () => {
    const doc = createDocument({ width: 4, height: 2 });
    const layerId = doc.layers[0].id;
    const scope = { layerIds: [layerId] };
    cel(doc, 0)[3] = 2;
    const erased = applyOperations(doc, [{ op: 'pixels', layerId, points: strokePixels([{ x: 0, y: 0 }], 4, 2, 0, true, false) }], scope).document;
    expect(cel(erased, 0)[3]).toBe(0);
    cel(doc, 0)[0] = 2;
    cel(doc, 0)[3] = 0;
    const drawn = applyOperations(doc, [{ op: 'pixels', layerId, points: strokePixels([{ x: 0, y: 0 }], 4, 2, 2, true, false) }], scope).document;
    expect(cel(drawn, 0)[3]).toBe(2);
  });

  it('reflects shape geometry and preserves transparent drawing', () => {
    expect(mirroredShapes({ op: 'rect', layerId: 'a', x: 1, y: 2, width: 2, height: 3, color: 0, filled: false }, 8, 9, true, true)).toEqual([
      { op: 'rect', layerId: 'a', x: 1, y: 2, width: 2, height: 3, color: 0, filled: false },
      { op: 'rect', layerId: 'a', x: 1, y: 4, width: 2, height: 3, color: 0, filled: false },
      { op: 'rect', layerId: 'a', x: 5, y: 2, width: 2, height: 3, color: 0, filled: false },
      { op: 'rect', layerId: 'a', x: 5, y: 4, width: 2, height: 3, color: 0, filled: false },
    ]);
    expect(mirroredShapes({ op: 'line', layerId: 'a', x1: 1, y1: 2, x2: 3, y2: 4, color: 1 }, 8, 9, true, false)[1]).toEqual({ op: 'line', layerId: 'a', x1: 6, y1: 2, x2: 4, y2: 4, color: 1 });
  });
});

describe('pixel-perfect freehand', () => {
  it('keeps the engine rasterization for ordinary segments in every direction', () => {
    const doc = createDocument({ width: 7, height: 7 });
    const layerId = doc.layers[0].id;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const path: Point[] = [];
      appendStroke(path, { x: 3, y: 3 }, { x, y });
      const raster = cel(applyOperations(doc, [{ op: 'line', layerId, x1: 3, y1: 3, x2: x, y2: y, color: 1 }], { layerIds: [layerId] }).document);
      const actual = new Set(path.map(p => p.y * 7 + p.x));
      expect([...actual].sort((a, b) => a - b)).toEqual(raster.flatMap((value, i) => value ? [i] : []));
    }
  });

  it('removes local L corners but preserves ordinary strokes and repeated endpoints', () => {
    const normal: Point[] = [], clean: Point[] = [];
    for (const path of [normal, clean]) {
      appendStroke(path, { x: 0, y: 0 }, { x: 1, y: 0 }, path === clean);
      appendStroke(path, { x: 1, y: 0 }, { x: 1, y: 1 }, path === clean);
      appendStroke(path, { x: 1, y: 1 }, { x: 1, y: 1 }, path === clean);
    }
    expect(normal).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(clean).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('bridges fast pointer moves and preserves straight lines and U-turns', () => {
    const path: Point[] = [];
    appendStroke(path, { x: 0, y: 0 }, { x: 3, y: 0 }, true);
    appendStroke(path, { x: 3, y: 0 }, { x: 2, y: 0 }, true);
    expect(path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 0 }]);
    const diagonal: Point[] = [];
    appendStroke(diagonal, { x: 0, y: 0 }, { x: 3, y: 3 }, true);
    expect(diagonal).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
  });

  it('preserves the original color under removed corners, including with symmetry and a selection', () => {
    const doc = createDocument({ width: 6, height: 3 });
    const layerId = doc.layers[0].id;
    cel(doc, 0)[1] = 2;
    cel(doc, 0)[4] = 3;
    const path: Point[] = [];
    appendStroke(path, { x: 0, y: 0 }, { x: 1, y: 0 }, true);
    appendStroke(path, { x: 1, y: 0 }, { x: 1, y: 1 }, true);
    const selection = { x: 0, y: 0, width: 6, height: 2 };
    const points = strokePixels(path, 6, 3, 1, true, false, selection);
    const drawn = applyOperations(doc, [{ op: 'pixels', layerId, points }], { layerIds: [layerId], rect: selection }).document;
    expect(cel(drawn, 0)[1]).toBe(2);
    expect(cel(drawn, 0)[4]).toBe(3);
    expect([0, 5, 7, 10].map(i => cel(drawn, 0)[i])).toEqual([1, 1, 1, 1]);
    expect(cel(doc, 0)[0]).toBe(0);
  });
});
