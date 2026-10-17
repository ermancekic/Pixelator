import { describe, expect, it } from 'vitest';
import { clipRgba, copyPixels, mapClipColors, pasteOperation, pastePosition, rgbaClip, sameClip } from '../web/clipboard.js';
import { rectSelection } from '../web/selection-helpers.js';

const palette = ['#00000000', '#FF0000', '#00FF00'];

describe('clipboard', () => {
  it('copies selected pixels as colors with their origin and round-trips through RGBA', () => {
    const clip = copyPixels([1, 0, 2, 2], palette, 2, { rect: { x: 0, y: 0, width: 2, height: 2 }, mask: Uint8Array.from([1, 1, 0, 1]) });
    expect(clip).toEqual({ width: 2, height: 2, colors: ['#FF0000', null, null, '#00FF00'], origin: { x: 0, y: 0 } });
    const read = rgbaClip(clipRgba(clip), 2, 2);
    expect(sameClip(read, clip)).toBe(true);
    expect(rgbaClip([10, 20, 30, 127, 10, 20, 30, 128], 2, 1).colors).toEqual([null, '#0A141E']);
  });

  it('maps colors exactly, extends an unlocked palette and approximates the rest', () => {
    const clip = { width: 3, height: 1, colors: ['#FF0000', '#0000FF', '#FE0000'] };
    expect(mapClipColors(clip, palette, 3, true)).toEqual({ indices: [1, 3, 1], palette: [...palette, '#0000FF'], added: 1, approximated: 1 });
    expect(mapClipColors(clip, palette, 3, false)).toMatchObject({ palette, added: 0, approximated: 2 });
  });

  it('places clips at the selection, their origin or the center and crops rows to the canvas', () => {
    const clip = { width: 2, height: 2, colors: ['#FF0000', null, null, '#FF0000'], origin: { x: 3, y: 3 } };
    expect(pastePosition(clip, 4, 4, null)).toEqual({ x: 2, y: 2 });
    expect(pastePosition(clip, 4, 4, rectSelection({ x: 0, y: 1, width: 1, height: 1 }))).toEqual({ x: 0, y: 1 });
    expect(pastePosition({ ...clip, origin: undefined }, 6, 6, null)).toEqual({ x: 2, y: 2 });
    const placed = pasteOperation([1, 0, 0, 1], clip, 3, 3, 4, 4, 'base', 'f1')!;
    expect(placed.operation).toEqual({ op: 'rows', layerId: 'base', frameId: 'f1', x: 3, y: 3, rows: ['1'], mode: 'over' });
    expect(placed).toMatchObject({ rect: { x: 3, y: 3, width: 1, height: 1 }, cropped: true, selection: { rect: { x: 3, y: 3, width: 1, height: 1 }, mask: null } });
    expect(pasteOperation([0, 0, 0, 0], clip, 0, 0, 4, 4, 'base', 'f1')).toBeNull();
    expect(pasteOperation([1, 0, 0, 1], clip, 0, 0, 4, 4, 'base', 'f1')!.selection.mask).toEqual(Uint8Array.from([1, 0, 0, 1]));
  });
});
