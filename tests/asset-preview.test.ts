import { describe, expect, it, vi } from 'vitest';
import { applyOperations, createDocument } from '../src/engine.js';
import { onionPixels, paint } from '../web/AssetPreview.js';
import { cel } from './helpers.js';

function canvas() {
  const context = {
    createImageData: vi.fn((width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })),
    putImageData: vi.fn(),
  };
  const element = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  return { element, context };
}

describe('asset preview rendering', () => {
  it('shares one composited buffer across the editor and nine preview tiles', () => {
    const doc = createDocument({ width: 2, height: 1, palette: ['#00000000', '#ff0000'] });
    cel(doc)[0] = 1;
    const canvases = Array.from({ length: 10 }, canvas);
    for (const entry of canvases) paint(entry.element, doc);
    const image = canvases[0].context.putImageData.mock.calls[0][0];
    expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
    expect(canvases.map(entry => entry.context.createImageData.mock.calls.length)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const entry of canvases) {
      expect(entry.context.putImageData).toHaveBeenCalledWith(image, 0, 0);
      expect([entry.element.width, entry.element.height]).toEqual([2, 1]);
    }
  });

  it('renders hidden layers individually and refreshes buffers when the document changes', () => {
    const doc = createDocument({ width: 1, height: 1, palette: ['#00000000', '#ff0000', '#0000ff'] });
    doc.layers[0].visible = false;
    cel(doc)[0] = 1;
    const entry = canvas();
    paint(entry.element, doc);
    paint(entry.element, doc, { layerId: doc.layers[0].id });
    paint(entry.element, doc, { layerId: doc.layers[0].id });
    expect([...entry.context.putImageData.mock.calls[0][0].data]).toEqual([0, 0, 0, 0]);
    expect([...entry.context.putImageData.mock.calls[1][0].data]).toEqual([255, 0, 0, 255]);
    expect(entry.context.createImageData).toHaveBeenCalledTimes(2);
    expect(doc.layers[0].visible).toBe(false);

    const next = structuredClone(doc);
    cel(next)[0] = 2;
    paint(entry.element, next, { layerId: next.layers[0].id });
    expect([...entry.context.putImageData.mock.calls[3][0].data]).toEqual([0, 0, 255, 255]);
    expect(entry.context.createImageData).toHaveBeenCalledTimes(3);
  });

  it('bounds large layer thumbnails and samples nearest pixels without changing the native preview', () => {
    const doc = createDocument({ width: 2048, height: 1024, palette: ['#00000000', '#ff0000', '#0000ff'] });
    const layer = doc.layers[0]; layer.visible = false;
    cel(doc)[21 * doc.width + 21] = 1;
    cel(doc)[1002 * doc.width + 2026] = 2;
    const thumbnail = canvas();
    paint(thumbnail.element, doc, { layerId: layer.id });
    expect([thumbnail.element.width, thumbnail.element.height]).toEqual([48, 24]);
    expect(thumbnail.context.createImageData).toHaveBeenCalledWith(48, 24);
    const data = thumbnail.context.putImageData.mock.calls[0][0].data;
    expect([...data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...data.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...data.slice(-4)]).toEqual([0, 0, 255, 255]);

    const native = canvas();
    paint(native.element, doc);
    expect([native.element.width, native.element.height]).toEqual([2048, 1024]);
    expect(native.context.createImageData).toHaveBeenCalledWith(2048, 1024);
    expect(native.context.putImageData.mock.calls[0][0].data.some(Boolean)).toBe(false);
  });
});

describe('frame-aware preview rendering', () => {
  const animated = () => applyOperations(createDocument({ width: 2, height: 1, palette: ['#00000000', '#ff0000', '#0000ff'], frames: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), [
    { op: 'rows', layerId: 'base', frameId: 'a', x: 0, y: 0, rows: ['1.'] },
    { op: 'rows', layerId: 'base', frameId: 'c', x: 0, y: 0, rows: ['.2'] },
  ], { layerIds: ['base'] }).document;

  it('renders the requested frame and bounded frame thumbnails from separate cache entries', () => {
    const doc = animated();
    const entry = canvas();
    paint(entry.element, doc, { frameId: 'c' });
    paint(entry.element, doc, { frameId: 'a' });
    paint(entry.element, doc, { frameId: 'c' });
    expect(entry.context.putImageData.mock.calls.map(call => [...call[0].data])).toEqual([[0, 0, 0, 0, 0, 0, 255, 255], [255, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 255, 255]]);
    expect(entry.context.createImageData).toHaveBeenCalledTimes(2);
    const thumbnail = canvas();
    paint(thumbnail.element, doc, { frameId: 'a', thumbnail: true });
    expect([...thumbnail.context.putImageData.mock.calls[0][0].data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it('draws previous frames blue and next frames red with opacity falling by distance', () => {
    const doc = animated();
    expect([...onionPixels(doc, 'b', { before: 1, after: 1 })]).toEqual([48, 96, 255, 153, 255, 64, 64, 153]);
    expect([...onionPixels(doc, 'c', { before: 2, after: 0 })]).toEqual([48, 96, 255, 77, 0, 0, 0, 0]);
    expect([...onionPixels(doc, 'a', { before: 3, after: 0 })]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
