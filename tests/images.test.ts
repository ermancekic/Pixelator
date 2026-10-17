import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { composite, createDocument } from '../src/engine.js';
import { importPng, renderPng, unityManifest } from '../src/images.js';
import { Store } from '../src/store.js';

const palette = ['#00000000', '#FF0000', '#0000FF', '#FFFFFF'];
const pngBase64 = (width: number, height: number, pixels: number[][]) => {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) image.data.set(pixels[i], i * 4);
  return PNG.sync.write(image).toString('base64');
};

describe('lossless PNG input', () => {
  it('imports binary alpha and exact colors without quantization, then exports the same raster', () => {
    const rgba = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0], [255, 0, 0, 255]];
    const doc = importPng(`data:image/png;base64,${pngBase64(2, 2, rgba)}`, 2, true);
    expect(doc).toMatchObject({ width: 2, height: 2, maxColors: 2, paletteLocked: true, palette: ['#00000000', '#FF0000', '#0000FF'] });
    expect(doc.layers[0].pixels).toEqual([1, 2, 0, 1]);
    const exported = PNG.sync.read(renderPng(doc));
    expect([...exported.data]).toEqual(rgba.flat());
    expect(importPng(renderPng(doc).toString('base64'), 2).layers[0].pixels).toEqual([1, 2, 0, 1]);
  });

  it('rejects partial alpha instead of silently thresholding it', () => {
    expect(() => importPng(pngBase64(2, 1, [[255, 0, 0, 255], [255, 0, 0, 128]]), 2))
      .toThrow(expect.objectContaining({ code: 'PARTIAL_ALPHA' }));
  });

  it('rejects excessive colors instead of merging them into a smaller palette', () => {
    expect(() => importPng(pngBase64(3, 1, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]), 2))
      .toThrow(expect.objectContaining({ code: 'PALETTE_LIMIT' }));
  });

  it('rejects unknown imported colors in a locked project without leaving an asset', () => {
    const store = new Store(':memory:');
    try {
      const initial = store.createProject({ name: 'Game Boy', preset: 'game-boy' });
      const project = store.updateProject(initial.id, { style: { ...initial.style, paletteLocked: true } });
      const doc = importPng(pngBase64(1, 1, [[255, 0, 0, 255]]), project.style.maxColors, project.style.paletteLocked);
      expect(() => store.importDocument({ projectId: project.id, name: 'Red item', type: 'item' }, doc))
        .toThrow(expect.objectContaining({ code: 'PALETTE_LIMIT' }));
      expect(store.listAssets(project.id)).toEqual([]);
    } finally { store.close(); }
  });

  it('imports a fully transparent PNG into a locked palette without introducing a foreign black swatch', () => {
    const store = new Store(':memory:');
    try {
      const initial = store.createProject({ name: 'Game Boy', preset: 'game-boy' });
      const project = store.updateProject(initial.id, { style: { ...initial.style, paletteLocked: true } });
      const doc = importPng(pngBase64(2, 1, [[0, 0, 0, 0], [255, 0, 0, 0]]), project.style.maxColors, true);
      const imported = store.importDocument({ projectId: project.id, name: 'Empty', type: 'item' }, doc);
      expect(imported.revision.document.palette).toEqual(project.style.palette);
      expect(imported.revision.document.paletteLocked).toBe(true);
      expect([...PNG.sync.read(renderPng(imported.revision.document)).data]).toEqual(Array(8).fill(0));
      expect(doc.palette).toEqual(['#00000000', '#000000']);
    } finally { store.close(); }
  });

  it('imports images wider and taller than 64 pixels losslessly', () => {
    const rgba = new Array(128 * 96).fill([255, 0, 0, 255]);
    const doc = importPng(pngBase64(128, 96, rgba), 2);
    expect([doc.width, doc.height]).toEqual([128, 96]);
    expect([...PNG.sync.read(renderPng(doc)).data]).toEqual(rgba.flat());
  });

  it('rejects non-PNG, corrupted CRC and zero-size image input', () => {
    expect(() => importPng(Buffer.from('not a png').toString('base64'), 2)).toThrow(expect.objectContaining({ code: 'PNG_REQUIRED' }));
    const corrupted = Buffer.from(pngBase64(1, 1, [[255, 0, 0, 255]]), 'base64');
    corrupted[29] ^= 1;
    expect(() => importPng(corrupted.toString('base64'), 2)).toThrow(expect.objectContaining({ code: 'PNG_INVALID' }));
    const zeroSize = Buffer.from(pngBase64(1, 1, [[255, 0, 0, 255]]), 'base64');
    zeroSize.writeUInt32BE(0, 16);
    expect(() => importPng(zeroSize.toString('base64'), 2)).toThrow(expect.objectContaining({ code: 'PNG_SIZE' }));
  });
});

describe('rendering and Unity coordinates', () => {
  it('renders exact nearest-neighbor blocks, with compositing and transparent edges preserved', () => {
    const doc = createDocument({ width: 3, height: 2, palette, layers: [{ id: 'body', name: 'Body' }, { id: 'weapon', name: 'Weapon' }, { id: 'hidden', name: 'Hidden' }] });
    doc.layers[0].pixels = [1, 0, 2, 0, 1, 0];
    doc.layers[1].pixels = [0, 2, 0, 0, 0, 0];
    doc.layers[2].pixels = [3, 3, 3, 3, 3, 3];
    doc.layers[2].visible = false;
    const sourceColors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255], [0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 0, 0]];
    expect([...PNG.sync.read(renderPng(doc)).data]).toEqual(sourceColors.flat());
    const enlarged = PNG.sync.read(renderPng(doc, 3));
    expect([enlarged.width, enlarged.height]).toEqual([9, 6]);
    for (let i = 0; i < sourceColors.length; i++) {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        const x = (i % 3) * 3 + dx; const y = Math.floor(i / 3) * 3 + dy;
        expect([...enlarged.data.subarray((y * 9 + x) * 4, (y * 9 + x) * 4 + 4)]).toEqual(sourceColors[i]);
      }
    }
    const roundTrip = importPng(renderPng(doc).toString('base64'), 3);
    expect(composite(roundTrip)).toEqual(composite(doc));
  });

  it.each([0, 1.5, 33])('rejects invalid render scale %s', scale => {
    expect(() => renderPng(createDocument({ width: 8, height: 8, palette }), scale))
      .toThrow(expect.objectContaining({ code: 'RENDER_SIZE' }));
  });

  it('renders native and enlarged PNGs beyond 1024 pixels', () => {
    const doc = createDocument({ width: 1025, height: 3, palette });
    doc.layers[0].pixels[1024] = 1;
    for (const scale of [1, 2]) {
      const png = PNG.sync.read(renderPng(doc, scale));
      expect([png.width, png.height]).toEqual([1025 * scale, 3 * scale]);
      expect([...png.data.subarray(1024 * scale * 4, 1024 * scale * 4 + 4)]).toEqual([255, 0, 0, 255]);
    }
  });

  it.each([
    [{ x: 4, y: 8 }, { x: 0.5, y: 0 }],
    [{ x: 2, y: 2 }, { x: 0.25, y: 0.75 }],
  ])('normalizes a top-left pixel pivot %j for Unity', (pivot, normalized) => {
    const doc = createDocument({ width: 8, height: 8, palette, pivot });
    const manifest = unityManifest('asset_1', 'rev_2', 'Skeleton', doc);
    expect(manifest).toMatchObject({
      assetId: 'asset_1', revisionId: 'rev_2', name: 'Skeleton', width: 8, height: 8,
      pixelsPerUnit: 32, pivot: normalized, pivotCoordinateSystem: 'normalized, bottom-left origin',
      textureImporter: { filterMode: 'Point', textureCompression: 'Uncompressed', mipmapEnabled: false, alphaIsTransparency: true },
    });
    expect(doc.pivot).toEqual(pivot);
  });
});
