import { describe, expect, it } from 'vitest';
import { applyOperations, composite, createDocument, DEFAULT_PALETTE, previewOperations, STYLE_PRESETS, validateDocument } from '../src/engine.js';
import type { EditScope, Operation, PixelDocument } from '../src/types.js';

const palette = ['#00000000', '#FF0000', '#0000FF', '#FFFFFF'];
const make = (width = 4, height = 4) => createDocument({ width, height, palette });
const run = (doc: PixelDocument, operations: Operation[], scope: EditScope = { layerIds: doc.layers.map(layer => layer.id) }) => applyOperations(doc, operations, scope);
const points = (data: [number, number, number][], layerId = 'base'): Operation => ({ op: 'pixels', layerId, points: data });
const get = (doc: PixelDocument, x: number, y: number, layer = 0) => doc.layers[layer].pixels[y * doc.width + x];

describe('pixel document validation and composition', () => {
  it('creates independent transparent rasters and valid style presets', () => {
    const a = make(); const b = make(); a.layers[0].pixels[0] = 1;
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
    const doc = make(); doc.layers[0].pixels.pop();
    expect(validateDocument(doc).issues[0].code).toBe('INVALID_PIXELS');
    expect(() => composite(doc)).toThrow('INVALID_PIXELS');
  });

  it('rejects malformed and sparse documents instead of throwing incidental errors', () => {
    expect(validateDocument(null as unknown as PixelDocument).valid).toBe(false);
    const doc = make(); delete doc.layers[0].pixels[0];
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
    doc.layers[0].pixels = [0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 3, 0, 0, 0];
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
    expect(over.layers[0].pixels.slice(4, 12)).toEqual([0, 1, 0, 2, 0, 2, 3, 0]);
    const wide = createDocument({ width: 2, height: 1, palette: ['#00000000', ...Array.from({ length: 32 }, (_, i) => `#0000${(i + 1).toString(16).padStart(2, '0')}`)] });
    expect(run(wide, [{ op: 'rows', layerId: 'base', x: 0, y: 0, rows: ['aw'] }]).document.layers[0].pixels).toEqual([10, 32]);
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
    expect(doc.layers[0].pixels).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
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
    expect(filled.diff).toEqual({ changedPixels: 1024 * 1024, changedLayers: ['base'], boundingBox: { x: 0, y: 0, width: 1024, height: 1024 } });
    expect(filled.validation).toMatchObject({ valid: true, colorCount: 1, opaquePixels: 1024 * 1024, isolatedPixels: 0 });
    expect(filled.document.layers[0].pixels.every(value => value === 2)).toBe(true);
    expect(doc.layers[0].pixels.every(value => value === 0)).toBe(true);
  });

  it('fills disconnected equal indices globally within the selection', () => {
    const doc = run(make(5, 1), [points([[0, 0, 1], [2, 0, 1], [4, 0, 1]])]).document;
    const selected = run(doc, [{ op: 'fill', layerId: 'base', x: 2, y: 0, color: 2, contiguous: false }], {
      layerIds: ['base'], rect: { x: 1, y: 0, width: 4, height: 1 },
    });
    expect(selected.document.layers[0].pixels).toEqual([1, 0, 2, 0, 2]);
    expect(doc.layers[0].pixels).toEqual([1, 0, 1, 0, 1]);
    expect(selected.diff.changedPixels).toBe(2);
  });

  it('fills a blank layer inside a separate visible outline without changing the reference layer', () => {
    const doc = createDocument({ width: 5, height: 3, palette, layers: [{ id: 'color', name: 'Color' }, { id: 'outline', name: 'Outline' }] });
    const outlined = run(doc, [{ op: 'rect', layerId: 'outline', x: 0, y: 0, width: 5, height: 3, color: 1, filled: false }]).document;
    const before = structuredClone(outlined);
    const filled = run(outlined, [{ op: 'fill', layerId: 'color', x: 1, y: 1, color: 2, reference: 'composite' }], { layerIds: ['color'] });
    expect(filled.document.layers[0].pixels).toEqual([0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0]);
    expect(filled.document.layers[1]).toEqual(before.layers[1]);
    expect(outlined).toEqual(before);
    expect(filled.diff.changedLayers).toEqual(['color']);
    expect(run(outlined, [{ op: 'fill', layerId: 'color', x: 1, y: 1, color: 2 }], { layerIds: ['color'] }).diff.changedPixels).toBe(15);
  });

  it('samples topmost visible indices through transparency even when paint matches the sampled color', () => {
    const doc = createDocument({ width: 4, height: 1, palette, layers: [
      { id: 'background', name: 'Background' }, { id: 'paint', name: 'Paint' },
      { id: 'cover', name: 'Cover' }, { id: 'hidden', name: 'Hidden' },
    ] });
    doc.layers[0].pixels = [1, 1, 1, 1];
    doc.layers[2].pixels = [0, 2, 0, 2];
    doc.layers[3].pixels = [3, 3, 3, 3]; doc.layers[3].visible = false;
    const operation: Operation = { op: 'fill', layerId: 'paint', x: 0, y: 0, color: 1, reference: 'composite' };
    expect(run(doc, [operation], { layerIds: ['paint'] }).document.layers[1].pixels).toEqual([1, 0, 0, 0]);
    const global = run(doc, [{ ...operation, contiguous: false }], { layerIds: ['paint'] });
    expect(global.document.layers[1].pixels).toEqual([1, 0, 1, 0]);
    expect(global.document.layers.filter(layer => layer.id !== 'paint')).toEqual(doc.layers.filter(layer => layer.id !== 'paint'));
    const selected = run(doc, [{ ...operation, x: 2, contiguous: false }], { layerIds: ['paint'], rect: { x: 1, y: 0, width: 3, height: 1 } });
    expect(selected.document.layers[1].pixels).toEqual([0, 0, 1, 0]);
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
    expect(doc.layers[0].pixels.filter(color => color === 2)).toHaveLength(8);
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
    preview.layers[1].pixels[0] = 3; preview.palette[1] = '#00FF00'; preview.pivot.x = 0;
    expect(doc.layers[1].pixels[0]).toBe(0); expect(doc.palette[1]).toBe('#FF0000'); expect(doc.pivot.x).toBe(2);
    expect(() => previewOperations(doc, [points([[0, 0, 1]])], scope)).toThrow('SCOPE_VIOLATION');
    expect(() => previewOperations(doc, [points([[1, 1, 1]]), points([[9, 9, 1]])], scope)).toThrow('OUT_OF_BOUNDS');
    expect(doc.layers[0].pixels.every(value => value === 0)).toBe(true);
    doc.layers[0].pixels[0] = 3;
    expect(() => previewOperations(doc, [{ op: 'palette', colors: ['#00000000', '#FF0000'] }], { layerIds: ['base', 'top'], allowPaletteChanges: true })).toThrow('INVALID_PIXELS');
    delete doc.layers[0].pixels[0];
    expect(() => previewOperations(doc, operations, scope)).toThrow('INVALID_PIXELS');
  });

  it('includes rendered visibility changes and stored palette changes in the pixel diff', () => {
    const doc = createDocument({ width: 3, height: 1, palette, layers: [{ id: 'base', name: 'Base' }, { id: 'top', name: 'Top' }] });
    doc.layers[0].pixels = [1, 0, 1]; doc.layers[1].pixels = [2, 2, 0];
    const hidden = run(doc, [{ op: 'update_layer', layerId: 'top', visible: false }], { layerIds: ['base', 'top'], allowLayerChanges: true });
    expect(hidden.diff).toEqual({ changedPixels: 2, changedLayers: ['top'], boundingBox: { x: 0, y: 0, width: 2, height: 1 } });
    const changed = run(doc, [{ op: 'palette', colors: ['#00000000', '#ff0000', '#0000FF', '#FFFFFF'] }], { layerIds: ['base', 'top'], allowPaletteChanges: true });
    expect(composite(changed.document)).toEqual(composite(doc));
    expect(changed.diff).toEqual({ changedPixels: 2, changedLayers: ['base'], boundingBox: { x: 0, y: 0, width: 3, height: 1 } });
  });

  it('recolors only the selected red armor, leaving equal red eye pixels unchanged', () => {
    const initial = run(make(), [points([[0, 0, 1], [1, 2, 1], [2, 2, 1]])]).document;
    const edited = run(initial, [{ op: 'replace', layerId: 'base', from: 1, to: 2 }], { layerIds: ['base'], rect: { x: 1, y: 2, width: 2, height: 1 } });
    expect(get(edited.document, 0, 0)).toBe(1);
    expect(get(edited.document, 1, 2)).toBe(2);
    expect(edited.diff).toEqual({ changedPixels: 2, changedLayers: ['base'], boundingBox: { x: 1, y: 2, width: 2, height: 1 } });
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
    doc.layers[0].pixels = [1, 2];
    const before = structuredClone(doc);
    const duplicate: Operation = { op: 'duplicate_layer', layerId: 'base', id: 'copy', name: 'Copy' };
    const copied = run(doc, [duplicate], { layerIds: ['base', 'top'], allowLayerChanges: true });
    expect(copied.document.layers.map(layer => layer.id)).toEqual(['base', 'copy', 'top']);
    expect(copied.document.layers[1]).toEqual({ ...before.layers[0], id: 'copy', name: 'Copy' });
    expect(copied.document.layers[1].pixels).not.toBe(copied.document.layers[0].pixels);
    const edited = run(doc, [duplicate, points([[0, 0, 3]], 'copy')], { layerIds: ['base', 'top'], allowLayerChanges: true });
    expect(edited.document.layers[0]).toEqual(before.layers[0]);
    expect(edited.document.layers[1].pixels).toEqual([3, 2]);
    expect(doc).toEqual(before);
  });

  it('retains hidden and locked flags when duplicating and prevents edits to a locked copy', () => {
    const doc = make(); doc.layers[0].pixels[0] = 1; doc.layers[0].visible = false; doc.layers[0].locked = true;
    const before = structuredClone(doc);
    const duplicate: Operation = { op: 'duplicate_layer', layerId: 'base', id: 'copy', name: 'Copy' };
    const scope = { layerIds: ['base'], allowLayerChanges: true };
    const copied = run(doc, [duplicate], scope);
    expect(copied.document.layers[1]).toMatchObject({ visible: false, locked: true, pixels: doc.layers[0].pixels });
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
    expect(moved.layers[0].pixels.slice(0, 4)).toEqual([0, 1, 2, 0]);
    const copied = run(doc, [{ op: 'copy', layerId: 'base', dx: 0, dy: 1, rect: { x: 0, y: 0, width: 2, height: 1 } }]).document;
    expect(copied.layers[0].pixels.slice(0, 6)).toEqual([1, 2, 0, 0, 1, 2]);
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
    expect(rotated.layers[0].pixels.slice(0, 4)).toEqual([2, 3, 1, 0]);
    expect(rotated.layers[0].pixels.slice(4, 8)).toEqual([1, 0, 2, 0]);
    expect(rotated.layers[0].pixels.slice(8, 12)).toEqual([0, 0, 0, 0]);
    const flipped = run(doc, [{ op: 'flip', layerId: 'base', axis: 'x', rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(flipped.layers[0].pixels.slice(0, 4)).toEqual([2, 1, 0, 0]);
    const halfTurn = run(doc, [{ op: 'rotate', layerId: 'base', turns: 2, rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(halfTurn.layers[0].pixels.slice(0, 4)).toEqual([1, 2, 0, 0]);
    expect(halfTurn.layers[0].pixels.slice(4, 8)).toEqual([0, 3, 0, 0]);
    const counterClockwise = run(doc, [{ op: 'rotate', layerId: 'base', turns: 3, rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(counterClockwise.layers[0].pixels.slice(0, 4)).toEqual([2, 0, 1, 0]);
    expect(counterClockwise.layers[0].pixels.slice(4, 8)).toEqual([1, 3, 2, 0]);
    const verticalFlip = run(doc, [{ op: 'flip', layerId: 'base', axis: 'y', rect: { x: 0, y: 0, width: 2, height: 3 } }]).document;
    expect(verticalFlip.layers[0].pixels.slice(0, 4)).toEqual([2, 1, 0, 0]);
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
