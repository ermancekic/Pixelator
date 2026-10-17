import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { applyOperations, composite, createDocument } from '../src/engine.js';
import { framesFor, importPng, ONION_COLORS, renderPng, renderSheet, renderThumbnail, sheetLayout, sheetManifest, unityManifest, unitySheetManifest } from '../src/images.js';
import { Store } from '../src/store.js';
import { cel, setCel } from './helpers.js';

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
    expect(cel(doc)).toEqual([1, 2, 0, 1]);
    const exported = PNG.sync.read(renderPng(doc));
    expect([...exported.data]).toEqual(rgba.flat());
    expect(cel(importPng(renderPng(doc).toString('base64'), 2))).toEqual([1, 2, 0, 1]);
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
  it('renders bounded nearest-neighbor thumbnails with aspect ratio and compositing preserved', () => {
    const doc = createDocument({ width: 4, height: 2, palette, layers: [{ id: 'base', name: 'Base' }, { id: 'top', name: 'Top' }] });
    setCel(doc, 0, [1, 0, 2, 3, 0, 1, 3, 2]);
    setCel(doc, 1, [0, 0, 1, 0, 0, 0, 0, 0]);
    const thumbnail = PNG.sync.read(renderThumbnail(doc, 2));
    expect([thumbnail.width, thumbnail.height]).toEqual([2, 1]);
    expect([...thumbnail.data]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
    const native = PNG.sync.read(renderThumbnail(doc));
    expect([native.width, native.height]).toEqual([4, 2]);
    expect([...native.data]).toEqual([...composite(doc)]);
    const tall = createDocument({ width: 1, height: 1025, palette });
    expect(PNG.sync.read(renderThumbnail(tall))).toMatchObject({ width: 1, height: 96 });
    const wide = createDocument({ width: 2048, height: 1024, palette });
    expect(PNG.sync.read(renderThumbnail(wide))).toMatchObject({ width: 96, height: 48 });
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid thumbnail size %s', size => {
    expect(() => renderThumbnail(createDocument({ width: 1, height: 1, palette }), size)).toThrow(expect.objectContaining({ code: 'RENDER_SIZE' }));
  });

  it('renders exact nearest-neighbor blocks, with compositing and transparent edges preserved', () => {
    const doc = createDocument({ width: 3, height: 2, palette, layers: [{ id: 'body', name: 'Body' }, { id: 'weapon', name: 'Weapon' }, { id: 'hidden', name: 'Hidden' }] });
    setCel(doc, 0, [1, 0, 2, 0, 1, 0]);
    setCel(doc, 1, [0, 2, 0, 0, 0, 0]);
    setCel(doc, 2, [3, 3, 3, 3, 3, 3]);
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
    cel(doc)[1024] = 1;
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

describe('animation sheets and engine metadata', () => {
  const walk = () => {
    const doc = createDocument({
      width: 2, height: 1, palette, layers: [{ id: 'body', name: 'Body' }], pivot: { x: 1, y: 1 },
      frames: [{ id: 'idle', durationMs: 300 }, { id: 'walk_1' }, { id: 'walk_2', durationMs: 120 }],
      tags: [{ name: 'idle', from: 0, to: 0 }, { name: 'walk', from: 1, to: 2, direction: 'pingpong' }],
    });
    return applyOperations(doc, [
      { op: 'rows', layerId: 'body', frameId: 'idle', x: 0, y: 0, rows: ['1.'] },
      { op: 'rows', layerId: 'body', frameId: 'walk_1', x: 0, y: 0, rows: ['.2'] },
      { op: 'rows', layerId: 'body', frameId: 'walk_2', x: 0, y: 0, rows: ['33'] },
    ], { layerIds: ['body'] }).document;
  };
  const pixel = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];

  it('lays frames out in rows with a gutter color outside the palette and keeps transparency inside cells', () => {
    const doc = walk();
    const { png, layout } = renderSheet(doc, { columns: 2, gutter: 1 });
    expect(layout).toMatchObject({ columns: 2, rows: 2, gutter: 1, gutterColor: '#FF00FF', width: 5, height: 3 });
    expect(layout.cells.map(({ frameId, x, y, durationMs }) => [frameId, x, y, durationMs])).toEqual([['idle', 0, 0, 300], ['walk_1', 3, 0, 100], ['walk_2', 0, 2, 120]]);
    const image = PNG.sync.read(png);
    expect([image.width, image.height]).toEqual([5, 3]);
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 2, 0)).toEqual([255, 0, 255, 255]);
    expect(pixel(image, 4, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 1, 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(image, 4, 2)).toEqual([255, 0, 255, 255]);
    const magenta = createDocument({ width: 1, height: 1, palette: ['#00000000', '#FF00FF'], frames: [{ id: 'a' }, { id: 'b' }] });
    expect(sheetLayout(magenta, { gutter: 1 }).gutterColor).toBe('#00FFFF');
    const scaled = PNG.sync.read(renderSheet(doc, { frameIds: ['walk_2', 'idle'], scale: 3 }).png);
    expect([scaled.width, scaled.height]).toEqual([12, 3]);
    expect(pixel(scaled, 5, 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(scaled, 6, 0)).toEqual([255, 0, 0, 255]);
    expect(() => sheetLayout(doc, { frameIds: ['missing'] })).toThrow(expect.objectContaining({ code: 'UNKNOWN_FRAME' }));
    expect(framesFor(doc, 'walk')).toEqual(['walk_1', 'walk_2']);
    expect(() => framesFor(doc, 'run')).toThrow(expect.objectContaining({ code: 'UNKNOWN_TAG' }));
  });

  it('tints neighboring frames only where the inspected frame is transparent', () => {
    const doc = walk();
    const image = PNG.sync.read(renderSheet(doc, { frameIds: ['walk_1'], onion: { before: 1, after: 1 } }).png);
    const blue = [parseInt(ONION_COLORS.before[0].slice(1, 3), 16), parseInt(ONION_COLORS.before[0].slice(3, 5), 16), parseInt(ONION_COLORS.before[0].slice(5, 7), 16), 255];
    expect(pixel(image, 0, 0)).toEqual(blue);
    expect(pixel(image, 1, 0)).toEqual([0, 0, 255, 255]);
    const last = PNG.sync.read(renderSheet(doc, { frameIds: ['walk_2'], onion: { after: 2 } }).png);
    expect(pixel(last, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it('describes sheets in Aseprite array format and as Unity sprites with clips per tag', () => {
    const doc = walk();
    const layout = sheetLayout(doc);
    const manifest = sheetManifest('Hero', 'hero.sheet.png', doc, layout);
    expect(manifest.frames.map(frame => [frame.filename, frame.frame, frame.duration])).toEqual([
      ['Hero idle', { x: 0, y: 0, w: 2, h: 1 }, 300], ['Hero walk_1', { x: 2, y: 0, w: 2, h: 1 }, 100], ['Hero walk_2', { x: 4, y: 0, w: 2, h: 1 }, 120],
    ]);
    expect(manifest.meta).toMatchObject({ image: 'hero.sheet.png', size: { w: 6, h: 1 }, frameTags: [{ name: 'idle', from: 0, to: 0, direction: 'forward' }, { name: 'walk', from: 1, to: 2, direction: 'pingpong' }], pivot: { x: 1, y: 1 } });
    const tagged = sheetManifest('Hero', 'walk.png', doc, sheetLayout(doc, { frameIds: framesFor(doc, 'walk') }));
    expect(tagged.meta.frameTags).toEqual([{ name: 'walk', from: 0, to: 1, direction: 'pingpong' }]);
    const tall = sheetLayout(doc, { columns: 1 });
    const unity = unitySheetManifest('asset_1', 'rev_1', 'Hero', doc, { image: 'hero.sheet.png', layout: tall });
    expect(unity).toMatchObject({ texture: 'hero.sheet.png', textureWidth: 2, textureHeight: 3, textureImporter: { spriteMode: 'Multiple', filterMode: 'Point' }, pivot: { x: 0.5, y: 0 } });
    expect(unity.sprites.map(sprite => [sprite.name, sprite.rect])).toEqual([
      ['Hero_idle', { x: 0, y: 2, width: 2, height: 1 }], ['Hero_walk_1', { x: 0, y: 1, width: 2, height: 1 }], ['Hero_walk_2', { x: 0, y: 0, width: 2, height: 1 }],
    ]);
    expect(unity.clips).toEqual([
      { name: 'idle', loop: true, direction: 'forward', frames: [{ sprite: 'Hero_idle', durationMs: 300 }] },
      { name: 'walk', loop: true, direction: 'pingpong', frames: [{ sprite: 'Hero_walk_1', durationMs: 100 }, { sprite: 'Hero_walk_2', durationMs: 120 }] },
    ]);
    const untagged = { ...doc, tags: [] };
    expect(unitySheetManifest('a', 'r', 'Hero', untagged, { image: 'x.png', layout }).clips).toEqual([{ name: 'Hero', loop: true, direction: 'forward', frames: layout.cells.map(cell => ({ sprite: `Hero_${cell.frameId}`, durationMs: cell.durationMs })) }]);
  });
});
