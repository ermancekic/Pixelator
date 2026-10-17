import { describe, expect, it } from 'vitest';
import { autotileLayout, blobMasks, composeTile, cornerMasks, edgeMasks, effectiveTerrain, missingCombinations, renderTerrainMap, templateRows, terrainMap, tileAt, tileGrid, tileRect, wangOf } from '../src/tiles.js';
import type { KeyTile } from '../src/tiles.js';
import type { Tileset } from '../src/types.js';

const keys = (): Record<KeyTile, number[]> => ({ single: [1, 1, 1, 1], horizontal: [2, 2, 2, 2], vertical: [3, 3, 3, 3], cross: [4, 4, 4, 4], fill: [5, 5, 5, 5] });
const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;

describe('tile grid and terrain sets', () => {
  it('addresses tiles row by row', () => {
    const grid = { tileWidth: 16, tileHeight: 8 };
    expect(tileGrid(grid, 64, 24)).toEqual({ columns: 4, rows: 3, count: 12 });
    expect(tileRect(grid, 64, 5)).toEqual({ x: 16, y: 8, width: 16, height: 8 });
    expect(tileAt(grid, 64, 63, 23)).toBe(11);
  });

  it('counts 47 blob, 16 edge and 15 non-empty corner combinations', () => {
    expect(blobMasks()).toHaveLength(47);
    expect(blobMasks()).not.toContain(NE);
    expect(blobMasks()).toContain(N | NE | E);
    expect(edgeMasks()).toHaveLength(16);
    expect(cornerMasks()).toHaveLength(15);
    expect(wangOf(N | E | NE, 2)).toEqual([2, 2, 2, 0, 0, 0, 0, 0, 2]);
  });

  it('lays out templates eight tiles wide with the key tiles first', () => {
    const blob = autotileLayout('blob');
    expect(blob).toHaveLength(47);
    expect(blob.slice(0, 5).map(cell => [cell.key, cell.mask])).toEqual([['single', 0], ['horizontal', E | W], ['vertical', N | S], ['cross', N | E | S | W], ['fill', 255]]);
    expect(blob[5]).toMatchObject({ column: 5, row: 0 });
    expect(new Set(blob.map(cell => cell.mask)).size).toBe(47);
    expect(autotileLayout('edge')).toHaveLength(16);
    expect(autotileLayout('corner').filter(cell => cell.mask === null)).toHaveLength(5);
    expect([templateRows('blob'), templateRows('edge'), templateRows('corner')]).toEqual([6, 2, 3]);
  });

  it('builds blob quarters from the key tile that matches each corner situation', () => {
    // 2x2 tiles: one pixel per quarter (top-left, top-right, bottom-left, bottom-right).
    expect(composeTile(keys(), 'blob', 0, 2, 2)).toEqual([1, 1, 1, 1]);
    expect(composeTile(keys(), 'blob', N | E | NE, 2, 2)).toEqual([3, 5, 1, 2]);
    expect(composeTile(keys(), 'blob', N | E | S | W | NE, 2, 2)).toEqual([4, 5, 4, 4]);
    expect(composeTile(keys(), 'edge', N | W, 2, 2)).toEqual([4, 3, 2, 1]);
  });

  it('samples corner tiles from key tiles shifted by half a tile', () => {
    const shifted = { ...keys(), fill: [10, 11, 12, 13] };
    expect(composeTile(shifted, 'corner', NE | SE | SW | NW, 2, 2)).toEqual([13, 12, 11, 10]);
    expect(composeTile(keys(), 'corner', NW, 2, 2)).toEqual([1, 0, 0, 0]);
    expect(composeTile(keys(), 'corner', NW | NE, 2, 2)).toEqual([2, 2, 0, 0]);
  });

  it('derives the center terrain when only positions are labeled', () => {
    expect(effectiveTerrain([1, 0, 2, 0, 2, 0, 0, 0, 0], 'edge')).toEqual([1, 0, 2, 0, 2, 0, 0, 0, 2]);
    expect(effectiveTerrain([0, 0, 0, 0, 0, 0, 0, 0, 0], 'mixed')).toBeNull();
  });
});

describe('terrain maps', () => {
  const blobTileset = (): Tileset => ({ tileWidth: 1, tileHeight: 1, terrainMode: 'mixed', terrains: [{ name: 'Gras', color: '#00FF00' }], tiles: blobMasks().map((mask, id) => ({ id, terrain: wangOf(mask, 1) })) });

  it('chooses the tile whose neighbors match and reports missing combinations', () => {
    const tileset = blobTileset();
    expect(missingCombinations(tileset, 1)).toEqual([]);
    const map = terrainMap(tileset, 1, ['.#.', '###', '.#.']);
    const id = (mask: number) => blobMasks().indexOf(mask);
    expect(map).toMatchObject({ columns: 3, rows: 3, missing: 0 });
    expect(map.tiles).toEqual([null, id(S), null, id(E), id(N | E | S | W), id(W), null, id(N), null]);
    tileset.tiles = tileset.tiles.filter(tile => tile.id !== id(N | E | S | W));
    expect(missingCombinations(tileset, 1)).toEqual([N | E | S | W]);
    expect(terrainMap(tileset, 1, ['.#.', '###', '.#.']).tiles[4]).toBe(-1);
  });

  it('reads corner sets at grid vertices and prefers more probable tiles', () => {
    const tileset: Tileset = { tileWidth: 1, tileHeight: 1, terrainMode: 'corner', terrains: [{ name: 'Sand', color: '#FFFF00' }], tiles: cornerMasks().map((mask, id) => ({ id, terrain: wangOf(mask, 1) })) };
    const map = terrainMap(tileset, 1, ['#.', '..']);
    expect(map).toMatchObject({ columns: 1, rows: 1, missing: 0, tiles: [cornerMasks().indexOf(NW)] });
    tileset.tiles.push({ id: 99, terrain: wangOf(NW, 1), probability: 0 });
    expect(terrainMap(tileset, 1, ['#.', '..']).tiles).toEqual([cornerMasks().indexOf(NW)]);
  });

  it('renders map cells from tile pixels and marks missing tiles', () => {
    const tileset = blobTileset(); tileset.tiles = tileset.tiles.filter(tile => tile.id === 0);
    const map = terrainMap(tileset, 1, ['#.', '##']);
    const image = renderTerrainMap(map, tileset, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ['#00000000', '#102030'], 47);
    expect(image).toMatchObject({ width: 2, height: 2 });
    expect([...image.rgba.subarray(0, 4)]).toEqual([255, 0, 255, 255]);
    expect([...image.rgba.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });
});
