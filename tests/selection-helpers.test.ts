import { describe, expect, it } from 'vitest';
import { combineSelections, fromCanvasMask, maskRows, polygonSelection, rectSelection, selectionContains, selectionOutline, selectionScope, transformSelection, wandSelection } from '../web/selection-helpers.js';
import type { Selection } from '../web/selection-helpers.js';

const cells = (selection: Selection | null, width: number, height: number) => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => selection && selectionContains(selection, x, y) ? '#' : '.').join(''));

describe('selection shapes', () => {
  it('trims canvas flags to their box and drops the mask when the box is full', () => {
    expect(fromCanvasMask(new Uint8Array(9), 3, 3)).toBeNull();
    expect(fromCanvasMask(Uint8Array.from([0, 0, 0, 0, 1, 1, 0, 1, 1]), 3, 3)).toEqual({ rect: { x: 1, y: 1, width: 2, height: 2 }, mask: null });
    const diagonal = fromCanvasMask(Uint8Array.from([1, 0, 0, 1]), 2, 2)!;
    expect(maskRows(diagonal)).toEqual(['#.', '.#']);
    expect(selectionScope(diagonal)).toEqual({ rect: { x: 0, y: 0, width: 2, height: 2 }, mask: ['#.', '.#'] });
    expect(selectionScope(rectSelection({ x: 1, y: 1, width: 1, height: 1 }))).toEqual({ rect: { x: 1, y: 1, width: 1, height: 1 } });
  });

  it('fills a lasso path by pixel centers and keeps the path pixels', () => {
    const triangle = polygonSelection([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }], 5, 5);
    expect(cells(triangle, 5, 5)).toEqual(['#####', '####.', '###..', '##...', '#....']);
    expect(cells(polygonSelection([{ x: 1, y: 1 }], 3, 3), 3, 3)).toEqual(['...', '.#.', '...']);
    expect(cells(polygonSelection([{ x: -2, y: 1 }, { x: 5, y: 1 }], 3, 3), 3, 3)).toEqual(['...', '###', '...']);
  });

  it('selects contiguous or global equal indices like the magic wand', () => {
    const indices = [1, 1, 0, 2, 1, 0, 1, 0, 1];
    expect(cells(wandSelection(indices, 3, 3, 0, 0, true), 3, 3)).toEqual(['##.', '.#.', '...']);
    expect(cells(wandSelection(indices, 3, 3, 0, 0, false), 3, 3)).toEqual(['##.', '.#.', '#.#']);
    expect(cells(wandSelection([1, 0, 1, 0, 1, 0], 3, 2, 2, 0, true), 3, 2)).toEqual(['..#', '...']);
  });

  it('adds and subtracts selections and replaces by default', () => {
    const left = rectSelection({ x: 0, y: 0, width: 2, height: 2 }); const right = rectSelection({ x: 1, y: 1, width: 2, height: 2 });
    expect(combineSelections(left, right, 'replace', 3, 3)).toBe(right);
    expect(cells(combineSelections(left, right, 'add', 3, 3), 3, 3)).toEqual(['##.', '###', '.##']);
    expect(cells(combineSelections(left, right, 'subtract', 3, 3), 3, 3)).toEqual(['##.', '#..', '...']);
    expect(combineSelections(left, left, 'subtract', 3, 3)).toBeNull();
    expect(combineSelections(null, right, 'subtract', 3, 3)).toBeNull();
    expect(combineSelections(null, right, 'add', 3, 3)).toBe(right);
  });

  it('outlines only the border edges of a shaped selection', () => {
    expect(selectionOutline(rectSelection({ x: 0, y: 0, width: 1, height: 1 }))).toBe('M0 0h1M0 1h1M0 0v1M1 0v1');
    expect(selectionOutline(rectSelection({ x: 0, y: 0, width: 2, height: 1 })).match(/M/g)).toHaveLength(6);
  });
});

describe('transforming shaped selections', () => {
  const raster = [1, 2, 0, 3, 4, 0, 0, 0, 0];
  const diagonal: Selection = { rect: { x: 0, y: 0, width: 2, height: 2 }, mask: Uint8Array.from([1, 0, 0, 1]) };

  it('moves only the selected pixels and clears their source', () => {
    const moved = transformSelection(raster, 3, 3, diagonal, { dx: 1, dy: 1 });
    expect(moved.selection).toEqual({ rect: { x: 1, y: 1, width: 2, height: 2 }, mask: Uint8Array.from([1, 0, 0, 1]) });
    expect(moved.points).toEqual([[0, 0, 0], [1, 1, 1], [2, 2, 4]]);
    expect(transformSelection(raster, 3, 3, diagonal, { dx: 1, dy: 0 }, true).points).toEqual([[1, 0, 1], [2, 1, 4]]);
    expect(() => transformSelection(raster, 3, 3, diagonal, { dx: 2, dy: 0 })).toThrow('Leinwand');
  });

  it('flips and rotates the selected pixels with their mask', () => {
    const flipped = transformSelection(raster, 3, 3, diagonal, { axis: 'x' });
    expect(flipped.selection.mask).toEqual(Uint8Array.from([0, 1, 1, 0]));
    expect(flipped.points).toEqual([[0, 0, 0], [1, 0, 1], [0, 1, 4], [1, 1, 0]]);
    const bar: Selection = rectSelection({ x: 0, y: 0, width: 2, height: 1 });
    const turned = transformSelection(raster, 3, 3, bar, { turns: 1 });
    expect(turned.selection).toEqual({ rect: { x: 0, y: 0, width: 1, height: 2 }, mask: null });
    expect(turned.points).toEqual([[1, 0, 0], [0, 1, 2]]);
  });
});
