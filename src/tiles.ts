import type { Rect, TerrainMode, Tileset, TileInfo } from './types.js';

/**
 * Terrain labels follow Tiled's Wang ID order (top, top-right, right, bottom-right, bottom, bottom-left, left, top-left);
 * slot 8 holds the center terrain that Godot needs and Tiled does not store. 0 means unset, n means terrains[n - 1].
 */
export const WANG_POSITIONS = ['top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left'] as const;
export const TERRAIN_SLOTS = 9;
export const CENTER = 8;
export const MAX_TERRAINS = 8;
export const MAX_TILE_TEXT = 80;
export const TERRAIN_COLORS = ['#6DAA2C', '#D27D2C', '#597DCE', '#D04648', '#DAD45E', '#8595A1', '#D2AA99', '#6DC2CA'];
const SIDES = [0, 2, 4, 6]; const CORNERS = [1, 3, 5, 7]; const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
/** Wang positions a terrain mode reads: corners, sides, or both (Tiled corner/edge/mixed, Godot match corners/sides/both). */
export const activeSlots = (mode: TerrainMode) => mode === 'corner' ? CORNERS : mode === 'edge' ? SIDES : ALL;

export interface TileGrid { columns: number; rows: number; count: number }
export function tileGrid(tileset: Pick<Tileset, 'tileWidth' | 'tileHeight'>, width: number, height: number): TileGrid {
  const columns = Math.floor(width / tileset.tileWidth); const rows = Math.floor(height / tileset.tileHeight);
  return { columns, rows, count: columns * rows };
}
export const tileRect = (tileset: Pick<Tileset, 'tileWidth' | 'tileHeight'>, width: number, id: number): Rect => {
  const columns = Math.floor(width / tileset.tileWidth);
  return { x: id % columns * tileset.tileWidth, y: Math.floor(id / columns) * tileset.tileHeight, width: tileset.tileWidth, height: tileset.tileHeight };
};
export const tileAt = (tileset: Pick<Tileset, 'tileWidth' | 'tileHeight'>, width: number, x: number, y: number) => Math.floor(y / tileset.tileHeight) * Math.floor(width / tileset.tileWidth) + Math.floor(x / tileset.tileWidth);

const bit = (slot: number) => 1 << slot;
const SIDE_MASK = SIDES.reduce((mask, slot) => mask | bit(slot), 0);
/** Neighbor masks of the 47-tile blob set: a corner only counts when both sides next to it connect. */
export function blobMasks(): number[] {
  const result: number[] = [];
  for (let mask = 0; mask < 256; mask++) if (CORNERS.every(slot => !(mask & bit(slot)) || (mask & bit(slot - 1) && mask & bit((slot + 1) % 8)))) result.push(mask);
  return result;
}
export const edgeMasks = () => Array.from({ length: 256 }, (_, mask) => mask).filter(mask => !(mask & ~SIDE_MASK));
export const cornerMasks = () => Array.from({ length: 256 }, (_, mask) => mask).filter(mask => mask && !(mask & SIDE_MASK));
const expectedMasks = (mode: TerrainMode) => mode === 'corner' ? cornerMasks() : mode === 'edge' ? edgeMasks() : blobMasks();

/** Terrain slots of a tile whose connected neighbors are the mask bits. */
export const wangOf = (mask: number, terrain: number): number[] => [...ALL.map(slot => mask & bit(slot) ? terrain : 0), terrain];

export type AutotileTemplate = 'blob' | 'edge' | 'corner';
export type KeyTile = 'single' | 'horizontal' | 'vertical' | 'cross' | 'fill';
export const TEMPLATE_MODE: Record<AutotileTemplate, TerrainMode> = { blob: 'mixed', edge: 'edge', corner: 'corner' };
export const TEMPLATE_COLUMNS = 8;
/** The five hand-drawn key tiles; each is itself a blob tile, and every quarter of every other tile is copied from one of them. */
export const KEY_TILES: { kind: KeyTile; mask: number }[] = [
  { kind: 'single', mask: 0 }, { kind: 'horizontal', mask: bit(2) | bit(6) }, { kind: 'vertical', mask: bit(0) | bit(4) },
  { kind: 'cross', mask: SIDE_MASK }, { kind: 'fill', mask: 255 },
];
export interface TemplateCell { column: number; row: number; key?: KeyTile; mask: number | null }

/** Cell order of a template, 8 columns wide: the key tiles first, then every generated tile by ascending mask. */
export function autotileLayout(template: AutotileTemplate): TemplateCell[] {
  const keys = template === 'edge' ? KEY_TILES.slice(0, 4) : KEY_TILES;
  const keyMasks = new Set(keys.map(key => key.mask));
  const generated = template === 'blob' ? blobMasks().filter(mask => !keyMasks.has(mask)) : template === 'edge' ? edgeMasks().filter(mask => !keyMasks.has(mask)) : cornerMasks();
  // The corner set's key tiles are only sources; they do not belong to the corner terrain.
  const cells = [...keys.map(key => ({ key: key.kind, mask: template === 'corner' ? null : key.mask })), ...generated.map(mask => ({ mask }))];
  return cells.map((cell, index) => ({ ...cell, column: index % TEMPLATE_COLUMNS, row: Math.floor(index / TEMPLATE_COLUMNS) }));
}
export const templateRows = (template: AutotileTemplate) => Math.ceil(autotileLayout(template).length / TEMPLATE_COLUMNS);

/** Which key tile supplies a quarter: v and h are the connected neighbors beside it, d the one diagonal to it. */
const sourceFor = (v: boolean, h: boolean, d: boolean): KeyTile => v && h ? d ? 'fill' : 'cross' : v ? 'vertical' : h ? 'horizontal' : 'single';
// For each quarter (top-left, top-right, bottom-left, bottom-right): its vertical, horizontal and diagonal neighbor slots.
const QUARTER_NEIGHBORS = [[0, 6, 7], [0, 2, 1], [4, 6, 5], [4, 2, 3]];
// Corner tiles: the corner a quarter contains, and the corners toward which its terrain borders run.
const CORNER_QUARTERS = [{ own: 7, v: 5, h: 1, d: 3 }, { own: 1, v: 3, h: 7, d: 5 }, { own: 5, v: 7, h: 3, d: 1 }, { own: 3, v: 1, h: 5, d: 7 }];

/**
 * Composes one tile of a template from the key tiles (RPG Maker style quarter tiles). Blob and edge tiles copy each quarter
 * from the same quarter of a key tile; corner tiles sample the key tiles shifted by half a tile, because their terrain
 * borders run through the tile middle instead of along its edges.
 */
export function composeTile(keys: Record<KeyTile, ArrayLike<number>>, template: AutotileTemplate, mask: number, width: number, height: number): number[] {
  const pixels = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const quarter = (y * 2 < height ? 0 : 2) + (x * 2 < width ? 0 : 1);
    if (template === 'corner') {
      const corner = CORNER_QUARTERS[quarter];
      if (!(mask & bit(corner.own))) continue;
      const source = keys[sourceFor(!!(mask & bit(corner.v)), !!(mask & bit(corner.h)), !!(mask & bit(corner.d)))];
      pixels[y * width + x] = source[(y + height / 2) % height * width + (x + width / 2) % width];
    } else {
      const [v, h, d] = QUARTER_NEIGHBORS[quarter];
      pixels[y * width + x] = keys[sourceFor(!!(mask & bit(v)), !!(mask & bit(h)), !!(mask & bit(d)))][y * width + x];
    }
  }
  return pixels;
}

/** Terrain slots with the center derived from the labeled positions when it is unset. */
export function effectiveTerrain(terrain: number[] | undefined, mode: TerrainMode): number[] | null {
  if (!terrain || terrain.length !== TERRAIN_SLOTS) return null;
  const counts = new Map<number, number>();
  for (const slot of activeSlots(mode)) if (terrain[slot]) counts.set(terrain[slot], (counts.get(terrain[slot]) ?? 0) + 1);
  const center = terrain[CENTER] || [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
  return center ? [...terrain.slice(0, CENTER), center] : null;
}

/** Tiles labeled with exactly these terrains on the positions the mode reads. */
function candidates(tileset: Tileset, wanted: number[]): TileInfo[] {
  return tileset.tiles.filter(tile => {
    const terrain = effectiveTerrain(tile.terrain, tileset.terrainMode);
    return !!terrain && activeSlots(tileset.terrainMode).every(slot => terrain[slot] === wanted[slot]) && terrain[CENTER] === wanted[CENTER];
  });
}

/** Expected neighbor combinations of one terrain against empty cells that no tile is labeled for. */
export function missingCombinations(tileset: Tileset, terrain: number): number[] {
  return expectedMasks(tileset.terrainMode).filter(mask => !candidates(tileset, wangOf(mask, terrain)).length);
}

/** A built-in shape with islands, rings, bridges, single cells and diagonal contacts. "#" is terrain. */
export const PREVIEW_SHAPE = [
  '..............',
  '.###...####...',
  '.###...#..#.#.',
  '.###...####...',
  '.....#......#.',
  '.##...#.#####.',
  '.##..#..#...#.',
  '.....##.#####.',
  '..............',
];

export interface TerrainMap { columns: number; rows: number; tiles: (number | null)[]; missing: number }
/**
 * Chooses a tile for every map cell like a terrain brush: mixed and edge sets read the cell's neighbors, corner sets read
 * the shape as terrain at grid vertices. Equal candidates alternate deterministically, weighted by probability.
 * null marks an empty cell, -1 a combination without a labeled tile.
 */
export function terrainMap(tileset: Tileset, terrain: number, shape: string[] = PREVIEW_SHAPE): TerrainMap {
  const filled = (x: number, y: number) => shape[y]?.[x] === '#';
  const corner = tileset.terrainMode === 'corner';
  const columns = (shape[0]?.length ?? 0) - (corner ? 1 : 0); const rows = shape.length - (corner ? 1 : 0);
  const tiles: (number | null)[] = []; let missing = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    let mask = 0;
    if (corner) {
      [[x + 1, y, 1], [x + 1, y + 1, 3], [x, y + 1, 5], [x, y, 7]].forEach(([vx, vy, slot]) => { if (filled(vx, vy)) mask |= bit(slot); });
      if (!mask) { tiles.push(null); continue; }
    } else {
      if (!filled(x, y)) { tiles.push(null); continue; }
      const offsets = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
      offsets.forEach(([dx, dy], slot) => { if (filled(x + dx, y + dy)) mask |= bit(slot); });
      mask = tileset.terrainMode === 'edge' ? mask & SIDE_MASK : reduceBlob(mask);
    }
    const options = candidates(tileset, wangOf(mask, terrain));
    if (!options.length) { tiles.push(-1); missing++; continue; }
    const weights = options.map(tile => tile.probability ?? 1); const total = weights.reduce((sum, value) => sum + value, 0);
    let pick = ((x * 73856093) ^ (y * 19349663)) % 1000 / 1000 * total; let chosen = options[0];
    for (let i = 0; i < options.length; i++) { pick -= weights[i]; if (pick < 0) { chosen = options[i]; break; } }
    tiles.push(chosen.id);
  }
  return { columns, rows, tiles, missing };
}
/** Drops corner bits whose two neighboring sides are not both connected. */
const reduceBlob = (mask: number) => CORNERS.reduce((result, slot) => result & bit(slot - 1) && result & bit((slot + 1) % 8) ? result : result & ~bit(slot), mask);

/** Renders a terrain map from the tile pixels of a composite raster; missing combinations show as magenta. */
export function renderTerrainMap(map: TerrainMap, tileset: Tileset, indices: ArrayLike<number>, palette: string[], width: number): { width: number; height: number; rgba: Uint8ClampedArray } {
  const { tileWidth: tw, tileHeight: th } = tileset; const out = { width: map.columns * tw, height: map.rows * th };
  const rgba = new Uint8ClampedArray(out.width * out.height * 4);
  const colors = palette.map(hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]);
  map.tiles.forEach((tile, cell) => {
    if (tile === null) return;
    const cx = cell % map.columns * tw, cy = Math.floor(cell / map.columns) * th; const source = tile >= 0 ? tileRect(tileset, width, tile) : null;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const at = ((cy + y) * out.width + cx + x) * 4;
      if (!source) { if ((x + y) % 4 < 2) rgba.set([255, 0, 255, 255], at); continue; }
      const index = indices[(source.y + y) * width + source.x + x];
      if (index) rgba.set(colors[index], at);
    }
  });
  return { ...out, rgba };
}
