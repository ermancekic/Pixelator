import { describe, expect, it } from 'vitest';
import { fitCanvas, MAX_ZOOM, MIN_ZOOM, panFromDrag, resolveShortcut, zoomAt } from '../web/view-helpers.js';

describe('canvas navigation', () => {
  it('keeps the world coordinate under the mouse fixed when zooming a panned view', () => {
    const view = { zoom: 4, pan: { x: 30, y: -12 } };
    const anchor = { x: -110, y: 75 };
    const enlarged = zoomAt(view, 8, anchor);
    for (const axis of ['x', 'y'] as const) expect((anchor[axis] - enlarged.pan[axis]) / enlarged.zoom).toBeCloseTo((anchor[axis] - view.pan[axis]) / view.zoom);
    expect(zoomAt(enlarged, 4, anchor)).toEqual(view);
  });

  it('uses integer scales, clamps both zoom limits, and preserves the view at a limit', () => {
    const view = { zoom: MAX_ZOOM, pan: { x: 90, y: -50 } };
    expect(zoomAt(view, MAX_ZOOM + 10, { x: 30, y: 40 })).toBe(view);
    expect(zoomAt(view, -10).zoom).toBe(MIN_ZOOM);
    expect(zoomAt(view, 3.6).zoom).toBe(4);
  });

  it('fits rectangular canvases to the limiting viewport axis and recenters them', () => {
    expect(fitCanvas(64, 16, 400, 600)).toEqual({ zoom: 5, pan: { x: 0, y: 0 } });
    expect(fitCanvas(16, 64, 600, 400).zoom).toBe(5);
    expect(fitCanvas(64, 64, 50, 50).zoom).toBe(MIN_ZOOM);
    expect(fitCanvas(1, 1, 1000, 1000).zoom).toBe(MAX_ZOOM);
  });

  it('pans from the drag origin without accumulating intermediate pointer movement', () => {
    const pan = { x: 100, y: -50 }, start = { x: -4, y: 20 };
    expect(panFromDrag(pan, start, { x: 15, y: -7 })).toEqual({ x: 119, y: -77 });
    expect(panFromDrag(pan, start, start)).toEqual(pan);
    expect(pan).toEqual({ x: 100, y: -50 });
  });
});

describe('editor shortcuts', () => {
  it('keeps fill distinct from the raster shortcut and canvas pan distinct from pixel move', () => {
    expect(resolveShortcut({ key: 'g' })).toBe('fill');
    expect(resolveShortcut({ key: 'G', shiftKey: true })).toBe('grid');
    expect(resolveShortcut({ key: 'm' })).toBe('move');
    expect(resolveShortcut({ key: 'h' })).toBe('pan');
    expect(resolveShortcut({ key: ' ' })).toBe('pan-start');
  });

  it('preserves undo/redo/export modifiers and does not steal unrelated browser shortcuts', () => {
    expect(resolveShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(resolveShortcut({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo');
    expect(resolveShortcut({ key: 'y', ctrlKey: true })).toBe('redo');
    expect(resolveShortcut({ key: 's', ctrlKey: true })).toBe('export');
    expect(resolveShortcut({ key: 'f', ctrlKey: true })).toBeNull();
  });

  it('does nothing in inputs, modals, IME composition, or with Alt held', () => {
    for (const key of [' ', 'p', '?', '+', 'g', 'Delete']) expect(resolveShortcut({ key }, true)).toBeNull();
    expect(resolveShortcut({ key: 'p', isComposing: true })).toBeNull();
    expect(resolveShortcut({ key: 'm', altKey: true })).toBeNull();
  });

  it('resolves zoom, fit, help, and selection shortcuts', () => {
    for (const key of ['+', '=']) expect(resolveShortcut({ key })).toBe('zoom-in');
    expect(resolveShortcut({ key: '-' })).toBe('zoom-out');
    for (const key of ['0', 'f']) expect(resolveShortcut({ key })).toBe('fit');
    expect(resolveShortcut({ key: '1' })).toBe('actual-size');
    expect(resolveShortcut({ key: '?', shiftKey: true })).toBe('help');
    expect(resolveShortcut({ key: 'Escape' })).toBe('cancel');
    expect(resolveShortcut({ key: 'Delete' })).toBe('delete');
  });
});
