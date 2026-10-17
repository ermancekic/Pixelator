import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanPreview, fitCanvas, MAX_ZOOM, MIN_ZOOM, panFromDrag, resolveShortcut, zoomAt } from '../web/view-helpers.js';

afterEach(() => vi.unstubAllGlobals());

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

  it('coalesces pointer movements into one transform per frame without touching the canvas', () => {
    let callback: FrameRequestCallback;
    const requestAnimationFrame = vi.fn((next: FrameRequestCallback) => { callback = next; return 0; });
    vi.stubGlobal('window', { requestAnimationFrame, cancelAnimationFrame: vi.fn() });
    const transform = vi.fn();
    const artboard = { style: { set transform(value: string) { transform(value); } } } as HTMLElement;
    const preview = createPanPreview(artboard, { x: 100, y: -50 });
    for (let x = 1; x <= 100; x++) preview.move({ x, y: -x });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(transform).not.toHaveBeenCalled();
    callback!(0);
    expect(transform.mock.calls).toEqual([['translate3d(calc(-50% + 100px), calc(-50% + -100px), 0)']]);
    preview.move({ x: 101, y: -101 });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    callback!(16);
    expect(transform).toHaveBeenCalledTimes(2);
  });

  it('flushes the final pointer position and cancels pending work when a pan ends or is interrupted', () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('window', { requestAnimationFrame: vi.fn(() => 7), cancelAnimationFrame });
    const artboard = { style: { transform: '' } } as HTMLElement;
    const origin = { x: 30, y: -12 };
    const preview = createPanPreview(artboard, origin);
    expect(preview.finish()).toEqual(origin);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    const next = { x: -90, y: 45 };
    preview.move(next);
    expect(preview.finish()).toEqual(next);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(artboard.style.transform).toBe('translate3d(calc(-50% + -90px), calc(-50% + 45px), 0)');
    expect(zoomAt({ zoom: 4, pan: next }, 8).pan).toEqual({ x: -180, y: 90 });
    expect(origin).toEqual({ x: 30, y: -12 });
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

  it('steps frames, toggles playback and onion skin without changing the ellipse key', () => {
    expect(resolveShortcut({ key: ',' })).toBe('previous-frame');
    expect(resolveShortcut({ key: '.' })).toBe('next-frame');
    expect(resolveShortcut({ key: 'k' })).toBe('play');
    expect(resolveShortcut({ key: 'O', shiftKey: true })).toBe('onion');
    expect(resolveShortcut({ key: 'o' })).toBe('ellipse');
    for (const key of [',', '.', 'k']) expect(resolveShortcut({ key }, true)).toBeNull();
  });
});
