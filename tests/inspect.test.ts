import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { applyOperations, createDocument } from '../src/engine.js';
import { renderPng } from '../src/images.js';
import { renderContactSheet, renderInspection, viewDocument } from '../src/inspect.js';
import type { PixelDocument } from '../src/types.js';

const palette = ['#00000000', '#FF0000', '#0000FF', '#FFFFFF'];
const sprite = (): PixelDocument => {
  const doc = createDocument({ width: 4, height: 3, palette, layers: [{ id: 'body', name: 'Body' }, { id: 'gear', name: 'Gear' }], frames: [{ id: 'a' }, { id: 'b' }], pivot: { x: 2, y: 3 } });
  return applyOperations(doc, [
    { op: 'rows', layerId: 'body', frameId: 'a', x: 0, y: 0, rows: ['11..', '.11.', '....'] },
    { op: 'rows', layerId: 'gear', frameId: 'a', x: 0, y: 0, rows: ['....', '..2.', '...3'] },
    { op: 'rows', layerId: 'body', frameId: 'b', x: 0, y: 0, rows: ['....', '.11.', '.11.'] },
  ], { layerIds: ['body', 'gear'] }).document;
};
const read = (png: Buffer) => PNG.sync.read(png);
const pixel = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
const frame = (doc: PixelDocument, options: Partial<Parameters<typeof renderInspection>[1]> = {}) => renderInspection(doc, { frameIds: ['a'], columns: 1, gutter: 0, scale: 1, ...options });

describe('detail views', () => {
  it('crops every frame to a region, keeps the pivot inside it and drops the tile grid', () => {
    const view = viewDocument({ ...sprite(), tileset: { tileWidth: 2, tileHeight: 1, terrainMode: 'mixed', terrains: [], tiles: [] } }, { rect: { x: 1, y: 1, width: 3, height: 2 } });
    expect([view.width, view.height, view.pivot, view.tileset]).toEqual([3, 2, { x: 1, y: 2 }, undefined]);
    expect(view.frames.map(item => item.cels.body)).toEqual([[1, 1, 0, 0, 0, 0], [1, 1, 0, 1, 1, 0]]);
    expect(view.frames[0].cels.gear).toEqual([0, 2, 0, 0, 0, 3]);
    expect([...read(renderPng(view, 1, 'a')).data.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('isolates layers, also hidden ones, and rejects unknown layers and outside regions', () => {
    const hidden = { ...sprite(), layers: sprite().layers.map(layer => ({ ...layer, visible: layer.id !== 'gear' })) };
    const gear = read(frame(viewDocument(hidden, { layerIds: ['gear'] })).png);
    expect([pixel(gear, 0, 0), pixel(gear, 2, 1), pixel(gear, 3, 2)]).toEqual([[0, 0, 0, 0], [0, 0, 255, 255], [255, 255, 255, 255]]);
    expect(() => viewDocument(sprite(), { layerIds: ['cape'] })).toThrow('Layer cape does not exist.');
    expect(() => viewDocument(sprite(), { rect: { x: 2, y: 0, width: 3, height: 1 } })).toThrow('The area must lie inside the canvas.');
  });
});

describe('inspection aids', () => {
  it('renders the plain view like the export and enlarges without smoothing', () => {
    const plain = frame(sprite(), { scale: 3 });
    expect(plain).toMatchObject({ width: 12, height: 9, margin: { left: 0, top: 0 }, grid: null });
    expect(read(plain.png).data.equals(read(renderPng(sprite(), 3, 'a')).data)).toBe(true);
  });

  it('shows the silhouette in black on white and brightness without hue', () => {
    const shape = read(frame(sprite(), { mode: 'silhouette' }).png);
    expect([pixel(shape, 0, 0), pixel(shape, 2, 1), pixel(shape, 3, 0)]).toEqual([[0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]]);
    const gray = read(frame(sprite(), { mode: 'values' }).png);
    expect([pixel(gray, 0, 0), pixel(gray, 2, 1), pixel(gray, 3, 2), pixel(gray, 3, 0)]).toEqual([[76, 76, 76, 255], [29, 29, 29, 255], [255, 255, 255, 255], [0, 0, 0, 0]]);
  });

  it('puts a flat color or a checkerboard behind transparent pixels only', () => {
    const flat = read(frame(sprite(), { background: '#102030', scale: 2 }).png);
    expect([pixel(flat, 7, 0), pixel(flat, 0, 0)]).toEqual([[16, 32, 48, 255], [255, 0, 0, 255]]);
    const checker = read(frame(sprite(), { background: 'checker', scale: 8 }).png);
    expect([pixel(checker, 31, 0), pixel(checker, 31, 8), pixel(checker, 0, 0)]).toEqual([[200, 200, 200, 255], [180, 180, 180, 255], [255, 0, 0, 255]]);
  });

  it('adds rulers and grid lines that map image positions back to canvas pixels', () => {
    const view = viewDocument(sprite(), { rect: { x: 1, y: 0, width: 3, height: 3 } });
    const image = frame(view, { scale: 8, grid: 2, origin: { x: 1, y: 0 } });
    const { left, top } = image.margin; const png = read(image.png);
    expect([left, top, image.width, image.height]).toEqual([14, 16, 14 + 24, 16 + 24]);
    expect(image.grid).toEqual({ spacing: 2, color: '#00FFFF', lines: true });
    // Canvas pixel (2, 1) is the second column of the view: its left edge carries a grid line, its inside the color.
    const at = (x: number, y: number, dx = 4, dy = 4) => pixel(png, left + (x - 1) * 8 + dx, top + y * 8 + dy);
    expect([at(2, 1), at(1, 0), at(1, 1)]).toEqual([[0, 0, 255, 255], [255, 0, 0, 255], [255, 0, 0, 255]]);
    expect([at(2, 1, 0, 4), at(3, 2, 0, 4), at(1, 2, 4, 0)]).toEqual([[0, 255, 255, 255], [255, 255, 255, 255], [0, 255, 255, 255]]);
    // Rulers sit outside the image: white paper, black ticks at the first pixel and at every multiple of the spacing.
    expect([pixel(png, 0, 0), pixel(png, left, top - 1), pixel(png, left + 8, top - 1), pixel(png, left + 16, top - 1), pixel(png, left - 1, top + 16)]).toEqual([[255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255]]);
    // Below scale 3 the lines would hide the art, so only the rulers remain.
    const small = frame(sprite(), { scale: 2, grid: 2 });
    expect(small.grid).toMatchObject({ lines: false });
    expect(pixel(read(small.png), small.margin.left + 4, small.margin.top + 2)).toEqual([0, 0, 255, 255]);
  });

  it('gives each cell of a sheet its own rulers and avoids the gutter color for the grid', () => {
    const magenta = { ...sprite(), palette: ['#00000000', '#FF0000', '#0000FF', '#00FFFF'] };
    const sheet = renderInspection(magenta, { frameIds: ['a', 'b'], columns: 2, gutter: 1, scale: 4, grid: 2 });
    expect(sheet.layout).toMatchObject({ gutterColor: '#FF00FF', columns: 2 });
    expect(sheet.grid!.color).toBe('#FFFF00');
    const png = read(sheet.png); const { left, top } = sheet.margin;
    expect([pixel(png, left + 16, top + 2), pixel(png, left, top - 1), pixel(png, left + 20, top - 1)]).toEqual([[255, 0, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255]]);
    expect(() => frame(sprite(), { scale: 0 })).toThrow('Zoom must be a whole number from 1 to 32.');
  });
});

describe('contact sheets', () => {
  it('lays assets out at one scale, bottom-aligned per row, numbered and on a shared background', () => {
    const tall = applyOperations(createDocument({ width: 2, height: 6, palette }), [{ op: 'rect', layerId: 'base', x: 0, y: 0, width: 2, height: 6, color: 2 }], { layerIds: ['base'] }).document;
    const sheet = renderContactSheet([sprite(), tall, sprite()], { scale: 2, background: '#204060', maxWidth: 40 });
    expect(sheet.cells).toEqual([{ label: 1, x: 8, y: 14, width: 8, height: 6 }, { label: 2, x: 24, y: 8, width: 4, height: 12 }, { label: 3, x: 8, y: 44, width: 8, height: 6 }]);
    expect([sheet.width, sheet.height]).toEqual([36, 74]);
    const png = read(sheet.png);
    expect([pixel(png, 0, 0), pixel(png, 8, 14), pixel(png, 14, 14), pixel(png, 24, 8), pixel(png, 9, 23)]).toEqual([[32, 64, 96, 255], [255, 0, 0, 255], [32, 64, 96, 255], [0, 0, 255, 255], [255, 255, 255, 255]]);
    expect(() => renderContactSheet([], { scale: 1 })).toThrow('A contact sheet needs at least one asset.');
    expect(() => renderContactSheet(Array.from({ length: 3 }, () => createDocument({ width: 4000, height: 3000, palette })), { scale: 1, maxWidth: 4096 })).toThrow('The contact sheet would be too large.');
  });
});
