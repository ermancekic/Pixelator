import { describe, expect, it } from 'vitest';
import { applyOperations, composite, createDocument, DEFAULT_PALETTE, frameView, insertFrameIntoTags, previewOperations, readIndices, removeFrameFromTags, STYLE_PRESETS, upgradeDocument, validateDocument } from '../src/engine.js';
import type { AnimationTag, EditScope, LegacyPixelDocument, Operation, PixelDocument } from '../src/types.js';
import { cel, setCel } from './helpers.js';

const palette = ['#00000000', '#FF0000', '#0000FF', '#FFFFFF'];
const make = (width = 4, height = 4) => createDocument({ width, height, palette });
const run = (doc: PixelDocument, operations: Operation[], scope: EditScope = { layerIds: doc.layers.map(layer => layer.id) }) => applyOperations(doc, operations, scope);
const points = (data: [number, number, number][], layerId = 'base', frameId?: string): Operation => ({ op: 'pixels', layerId, points: data, ...(frameId ? { frameId } : {}) });
const get = (doc: PixelDocument, x: number, y: number, layer = 0) => cel(doc, layer)[y * doc.width + x];

describe('pixel document validation and composition', () => {
  it('creates independent transparent rasters and valid style presets', () => {
    const a = make(); const b = make(); cel(a, 0)[0] = 1;
    expect(get(b, 0, 0)).toBe(0);
    expect(b.pivot).toEqual({ x: 2, y: 2 });
    expect([...composite(b)]).toEqual(new Array(64).fill(0));
    expect(DEFAULT_PALETTE).toHaveLength(17);
    for (const style of Object.values(STYLE_PRESETS)) {
      expect(validateDocument(createDocument(style)).valid).toBe(true);
    }
    expect(STYLE_PRESETS['1-bit'].maxColors).toBe(2);
    expect(STYLE_PRESETS['game-boy'].maxColors).toBe(4);
  });

  it.each([0, -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid canvas dimension %s', width => {
    expect(() => createDocument({ width, height: 4 })).toThrow('INVALID_SIZE');
  });

  it('rejects an unsafe total pixel count before allocating the raster', () => {
    expect(() => createDocument({ width: Number.MAX_SAFE_INTEGER, height: 2 })).toThrow('INVALID_SIZE');
  });

  it('draws and moves pixels beyond the old canvas, coordinate and point-count limits', () => {
    const doc = make(5000, 2);
    const painted = run(doc, [points(Array.from({ length: 5000 }, (_, x) => [x, 0, 1]))]);
    expect(painted.diff.changedPixels).toBe(5000);
    const moved = run(painted.document, [{ op: 'move', layerId: 'base', dx: -4999, dy: 1, rect: { x: 4999, y: 0, width: 1, height: 1 } }]);
    expect(get(moved.document, 0, 1)).toBe(1);
    expect(get(moved.document, 4999, 0)).toBe(0);
    expect(moved.validation.valid).toBe(true);
  });

  it('enforces binary alpha, palette budget and exact raster lengths', () => {
    expect(() => createDocument({ width: 4, height: 4, palette: ['#00000000', '#FF000080'] })).toThrow('INVALID_PALETTE');
    expect(() => createDocument({ width: 4, height: 4, palette, maxColors: 2 })).toThrow('INVALID_PALETTE');
    expect(() => createDocument({ width: 4, height: 4, maxColors: 33 })).toThrow('INVALID_COLOR_LIMIT');
    const doc = make(); cel(doc, 0).pop();
    expect(validateDocument(doc).issues[0].code).toBe('INVALID_PIXELS');
    expect(() => composite(doc)).toThrow('INVALID_PIXELS');
  });

  it('rejects malformed and sparse documents instead of throwing incidental errors', () => {
    expect(validateDocument(null as unknown as PixelDocument).valid).toBe(false);
    const doc = make(); delete cel(doc, 0)[0];
    expect(validateDocument(doc).issues[0].code).toBe('INVALID_PIXELS');
    expect(() => createDocument({ width: 4, height: 4, palette: ['#00000000', '#FFFFFF', '#ffffff'] })).toThrow('INVALID_PALETTE');
    expect(() => createDocument({ width: 4, height: 4, layers: [{ id: 'base', name: 'A' }, { id: 'base', name: 'B' }] })).toThrow('INVALID_LAYER_ID');
  });

  it('composites topmost visible opaque pixels and reports bounding box', () => {
    let doc = createDocument({ width: 4, height: 4, palette, layers: [{ id: 'body', name: 'Body' }, { id: 'sword', name: 'Sword' }] });
    doc = run(doc, [points([[1, 1, 1]], 'body'), points([[1, 1, 2]], 'sword')]).document;
    expect([...composite(doc).slice(20, 24)]).toEqual([0, 0, 255, 255]);
    expect(validateDocument(doc)).toMatchObject({ colorCount: 1, opaquePixels: 1, boundingBox: { x: 1, y: 1, width: 1, height: 1 }, isolatedPixels: 1 });
    const removed = run(doc, [{ op: 'remove_layer', layerId: 'sword' }], { layerIds: ['body', 'sword'], allowLayerChanges: true }).document;
    expect([...composite(removed).slice(20, 24)]).toEqual([255, 0, 0, 255]);
  });

  it('counts diagonal neighbors without wrapping across canvas edges', () => {
    const doc = make(5, 3);
    setCel(doc, 0, [0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 3, 0, 0, 0]);
    expect(validateDocument(doc)).toMatchObject({
      valid: true, colorCount: 3, opaquePixels: 3, isolatedPixels: 1,
      boundingBox: { x: 0, y: 0, width: 5, height: 3 },
    });
  });
});

describe('deterministic drawing', () => {
  it('replays line, rectangle, ellipse, polygon and patch without changing the input', () => {
    const doc = make(8, 8); const before = structuredClone(doc);
    const operations: Operation[] = [
      { op: 'line', layerId: 'base', x1: 0, y1: 0, x2: 7, y2: 7, color: 1 },
      { op: 'rect', layerId: 'base', x: 1, y: 1, width: 4, height: 3, color: 2, filled: false },
      { op: 'ellipse', layerId: 'base', x: 4, y: 0, width: 4, height: 5, color: 3 },
      { op: 'polygon', layerId: 'base', points: [[0, 5], [3, 5], [0, 7]], color: 2 },
      { op: 'patch', layerId: 'base', x: 6, y: 6, width: 2, height: 2, pixels: [1, 2, 3, 0] },
    ];
    const a = run(doc, operations); const b = run(doc, operations);
    expect(a).toEqual(b);
    expect(doc).toEqual(before);
    expect(get(a.document, 7, 7)).toBe(0);
    expect(get(a.document, 6, 7)).toBe(3);
    expect(a.validation.valid).toBe(true);
  });

  it('writes compact rows identically to patch and keeps pixels under "." in over mode', () => {
    const pixels = [1, 0, 3, 2, 2, 0];
    const patched = run(make(), [{ op: 'patch', layerId: 'base', x: 1, y: 1, width: 3, height: 2, pixels }]);
    const rows = run(make(), [{ op: 'rows', layerId: 'base', x: 1, y: 1, rows: ['1.3', '22.'] }]);
    expect(rows.document).toEqual(patched.document);
    expect(rows.diff).toEqual(patched.diff);
    const over = run(patched.document, [{ op: 'rows', layerId: 'base', x: 1, y: 1, rows: ['..2', '.3.'], mode: 'over' }]).document;
    expect(cel(over, 0).slice(4, 12)).toEqual([0, 1, 0, 2, 0, 2, 3, 0]);
    const wide = createDocument({ width: 2, height: 1, palette: ['#00000000', ...Array.from({ length: 32 }, (_, i) => `#0000${(i + 1).toString(16).padStart(2, '0')}`)] });
    expect(cel(run(wide, [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: ['aw'] }]).document, 0)).toEqual([10, 32]);
  });

  it('rejects malformed, unknown, out-of-palette or clipped rows atomically', () => {
    expect(() => run(make(), [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: ['11', '1'] }])).toThrow('INVALID_ROWS');
    expect(() => run(make(), [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: ['1A'] }])).toThrow('INVALID_ROWS');
    expect(() => run(make(), [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: [] }])).toThrow('INVALID_ROWS');
    expect(() => run(make(), [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: ['4'] }])).toThrow('INVALID_COLOR');
    expect(() => run(make(), [{ op: 'rows', layerId: 'base', x: 3, y: 0, rows: ['11'] }])).toThrow('INVALID_RECT');
    expect(() => run(make(), [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: ['1'], mode: 'under' } as unknown as Operation])).toThrow('INVALID_OPERATION');
    expect(() => run(make(), [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: ['1'] }], { layerIds: ['base'], rect: { x: 1, y: 1, width: 1, height: 1 } })).toThrow('SCOPE_VIOLATION');
  });

  it('uses exact Bresenham pixels for a line', () => {
    const doc = run(make(), [{ op: 'line', layerId: 'base', x1: 0, y1: 0, x2: 3, y2: 3, color: 1 }]).document;
    expect(cel(doc, 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('fills four connected cells only, including a selection boundary', () => {
    const initial = run(make(3, 3), [{ op: 'patch', layerId: 'base', x: 0, y: 0, width: 3, height: 3, pixels: [0, 1, 0, 1, 0, 1, 0, 1, 0] }]).document;
    const filled = run(initial, [{ op: 'fill', layerId: 'base', x: 0, y: 0, color: 2 }]).document;
    expect(get(filled, 0, 0)).toBe(2);
    expect(get(filled, 1, 1)).toBe(0);
    const selected = run(make(), [{ op: 'fill', layerId: 'base', x: 1, y: 1, color: 2 }], { layerIds: ['base'], rect: { x: 1, y: 1, width: 2, height: 2 } });
    expect(selected.diff.changedPixels).toBe(4);
    expect(get(selected.document, 0, 0)).toBe(0);
  });

  it('fills a million-pixel document with exact diagnostics and an independent result', () => {
    const doc = make(1024, 1024);
    const filled = run(doc, [{ op: 'fill', layerId: 'base', x: 1023, y: 1023, color: 2 }]);
    expect(filled.diff).toEqual({ changedPixels: 1024 * 1024, changedLayers: ['base'], changedFrames: ['frame-1'], boundingBox: { x: 0, y: 0, width: 1024, height: 1024 } });
    expect(filled.validation).toMatchObject({ valid: true, colorCount: 1, opaquePixels: 1024 * 1024, isolatedPixels: 0 });
    expect(cel(filled.document, 0).every(value => value === 2)).toBe(true);
    expect(cel(doc, 0).every(value => value === 0)).toBe(true);
  });

  it('fills disconnected equal indices globally within the selection', () => {
    const doc = run(make(5, 1), [points([[0, 0, 1], [2, 0, 1], [4, 0, 1]])]).document;
    const selected = run(doc, [{ op: 'fill', layerId: 'base', x: 2, y: 0, color: 2, contiguous: false }], {
      layerIds: ['base'], rect: { x: 1, y: 0, width: 4, height: 1 },
    });
    expect(cel(selected.document, 0)).toEqual([1, 0, 2, 0, 2]);
    expect(cel(doc, 0)).toEqual([1, 0, 1, 0, 1]);
    expect(selected.diff.changedPixels).toBe(2);
  });

  it('fills a blank layer inside a separate visible outline without changing the reference layer', () => {
    const doc = createDocument({ width: 5, height: 3, palette, layers: [{ id: 'color', name: 'Color' }, { id: 'outline', name: 'Outline' }] });
    const outlined = run(doc, [{ op: 'rect', layerId: 'outline', x: 0, y: 0, width: 5, height: 3, color: 1, filled: false }]).document;
    const before = structuredClone(outlined);
    const filled = run(outlined, [{ op: 'fill', layerId: 'color', x: 1, y: 1, color: 2, reference: 'composite' }], { layerIds: ['color'] });
    expect(cel(filled.document, 0)).toEqual([0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0]);
    expect(filled.document.layers[1]).toEqual(before.layers[1]);
    expect(cel(filled.document, 1)).toEqual(cel(before, 1));
    expect(outlined).toEqual(before);
    expect(filled.diff.changedLayers).toEqual(['color']);
    expect(run(outlined, [{ op: 'fill', layerId: 'color', x: 1, y: 1, color: 2 }], { layerIds: ['color'] }).diff.changedPixels).toBe(15);
  });

  it('samples topmost visible indices through transparency even when paint matches the sampled color', () => {
    const doc = createDocument({ width: 4, height: 1, palette, layers: [
      { id: 'background', name: 'Background' }, { id: 'paint', name: 'Paint' },
      { id: 'cover', name: 'Cover' }, { id: 'hidden', name: 'Hidden' },
    ] });
    setCel(doc, 0, [1, 1, 1, 1]);
    setCel(doc, 2, [0, 2, 0, 2]);
    setCel(doc, 3, [3, 3, 3, 3]); doc.layers[3].visible = false;
    const operation: Operation = { op: 'fill', layerId: 'paint', x: 0, y: 0, color: 1, reference: 'composite' };
    expect(cel(run(doc, [operation], { layerIds: ['paint'] }).document, 1)).toEqual([1, 0, 0, 0]);
    const global = run(doc, [{ ...operation, contiguous: false }], { layerIds: ['paint'] });
    expect(cel(global.document, 1)).toEqual([1, 0, 1, 0]);
    expect(global.document.layers).toEqual(doc.layers);
    expect(Object.entries(global.document.frames[0].cels).filter(([id]) => id !== 'paint')).toEqual(Object.entries(doc.frames[0].cels).filter(([id]) => id !== 'paint'));
    const selected = run(doc, [{ ...operation, x: 2, contiguous: false }], { layerIds: ['paint'], rect: { x: 1, y: 0, width: 3, height: 1 } });
    expect(cel(selected.document, 1)).toEqual([0, 0, 1, 0]);
  });

  it('keeps composite flood traversal inside the edit rectangle and respects target locks', () => {
    const doc = make();
    const operation: Operation = { op: 'fill', layerId: 'base', x: 1, y: 1, color: 2, reference: 'composite' };
    const selected = run(doc, [operation], { layerIds: ['base'], rect: { x: 1, y: 1, width: 2, height: 2 } });
    expect(selected.diff.changedPixels).toBe(4);
    expect(selected.diff.boundingBox).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(() => run(doc, [operation], { layerIds: ['base'], rect: { x: 0, y: 0, width: 1, height: 1 } })).toThrow('SCOPE_VIOLATION');
    doc.layers[0].locked = true;
    expect(() => run(doc, [operation])).toThrow('LAYER_LOCKED');
  });

  it('adds exactly one eight-neighbor outline without expanding the source repeatedly', () => {
    const doc = run(make(5, 5), [points([[2, 2, 1]]), { op: 'outline', layerId: 'base', color: 2 }]).document;
    expect(cel(doc, 0).filter(color => color === 2)).toHaveLength(8);
    expect(get(doc, 2, 2)).toBe(1);
    expect(get(doc, 0, 0)).toBe(0);
  });

  it('rejects unsafe, fractional, off-canvas or malformed point/patch operations', () => {
    expect(() => run(make(), [points([[4, 0, 1]])])).toThrow('OUT_OF_BOUNDS');
    expect(() => run(make(), [points([[0.5, 0, 1]])])).toThrow('INVALID_COORDINATE');
    expect(() => run(make(), [points([[0, 0, 9]])])).toThrow('INVALID_COLOR');
    expect(() => run(make(), [points([[Number.MAX_SAFE_INTEGER + 1, 0, 1]])])).toThrow('INVALID_COORDINATE');
    expect(() => run(make(), [points([])])).toThrow('INVALID_POINTS');
    expect(() => run(make(), [{ op: 'line', layerId: 'base', x1: 0, y1: 0, x2: Number.MAX_SAFE_INTEGER, y2: 0, color: 0 }])).toThrow('OUT_OF_BOUNDS');
    expect(() => run(make(), [{ op: 'patch', layerId: 'base', x: 0, y: 0, width: 2, height: 2, pixels: [1] }])).toThrow('INVALID_PATCH');
    expect(() => run(make(), [{ op: 'patch', layerId: 'base', x: 0, y: 0, width: 1, height: 1, pixels: new Array(1) }])).toThrow('INVALID_COLOR');
    expect(() => run(make(), [{ op: 'fill', layerId: 'base', x: 0, y: 0, color: 1, reference: 'unknown' } as unknown as Operation])).toThrow('INVALID_OPERATION');
    expect(() => run(make(), [{ op: 'fill', layerId: 'base', x: 0, y: 0, color: 1, contiguous: 1 } as unknown as Operation])).toThrow('INVALID_OPERATION');
    expect(() => run(make(), [{ op: 'explode' } as unknown as Operation])).toThrow('UNKNOWN_OPERATION');
  });
});

describe('local edit guarantees and atomicity', () => {
  it('previews the same raster while retaining validation, scope and atomicity', () => {
    const doc = createDocument({ width: 4, height: 4, palette, layers: [{ id: 'base', name: 'Base' }, { id: 'top', name: 'Top' }] });
    const operations: Operation[] = [{ op: 'rect', layerId: 'base', x: 1, y: 1, width: 2, height: 2, color: 1 }];
    const scope = { layerIds: ['base'], rect: { x: 1, y: 1, width: 2, height: 2 } };
    const preview = previewOperations(doc, operations, scope);
    expect(preview).toEqual(run(doc, operations, scope).document);
    cel(preview, 1)[0] = 3; preview.palette[1] = '#00FF00'; preview.pivot.x = 0;
    expect(cel(doc, 1)[0]).toBe(0); expect(doc.palette[1]).toBe('#FF0000'); expect(doc.pivot.x).toBe(2);
    expect(() => previewOperations(doc, [points([[0, 0, 1]])], scope)).toThrow('SCOPE_VIOLATION');
    expect(() => previewOperations(doc, [points([[1, 1, 1]]), points([[9, 9, 1]])], scope)).toThrow('OUT_OF_BOUNDS');
    expect(cel(doc, 0).every(value => value === 0)).toBe(true);
    cel(doc, 0)[0] = 3;
    expect(() => previewOperations(doc, [{ op: 'palette', colors: ['#00000000', '#FF0000'] }], { layerIds: ['base', 'top'], allowPaletteChanges: true })).toThrow('INVALID_PIXELS');
    delete cel(doc, 0)[0];
    expect(() => previewOperations(doc, operations, scope)).toThrow('INVALID_PIXELS');
  });

  it('includes rendered visibility changes and stored palette changes in the pixel diff', () => {
    const doc = createDocument({ width: 3, height: 1, palette, layers: [{ id: 'base', name: 'Base' }, { id: 'top', name: 'Top' }] });
    setCel(doc, 0, [1, 0, 1]); setCel(doc, 1, [2, 2, 0]);
    const hidden = run(doc, [{ op: 'update_layer', layerId: 'top', visible: false }], { layerIds: ['base', 'top'], allowLayerChanges: true });
    expect(hidden.diff).toEqual({ changedPixels: 2, changedLayers: ['top'], changedFrames: ['frame-1'], boundingBox: { x: 0, y: 0, width: 2, height: 1 } });
    const changed = run(doc, [{ op: 'palette', colors: ['#00000000', '#ff0000', '#0000FF', '#FFFFFF'] }], { layerIds: ['base', 'top'], allowPaletteChanges: true });
    expect(composite(changed.document)).toEqual(composite(doc));
    expect(changed.diff).toEqual({ changedPixels: 2, changedLayers: ['base'], changedFrames: ['frame-1'], boundingBox: { x: 0, y: 0, width: 3, height: 1 } });
  });

  it('recolors only the selected red armor, leaving equal red eye pixels unchanged', () => {
    const initial = run(make(), [points([[0, 0, 1], [1, 2, 1], [2, 2, 1]])]).document;
    const edited = run(initial, [{ op: 'replace', layerId: 'base', from: 1, to: 2 }], { layerIds: ['base'], rect: { x: 1, y: 2, width: 2, height: 1 } });
    expect(get(edited.document, 0, 0)).toBe(1);
    expect(get(edited.document, 1, 2)).toBe(2);
    expect(edited.diff).toEqual({ changedPixels: 2, changedLayers: ['base'], changedFrames: ['frame-1'], boundingBox: { x: 1, y: 2, width: 2, height: 1 } });
    expect(edited.document.palette).toEqual(initial.palette);
  });

  it('rejects changes outside scope even when a top layer hides them', () => {
    const doc = createDocument({ width: 3, height: 3, palette, layers: [{ id: 'body', name: 'Body' }, { id: 'cover', name: 'Cover' }] });
    const covered = run(doc, [points([[2, 2, 2]], 'cover')]).document;
    expect(() => run(covered, [points([[2, 2, 1]], 'body')], { layerIds: ['body'], rect: { x: 0, y: 0, width: 1, height: 1 } })).toThrow('SCOPE_VIOLATION');
    expect(() => run(covered, [points([[0, 0, 1]], 'cover')], { layerIds: ['body'] })).toThrow('SCOPE_VIOLATION');
    const hidden = run(covered, [points([[2, 2, 1]], 'body')], { layerIds: ['body'] });
    expect(composite(hidden.document)).toEqual(composite(covered));
    expect(hidden.diff.changedPixels).toBe(1);
    expect(hidden.diff.changedLayers).toEqual(['body']);
  });

  it('does not mutate the input when a later operation fails', () => {
    const doc = make(); const before = structuredClone(doc);
    expect(() => run(doc, [points([[0, 0, 1]]), points([[9, 9, 1]])])).toThrow('OUT_OF_BOUNDS');
    expect(doc).toEqual(before);
    expect(() => run(doc, new Array(513).fill(points([])))).toThrow('INVALID_BATCH');
  });

  it('enforces locks while allowing an explicit full-scope unlock', () => {
    const doc = make(); doc.layers[0].locked = true;
    expect(() => run(doc, [points([[0, 0, 1]])])).toThrow('LAYER_LOCKED');
    const unlocked = run(doc, [{ op: 'update_layer', layerId: 'base', locked: false }, points([[0, 0, 1]])], { layerIds: ['base'], allowLayerChanges: true });
    expect(get(unlocked.document, 0, 0)).toBe(1);
  });

  it('requires full explicit permission for palette and metadata changes', () => {
    const doc = make(); doc.paletteLocked = false;
    const colors = ['#00000000', '#00FF00', '#0000FF', '#FFFFFF'];
    expect(() => run(doc, [{ op: 'palette', colors }])).toThrow('PALETTE_CHANGE_FORBIDDEN');
    expect(() => run(doc, [{ op: 'palette', colors }], { layerIds: ['base'], rect: { x: 0, y: 0, width: 1, height: 1 }, allowPaletteChanges: true })).toThrow('PALETTE_CHANGE_FORBIDDEN');
    const locked = make(); locked.paletteLocked = true;
    expect(() => run(locked, [{ op: 'palette', colors }], { layerIds: ['base'], allowPaletteChanges: true })).toThrow('PALETTE_LOCKED');
    expect(run(doc, [{ op: 'palette', colors }], { layerIds: ['base'], allowPaletteChanges: true }).document.palette).toEqual(colors);
    expect(() => run(doc, [{ op: 'pivot', x: 2, y: 4 }])).toThrow('LAYER_CHANGE_FORBIDDEN');
    expect(run(doc, [{ op: 'pivot', x: 2, y: 4 }], { layerIds: ['base'], allowLayerChanges: true }).document.pivot).toEqual({ x: 2, y: 4 });
    expect(() => run(doc, [{ op: 'pivot', x: 5, y: 4 }], { layerIds: ['base'], allowLayerChanges: true })).toThrow('INVALID_PIVOT');
  });

  it('protects a locked hidden layer from global palette recoloring', () => {
    const doc = run(make(), [points([[0, 0, 1]])]).document;
    doc.layers[0].locked = true; doc.layers[0].visible = false;
    expect(() => run(doc, [{ op: 'palette', colors: ['#00000000', '#00FF00', '#0000FF', '#FFFFFF'] }], { layerIds: ['base'], allowPaletteChanges: true })).toThrow('LAYER_LOCKED');
    expect(run(doc, [{ op: 'palette', colors: ['#00000000', '#FF0000', '#00FF00', '#FFFFFF'] }], { layerIds: ['base'], allowPaletteChanges: true }).validation.valid).toBe(true);
  });
});

describe('selection transforms and layer operations', () => {
  it('duplicates a layer directly above its source with independent pixels and unchanged source data', () => {
    const doc = createDocument({ width: 2, height: 1, palette, layers: [{ id: 'base', name: 'Base' }, { id: 'top', name: 'Top' }] });
    setCel(doc, 0, [1, 2]);
    const before = structuredClone(doc);
    const duplicate: Operation = { op: 'duplicate_layer', layerId: 'base', id: 'copy', name: 'Copy' };
    const copied = run(doc, [duplicate], { layerIds: ['base', 'top'], allowLayerChanges: true });
    expect(copied.document.layers.map(layer => layer.id)).toEqual(['base', 'copy', 'top']);
    expect(copied.document.layers[1]).toEqual({ ...before.layers[0], id: 'copy', name: 'Copy' });
    expect(cel(copied.document, 1)).toEqual(cel(before, 0));
    expect(cel(copied.document, 1)).not.toBe(cel(copied.document, 0));
    const edited = run(doc, [duplicate, points([[0, 0, 3]], 'copy')], { layerIds: ['base', 'top'], allowLayerChanges: true });
    expect(edited.document.layers[0]).toEqual(before.layers[0]);
    expect(cel(edited.document, 1)).toEqual([3, 2]);
    expect(doc).toEqual(before);
  });

  it('retains hidden and locked flags when duplicating and prevents edits to a locked copy', () => {
    const doc = make(); cel(doc, 0)[0] = 1; doc.layers[0].visible = false; doc.layers[0].locked = true;
    const before = structuredClone(doc);
    const duplicate: Operation = { op: 'duplicate_layer', layerId: 'base', id: 'copy', name: 'Copy' };
    const scope = { layerIds: ['base'], allowLayerChanges: true };
    const copied = run(doc, [duplicate], scope);
    expect(copied.document.layers[1]).toMatchObject({ visible: false, locked: true });
    expect(cel(copied.document, 1)).toEqual(cel(doc, 0));
    expect(() => run(doc, [duplicate, points([[0, 0, 2]], 'copy')], scope)).toThrow('LAYER_LOCKED');
    expect(doc).toEqual(before);
  });

  it('requires full metadata scope, a unique valid ID and room below the layer limit to duplicate', () => {
    const doc = createDocument({ width: 1, height: 1, palette, layers: [{ id: 'base', name: 'Base' }, { id: 'top', name: 'Top' }] });
    const duplicate: Operation = { op: 'duplicate_layer', layerId: 'base', id: 'copy', name: 'Copy' };
    const scope = { layerIds: ['base', 'top'], allowLayerChanges: true };
    expect(() => run(doc, [duplicate])).toThrow('LAYER_CHANGE_FORBIDDEN');
    expect(() => run(doc, [duplicate], { layerIds: ['base'], allowLayerChanges: true })).toThrow('LAYER_CHANGE_FORBIDDEN');
    expect(() => run(doc, [duplicate], { ...scope, rect: { x: 0, y: 0, width: 1, height: 1 } })).toThrow('LAYER_CHANGE_FORBIDDEN');
    expect(() => run(doc, [{ ...duplicate, id: 'top' }], scope)).toThrow('INVALID_LAYERS');
    expect(() => run(doc, [{ ...duplicate, id: 'bad id' }], scope)).toThrow('INVALID_LAYER');
    expect(() => run(doc, [{ ...duplicate, layerId: 'missing' }], scope)).toThrow('UNKNOWN_LAYER');
    const full = createDocument({ width: 1, height: 1, palette, layers: Array.from({ length: 32 }, (_, i) => ({ id: `layer_${i}`, name: `Layer ${i}` })) });
    expect(() => run(full, [{ ...duplicate, layerId: 'layer_0' }], { layerIds: full.layers.map(layer => layer.id), allowLayerChanges: true })).toThrow('INVALID_LAYERS');
  });

  it('moves overlapping rectangles from a stable source snapshot and clears the source', () => {
    const doc = run(make(), [points([[0, 0, 1], [1, 0, 2]])]).document;
    const moved = run(doc, [{ op: 'move', layerId: 'base', dx: 1, dy: 0, rect: { x: 0, y: 0, width: 2, height: 1 } }]).document;
    expect(cel(moved, 0).slice(0, 4)).toEqual([0, 1, 2, 0]);
    const copied = run(doc, [{ op: 'copy', layerId: 'base', dx: 0, dy: 1, rect: { x: 0, y: 0, width: 2, height: 1 } }]).document;
    expect(cel(copied, 0).slice(0, 6)).toEqual([1, 2, 0, 0, 1, 2]);
  });

  it('rejects clipped opaque transforms atomically but permits discarded transparent padding', () => {
    const doc = run(make(), [points([[3, 0, 1]])]).document;
    const before = structuredClone(doc);
    for (const op of ['move', 'copy'] as const) expect(() => run(doc, [{ op, layerId: 'base', dx: 1, dy: 0 }])).toThrow('OUT_OF_BOUNDS');
    expect(doc).toEqual(before);
    const small = run(make(), [points([[0, 0, 1]])]).document;
    expect(get(run(small, [{ op: 'move', layerId: 'base', dx: 1, dy: 0 }]).document, 1, 0)).toBe(1);
  });

  it('flips a selection and rotates clockwise at its origin into swapped dimensions', () => {
    const doc = run(make(), [{ op: 'patch', layerId: 'base', x: 0, y: 0, width: 2, height: 3, pixels: [1, 2, 3, 0, 2, 1] }]).document;
    const rotated = run(doc, [{ op: 'rotate', layerId: 'base', turns: 1, rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(cel(rotated, 0).slice(0, 4)).toEqual([2, 3, 1, 0]);
    expect(cel(rotated, 0).slice(4, 8)).toEqual([1, 0, 2, 0]);
    expect(cel(rotated, 0).slice(8, 12)).toEqual([0, 0, 0, 0]);
    const flipped = run(doc, [{ op: 'flip', layerId: 'base', axis: 'x', rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(cel(flipped, 0).slice(0, 4)).toEqual([2, 1, 0, 0]);
    const halfTurn = run(doc, [{ op: 'rotate', layerId: 'base', turns: 2, rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(cel(halfTurn, 0).slice(0, 4)).toEqual([1, 2, 0, 0]);
    expect(cel(halfTurn, 0).slice(4, 8)).toEqual([0, 3, 0, 0]);
    const counterClockwise = run(doc, [{ op: 'rotate', layerId: 'base', turns: 3, rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(cel(counterClockwise, 0).slice(0, 4)).toEqual([2, 0, 1, 0]);
    expect(cel(counterClockwise, 0).slice(4, 8)).toEqual([1, 3, 2, 0]);
    const verticalFlip = run(doc, [{ op: 'flip', layerId: 'base', axis: 'y', rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(cel(verticalFlip, 0).slice(0, 4)).toEqual([2, 1, 0, 0]);
  });

  it('adds, edits, reorders and removes layers using one full-scope batch', () => {
    const result = run(make(), [
      { op: 'add_layer', id: 'sword', name: 'Sword' },
      points([[2, 2, 1]], 'sword'),
      { op: 'update_layer', layerId: 'sword', name: 'Weapon', visible: false },
      { op: 'reorder_layers', layerIds: ['sword', 'base'] },
      { op: 'remove_layer', layerId: 'base' },
    ], { layerIds: ['base'], allowLayerChanges: true });
    expect(result.document.layers.map(layer => layer.id)).toEqual(['sword']);
    expect(result.document.layers[0]).toMatchObject({ name: 'Weapon', visible: false });
    expect(result.validation.opaquePixels).toBe(0);
    expect(() => run(make(), [{ op: 'remove_layer', layerId: 'base' }], { layerIds: ['base'], allowLayerChanges: true })).toThrow('INVALID_LAYERS');
  });
});

describe('animation frames and tags', () => {
  const animated = () => createDocument({
    width: 4, height: 2, palette, layers: [{ id: 'body', name: 'Body' }, { id: 'sword', name: 'Sword' }],
    frames: [{ id: 'idle_1' }, { id: 'idle_2', durationMs: 200 }, { id: 'idle_3' }],
    tags: [{ name: 'idle', from: 0, to: 2 }],
  });
  const all = (doc: PixelDocument, extra: Partial<EditScope> = {}): EditScope => ({ layerIds: doc.layers.map(layer => layer.id), allowFrameChanges: true, ...extra });
  const tag = (from: number, to: number): AnimationTag => ({ name: `t${from}-${to}`, from, to, direction: 'forward', loop: true });

  it('lifts a stored single-image document into one frame without changing a pixel', () => {
    const legacy: LegacyPixelDocument = {
      schemaVersion: 1, width: 2, height: 1, palette, maxColors: 3, paletteLocked: false, pivot: { x: 1, y: 1 },
      layers: [{ id: 'body', name: 'Body', visible: true, locked: false, pixels: [1, 0] }, { id: 'top', name: 'Top', visible: false, locked: true, pixels: [0, 2] }],
    };
    const upgraded = upgradeDocument(legacy);
    expect(upgraded).toEqual({
      schemaVersion: 2, width: 2, height: 1, palette, maxColors: 3, paletteLocked: false, pivot: { x: 1, y: 1 },
      layers: [{ id: 'body', name: 'Body', visible: true, locked: false }, { id: 'top', name: 'Top', visible: false, locked: true }],
      frames: [{ id: 'frame-1', durationMs: 100, cels: { body: [1, 0], top: [0, 2] } }], tags: [],
    });
    expect(validateDocument(upgraded).valid).toBe(true);
    expect(upgradeDocument(upgraded)).toBe(upgraded);
    expect(frameView(upgraded).layers.map(layer => layer.pixels)).toEqual([[1, 0], [0, 2]]);
  });

  it('creates named frames with durations and normalized tags and validates every frame', () => {
    const doc = animated();
    expect(doc.frames.map(frame => [frame.id, frame.durationMs])).toEqual([['idle_1', 100], ['idle_2', 200], ['idle_3', 100]]);
    expect(doc.tags).toEqual([{ name: 'idle', from: 0, to: 2, direction: 'forward', loop: true }]);
    expect(doc.frames[0].cels.body).not.toBe(doc.frames[1].cels.body);
    expect(() => createDocument({ width: 1, height: 1, frames: [{ id: 'a' }, { id: 'a' }] })).toThrow('INVALID_FRAME_ID');
    expect(() => createDocument({ width: 1, height: 1, frames: [{ id: 'a', durationMs: 5 }] })).toThrow('INVALID_DURATION');
    expect(() => createDocument({ width: 1, height: 1, frames: [{ id: 'a' }], tags: [{ name: 'run', from: 0, to: 1 }] })).toThrow('INVALID_TAGS');
    expect(() => createDocument({ width: 1, height: 1, frames: Array.from({ length: 65 }, (_, i) => ({ id: `f${i}` })) })).toThrow('INVALID_FRAMES');
    const broken = animated(); delete (broken.frames[1].cels as Record<string, number[]>).sword;
    expect(validateDocument(broken).issues[0]).toMatchObject({ code: 'INVALID_CELS', frameId: 'idle_2' });
    const extra = animated(); extra.frames[0].cels.cape = [0, 0, 0, 0, 0, 0, 0, 0];
    expect(validateDocument(extra).issues[0].code).toBe('INVALID_CELS');
    const reversed = animated(); reversed.tags[0] = { ...reversed.tags[0], from: 2, to: 1 };
    expect(validateDocument(reversed).issues[0].code).toBe('INVALID_TAGS');
  });

  it('reports colors, bounds and empty frames across the whole animation', () => {
    const doc = run(animated(), [points([[0, 0, 1]], 'body', 'idle_1'), points([[3, 1, 2]], 'body', 'idle_3')], { layerIds: ['body'] }).document;
    const report = validateDocument(doc);
    expect(report).toMatchObject({ valid: true, colorCount: 2, opaquePixels: 2, boundingBox: { x: 0, y: 0, width: 4, height: 2 } });
    expect(report.frames).toEqual([
      { frameId: 'idle_1', opaquePixels: 1, boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
      { frameId: 'idle_2', opaquePixels: 0, boundingBox: null },
      { frameId: 'idle_3', opaquePixels: 1, boundingBox: { x: 3, y: 1, width: 1, height: 1 } },
    ]);
    expect(report.issues.map(issue => issue.code)).toEqual(['EMPTY_FRAME', 'ISOLATED_PIXELS']);
    expect(Array.from(readIndices(doc, undefined, 'idle_3'))).toEqual([0, 0, 0, 0, 0, 0, 0, 2]);
    expect([...composite(doc, 'idle_3').slice(28)]).toEqual([0, 0, 255, 255]);
    expect(() => composite(doc, 'missing')).toThrow('UNKNOWN_FRAME');
  });

  it('draws only into the resolved frame and proves every other frame unchanged', () => {
    const doc = animated();
    expect(() => run(doc, [points([[0, 0, 1]], 'body')], { layerIds: ['body'] })).toThrow('FRAME_REQUIRED');
    const scoped = run(doc, [points([[0, 0, 1]], 'body')], { layerIds: ['body'], frameIds: ['idle_2'] });
    expect(scoped.document.frames.map(frame => frame.cels.body[0])).toEqual([0, 1, 0]);
    expect(scoped.diff).toEqual({ changedPixels: 1, changedLayers: ['body'], changedFrames: ['idle_2'], boundingBox: { x: 0, y: 0, width: 1, height: 1 } });
    const explicit = run(doc, [points([[1, 0, 1], [2, 0, 1]], 'body', 'idle_1'), points([[1, 1, 2]], 'sword', 'idle_3')]);
    expect(explicit.diff).toMatchObject({ changedPixels: 3, changedLayers: ['body', 'sword'], changedFrames: ['idle_1', 'idle_3'] });
    expect(() => run(doc, [points([[0, 0, 1]], 'body', 'idle_3')], { layerIds: ['body'], frameIds: ['idle_1', 'idle_2'] })).toThrow('SCOPE_VIOLATION');
    expect(() => run(doc, [points([[0, 0, 1]], 'body', 'idle_9')])).toThrow('UNKNOWN_FRAME');
    expect(() => run(doc, [points([[0, 0, 1]], 'body')], { layerIds: ['body'], frameIds: ['idle_9'] })).toThrow('INVALID_SCOPE');
    const filled = run(doc, [{ op: 'fill', layerId: 'body', frameId: 'idle_2', x: 0, y: 0, color: 3 }], { layerIds: ['body'], frameIds: ['idle_2'] }).document;
    expect(filled.frames.map(frame => frame.cels.body.filter(Boolean).length)).toEqual([0, 8, 0]);
  });

  it('adds, duplicates, removes, reorders and retimes frames atomically with explicit permission', () => {
    const painted = run(animated(), [points([[0, 0, 1]], 'body', 'idle_2')]).document;
    const added = run(painted, [{ op: 'add_frame', id: 'attack_1', durationMs: 80 }, points([[3, 0, 2]], 'sword', 'attack_1')], all(painted));
    expect(added.document.frames.map(frame => frame.id)).toEqual(['idle_1', 'idle_2', 'idle_3', 'attack_1']);
    expect(added.document.frames[3]).toEqual({ id: 'attack_1', durationMs: 80, cels: { body: [0, 0, 0, 0, 0, 0, 0, 0], sword: [0, 0, 0, 2, 0, 0, 0, 0] } });
    expect(added.diff.changedFrames).toEqual(['attack_1']);
    expect(added.document.tags[0]).toMatchObject({ from: 0, to: 3 });
    const copied = run(painted, [{ op: 'duplicate_frame', frameId: 'idle_2', id: 'idle_2b' }], all(painted)).document;
    expect(copied.frames.map(frame => [frame.id, frame.durationMs])).toEqual([['idle_1', 100], ['idle_2', 200], ['idle_2b', 200], ['idle_3', 100]]);
    expect(copied.frames[2].cels).toEqual(painted.frames[1].cels);
    expect(copied.frames[2].cels.body).not.toBe(copied.frames[1].cels.body);
    const reordered = run(painted, [{ op: 'reorder_frames', frameIds: ['idle_3', 'idle_1', 'idle_2'] }, { op: 'frame_duration', frameIds: ['idle_1', 'idle_3'], durationMs: 150 }], all(painted)).document;
    expect(reordered.frames.map(frame => [frame.id, frame.durationMs])).toEqual([['idle_3', 150], ['idle_1', 150], ['idle_2', 200]]);
    const removed = run(painted, [{ op: 'remove_frame', frameId: 'idle_2' }], all(painted));
    expect(removed.document.frames.map(frame => frame.id)).toEqual(['idle_1', 'idle_3']);
    expect(removed.diff).toMatchObject({ changedPixels: 1, changedFrames: ['idle_1', 'idle_2', 'idle_3'].filter(id => id !== 'idle_1') });
    expect(() => run(painted, [{ op: 'add_frame', id: 'x' }], { layerIds: painted.layers.map(layer => layer.id) })).toThrow('FRAME_CHANGE_FORBIDDEN');
    expect(() => run(painted, [{ op: 'add_frame', id: 'x' }], { layerIds: ['body'], allowFrameChanges: true })).toThrow('FRAME_CHANGE_FORBIDDEN');
    expect(() => run(painted, [{ op: 'add_frame', id: 'x' }], all(painted, { rect: { x: 0, y: 0, width: 1, height: 1 } }))).toThrow('FRAME_CHANGE_FORBIDDEN');
    expect(() => run(painted, [{ op: 'remove_frame', frameId: 'idle_2' }], all(painted, { frameIds: ['idle_1'] }))).toThrow('SCOPE_VIOLATION');
    expect(() => run(painted, [{ op: 'reorder_frames', frameIds: ['idle_2', 'idle_1', 'idle_3'] }], all(painted, { frameIds: ['idle_1', 'idle_2'] }))).toThrow('SCOPE_VIOLATION');
    expect(() => run(painted, [{ op: 'reorder_frames', frameIds: ['idle_2', 'idle_1'] }], all(painted))).toThrow('INVALID_FRAMES');
    expect(() => run(painted, [{ op: 'add_frame', id: 'idle_1' }], all(painted))).toThrow('INVALID_FRAMES');
    expect(() => run(painted, [{ op: 'add_frame', id: 'late', index: 9 }], all(painted))).toThrow('INVALID_FRAMES');
    expect(() => run(painted, [{ op: 'frame_duration', frameIds: ['idle_1'], durationMs: 70000 }], all(painted))).toThrow('INVALID_DURATION');
    const single = createDocument({ width: 1, height: 1 });
    expect(() => run(single, [{ op: 'remove_frame', frameId: 'frame-1' }], all(single))).toThrow('INVALID_FRAMES');
    const full = createDocument({ width: 1, height: 1, frames: Array.from({ length: 64 }, (_, i) => ({ id: `f${i}` })) });
    expect(() => run(full, [{ op: 'duplicate_frame', frameId: 'f0', id: 'f64' }], all(full))).toThrow('INVALID_FRAMES');
    const before = structuredClone(painted);
    expect(() => run(painted, [{ op: 'add_frame', id: 'x' }, points([[9, 9, 1]], 'body', 'x')], all(painted))).toThrow('OUT_OF_BOUNDS');
    expect(painted).toEqual(before);
  });

  it('adjusts tags like Pixelorama when frames are inserted or removed', () => {
    const tags = [tag(1, 2), tag(4, 4)];
    expect(insertFrameIntoTags(tags, 0)).toEqual([tag(2, 3), tag(5, 5)].map((t, i) => ({ ...t, name: tags[i].name })));
    expect(insertFrameIntoTags(tags, 1).map(t => [t.from, t.to])).toEqual([[2, 3], [5, 5]]);
    expect(insertFrameIntoTags(tags, 2).map(t => [t.from, t.to])).toEqual([[1, 3], [5, 5]]);
    expect(insertFrameIntoTags(tags, 3).map(t => [t.from, t.to])).toEqual([[1, 3], [5, 5]]);
    expect(insertFrameIntoTags(tags, 5).map(t => [t.from, t.to])).toEqual([[1, 2], [4, 5]]);
    expect(removeFrameFromTags(tags, 0).map(t => [t.from, t.to])).toEqual([[0, 1], [3, 3]]);
    expect(removeFrameFromTags(tags, 1).map(t => [t.from, t.to])).toEqual([[1, 1], [3, 3]]);
    expect(removeFrameFromTags(tags, 4).map(t => [t.from, t.to])).toEqual([[1, 2]]);
    const doc = animated();
    const tagged = run(doc, [{ op: 'set_tags', tags: [{ name: 'start', from: 0, to: 0, direction: 'pingpong', loop: false }, { name: 'end', from: 1, to: 2 }] }], all(doc)).document;
    expect(tagged.tags).toEqual([{ name: 'start', from: 0, to: 0, direction: 'pingpong', loop: false }, { name: 'end', from: 1, to: 2, direction: 'forward', loop: true }]);
    const shifted = run(tagged, [{ op: 'duplicate_frame', frameId: 'idle_1', id: 'idle_1b' }, { op: 'remove_frame', frameId: 'idle_3' }], all(tagged)).document;
    expect(shifted.tags.map(t => [t.name, t.from, t.to])).toEqual([['start', 0, 1], ['end', 2, 2]]);
    expect(() => run(doc, [{ op: 'set_tags', tags: [{ name: 'a', from: 0, to: 0 }, { name: 'a', from: 1, to: 1 }] }], all(doc))).toThrow('INVALID_TAGS');
    expect(() => run(doc, [{ op: 'set_tags', tags: [{ name: 'a', from: 0, to: 3 }] }], all(doc))).toThrow('INVALID_TAGS');
    expect(() => run(doc, [{ op: 'set_tags', tags: [] }], { layerIds: ['body', 'sword'] })).toThrow('FRAME_CHANGE_FORBIDDEN');
  });

  it('stamps regions across frames and layers in over and replace mode', () => {
    let doc = animated();
    doc = run(doc, [{ op: 'rows', layerId: 'body', frameId: 'idle_1', x: 0, y: 0, rows: ['12..', '.3..'] }, { op: 'rows', layerId: 'sword', frameId: 'idle_2', x: 0, y: 0, rows: ['....', '2222'] }]).document;
    const over = run(doc, [{ op: 'stamp', layerId: 'sword', frameId: 'idle_2', sourceLayerId: 'body', sourceFrameId: 'idle_1', rect: { x: 0, y: 0, width: 2, height: 2 }, dx: 1, dy: 0 }], { layerIds: ['sword'], frameIds: ['idle_2'] });
    expect(over.document.frames[1].cels.sword).toEqual([0, 1, 2, 0, 2, 2, 3, 2]);
    expect(over.document.frames[0]).toEqual(doc.frames[0]);
    expect(over.diff).toMatchObject({ changedFrames: ['idle_2'], changedLayers: ['sword'] });
    const replace = run(doc, [{ op: 'stamp', layerId: 'sword', frameId: 'idle_2', sourceLayerId: 'body', sourceFrameId: 'idle_1', rect: { x: 0, y: 0, width: 2, height: 2 }, dx: 1, mode: 'replace' }], { layerIds: ['sword'], frameIds: ['idle_2'] }).document;
    expect(replace.frames[1].cels.sword).toEqual([0, 1, 2, 0, 2, 0, 3, 2]);
    const inPlace = run(doc, [{ op: 'stamp', layerId: 'body', frameId: 'idle_3', sourceFrameId: 'idle_1' }], { layerIds: ['body'], frameIds: ['idle_3'] }).document;
    expect(inPlace.frames[2].cels.body).toEqual(doc.frames[0].cels.body);
    expect(() => run(doc, [{ op: 'stamp', layerId: 'body', frameId: 'idle_3', sourceFrameId: 'idle_1', dx: 3 }], { layerIds: ['body'] })).toThrow('OUT_OF_BOUNDS');
    expect(() => run(doc, [{ op: 'stamp', layerId: 'body', frameId: 'idle_3', sourceFrameId: 'idle_1' }], { layerIds: ['body'], frameIds: ['idle_1'] })).toThrow('SCOPE_VIOLATION');
    expect(() => run(doc, [{ op: 'stamp', layerId: 'body', frameId: 'idle_3', sourceLayerId: 'cape' }], { layerIds: ['body'] })).toThrow('UNKNOWN_LAYER');
    expect(() => run(doc, [{ op: 'stamp', layerId: 'body', frameId: 'idle_3', mode: 'under' } as unknown as Operation])).toThrow('INVALID_OPERATION');
  });

  it('applies layer structure and palette rules to every frame', () => {
    const doc = run(animated(), [points([[0, 0, 1]], 'sword', 'idle_3')]).document;
    const layered = run(doc, [{ op: 'duplicate_layer', layerId: 'sword', id: 'sword_copy', name: 'Copy' }, { op: 'add_layer', id: 'fx', name: 'FX' }, { op: 'remove_layer', layerId: 'body' }], { layerIds: ['body', 'sword'], allowLayerChanges: true }).document;
    expect(layered.frames.map(frame => Object.keys(frame.cels).sort())).toEqual(Array(3).fill(['fx', 'sword', 'sword_copy']));
    expect(layered.frames[2].cels.sword_copy).toEqual(doc.frames[2].cels.sword);
    expect(() => run(doc, [{ op: 'add_layer', id: 'fx', name: 'FX' }], { layerIds: ['body', 'sword'], frameIds: ['idle_1'], allowLayerChanges: true })).toThrow('LAYER_CHANGE_FORBIDDEN');
    const locked = structuredClone(doc); locked.layers[1].locked = true;
    expect(() => run(locked, [{ op: 'palette', colors: ['#00000000', '#00FF00', '#0000FF', '#FFFFFF'] }], { layerIds: ['body', 'sword'], allowPaletteChanges: true })).toThrow('LAYER_LOCKED');
    expect(() => run(doc, [{ op: 'palette', colors: ['#00000000', '#00FF00', '#0000FF', '#FFFFFF'] }], { layerIds: ['body', 'sword'], frameIds: ['idle_1'], allowPaletteChanges: true })).toThrow('PALETTE_CHANGE_FORBIDDEN');
    const recolored = run(doc, [{ op: 'palette', colors: ['#00000000', '#00FF00', '#0000FF', '#FFFFFF'] }], { layerIds: ['body', 'sword'], allowPaletteChanges: true });
    expect(recolored.diff).toMatchObject({ changedPixels: 1, changedFrames: ['idle_3'] });
  });
});
