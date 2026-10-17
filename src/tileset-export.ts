import { PNG } from 'pngjs';
import { composite, readIndices } from './engine.js';
import { AppError } from './store.js';
import { CENTER, effectiveTerrain, tileGrid, tileRect, WANG_POSITIONS } from './tiles.js';
import type { PixelDocument, Tileset } from './types.js';

export const TILED_VERSION = '1.10';
export interface TilesetExportOptions { extrude?: number; spacing?: number }
/**
 * Where tiles sit in the exported image. Frames of an animated tileset are stacked as further blocks of rows, so the tile
 * with local ID n in frame k has ID n + k * tilesPerFrame. Extruded edges and spacing become Tiled's margin/spacing and
 * Godot's margins/separation.
 */
export interface TilesetLayout {
  tileWidth: number; tileHeight: number; columns: number; rows: number; tilesPerFrame: number; frames: number;
  extrude: number; margin: number; spacing: number; imageWidth: number; imageHeight: number; tileCount: number; animated: number[];
}

const requireTileset = (doc: PixelDocument): Tileset => {
  if (!doc.tileset) throw new AppError('NO_TILESET', 'Dieses Asset hat kein Kachelraster.');
  return doc.tileset;
};

/** Tiles whose visible pixels change in any later frame. */
export function animatedTiles(doc: PixelDocument): number[] {
  const tileset = requireTileset(doc); const { count } = tileGrid(tileset, doc.width, doc.height);
  if (doc.frames.length < 2) return [];
  const rasters = doc.frames.map(frame => readIndices(doc, undefined, frame.id));
  const result: number[] = [];
  for (let id = 0; id < count; id++) {
    const area = tileRect(tileset, doc.width, id); let changed = false;
    for (let f = 1; f < rasters.length && !changed; f++) for (let y = area.y; y < area.y + area.height && !changed; y++) for (let x = area.x; x < area.x + area.width; x++) {
      if (rasters[f][y * doc.width + x] !== rasters[0][y * doc.width + x]) { changed = true; break; }
    }
    if (changed) result.push(id);
  }
  return result;
}

export function tilesetLayout(doc: PixelDocument, { extrude = 0, spacing = 0 }: TilesetExportOptions = {}): TilesetLayout {
  const tileset = requireTileset(doc);
  if (!Number.isInteger(extrude) || extrude < 0 || extrude > 4 || !Number.isInteger(spacing) || spacing < 0 || spacing > 8) throw new AppError('INVALID_LAYOUT', 'Extrude muss 0–4 und Abstand 0–8 Pixel betragen.');
  const { columns, rows, count } = tileGrid(tileset, doc.width, doc.height);
  const animated = animatedTiles(doc); const frames = animated.length ? doc.frames.length : 1;
  const gap = 2 * extrude + spacing; const totalRows = rows * frames;
  return {
    tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight, columns, rows, tilesPerFrame: count, frames, extrude, margin: extrude, spacing: gap,
    imageWidth: columns * tileset.tileWidth + (columns - 1) * gap + 2 * extrude, imageHeight: totalRows * tileset.tileHeight + (totalRows - 1) * gap + 2 * extrude,
    tileCount: count * frames, animated,
  };
}
const tileOrigin = (layout: TilesetLayout, id: number) => ({ x: layout.margin + id % layout.columns * (layout.tileWidth + layout.spacing), y: layout.margin + Math.floor(id / layout.columns) * (layout.tileHeight + layout.spacing) });

/** The tileset image: every tile at its grid place, edges repeated outward by extrude pixels against texture bleeding. */
export function renderTilesetImage(doc: PixelDocument, options: TilesetExportOptions = {}): { png: Buffer; layout: TilesetLayout } {
  const tileset = requireTileset(doc); const layout = tilesetLayout(doc, options); const { tileWidth: tw, tileHeight: th, extrude: e } = layout;
  const png = new PNG({ width: layout.imageWidth, height: layout.imageHeight });
  for (let f = 0; f < layout.frames; f++) {
    const rgba = composite(doc, doc.frames[f].id);
    for (let local = 0; local < layout.tilesPerFrame; local++) {
      const source = tileRect(tileset, doc.width, local); const origin = tileOrigin(layout, local + f * layout.tilesPerFrame);
      for (let y = -e; y < th + e; y++) for (let x = -e; x < tw + e; x++) {
        const sx = source.x + Math.max(0, Math.min(tw - 1, x)); const sy = source.y + Math.max(0, Math.min(th - 1, y));
        png.data.set(rgba.subarray((sy * doc.width + sx) * 4, (sy * doc.width + sx) * 4 + 4), ((origin.y + y) * layout.imageWidth + origin.x + x) * 4);
      }
    }
  }
  return { png: PNG.sync.write(png), layout };
}

const labeled = (tileset: Tileset) => tileset.tiles.filter(tile => tile.terrain?.slice(0, CENTER).some(Boolean));
/** Tiled tileset (.tsj): collision as object groups, names as string properties, frames as tile animations, terrains as one Wang set. */
export function tiledTileset(doc: PixelDocument, name: string, image: string, layout: TilesetLayout) {
  const tileset = requireTileset(doc);
  const ids = [...new Set([...tileset.tiles.map(tile => tile.id), ...layout.animated])].sort((a, b) => a - b);
  const tiles = ids.map(id => {
    const info = tileset.tiles.find(tile => tile.id === id);
    return {
      id, ...(info?.type ? { type: info.type } : {}), ...(info?.probability !== undefined ? { probability: info.probability } : {}),
      ...(info?.name ? { properties: [{ name: 'name', type: 'string', value: info.name }] } : {}),
      ...(info?.collision ? { objectgroup: { draworder: 'index', id: 2, name: '', objects: info.collision.map((area, i) => ({ id: i + 1, name: '', type: '', rotation: 0, visible: true, ...area })), opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 } } : {}),
      ...(layout.animated.includes(id) ? { animation: doc.frames.map((frame, k) => ({ tileid: id + k * layout.tilesPerFrame, duration: frame.durationMs })) } : {}),
    };
  }).filter(tile => Object.keys(tile).length > 1);
  const wangTiles = labeled(tileset);
  return {
    type: 'tileset', version: TILED_VERSION, tiledversion: '1.11.2', name, image, imagewidth: layout.imageWidth, imageheight: layout.imageHeight,
    tilewidth: layout.tileWidth, tileheight: layout.tileHeight, tilecount: layout.tileCount, columns: layout.columns, margin: layout.margin, spacing: layout.spacing,
    ...(tiles.length ? { tiles } : {}),
    ...(tileset.terrains.length && wangTiles.length ? { wangsets: [{
      name: 'Terrain', type: tileset.terrainMode, tile: -1,
      colors: tileset.terrains.map(terrain => ({ name: terrain.name, color: terrain.color, probability: 1, tile: -1 })),
      wangtiles: wangTiles.map(tile => ({ tileid: tile.id, wangid: tile.terrain!.slice(0, CENTER) })),
    }] } : {}),
  };
}

const xml = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The same tileset as Tiled XML (.tsx), the format most engine importers read. */
export function tiledTilesetXml(doc: PixelDocument, name: string, image: string, layout: TilesetLayout): string {
  const data = tiledTileset(doc, name, image, layout); const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset version="${data.version}" tiledversion="${data.tiledversion}" name="${xml(name)}" tilewidth="${data.tilewidth}" tileheight="${data.tileheight}" spacing="${data.spacing}" margin="${data.margin}" tilecount="${data.tilecount}" columns="${data.columns}">`,
    ` <image source="${xml(image)}" width="${data.imagewidth}" height="${data.imageheight}"/>`];
  for (const tile of data.tiles ?? []) {
    lines.push(` <tile id="${tile.id}"${tile.type ? ` type="${xml(tile.type)}"` : ''}${tile.probability !== undefined ? ` probability="${tile.probability}"` : ''}>`);
    if (tile.properties) lines.push('  <properties>', ...tile.properties.map(property => `   <property name="${xml(property.name)}" value="${xml(property.value)}"/>`), '  </properties>');
    if (tile.objectgroup) lines.push('  <objectgroup draworder="index" id="2">', ...tile.objectgroup.objects.map(object => `   <object id="${object.id}" x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}"/>`), '  </objectgroup>');
    if (tile.animation) lines.push('  <animation>', ...tile.animation.map(frame => `   <frame tileid="${frame.tileid}" duration="${frame.duration}"/>`), '  </animation>');
    lines.push(' </tile>');
  }
  for (const set of data.wangsets ?? []) {
    lines.push(' <wangsets>', `  <wangset name="${xml(set.name)}" type="${set.type}" tile="-1">`);
    lines.push(...set.colors.map(color => `   <wangcolor name="${xml(color.name)}" color="${color.color.toLowerCase()}" tile="-1" probability="1"/>`));
    lines.push(...set.wangtiles.map(tile => `   <wangtile tileid="${tile.tileid}" wangid="${tile.wangid.join(',')}"/>`));
    lines.push('  </wangset>', ' </wangsets>');
  }
  lines.push('</tileset>');
  return lines.join('\n') + '\n';
}

// Godot's CellNeighbor names for Tiled's Wang positions, in WANG_POSITIONS order.
const GODOT_NEIGHBORS = ['top_side', 'top_right_corner', 'right_side', 'bottom_right_corner', 'bottom_side', 'bottom_left_corner', 'left_side', 'top_left_corner'];
const GODOT_MODES = { mixed: 0, corner: 1, edge: 2 } as const;
const godotString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const godotColor = (hex: string) => `Color(${[1, 3, 5].map(at => +(parseInt(hex.slice(at, at + 2), 16) / 255).toFixed(4)).join(', ')}, 1)`;

/**
 * Godot 4 TileSet resource (.tres) with one atlas source. The texture path is relative, which Godot resolves next to the
 * .tres file. Terrain mode mixed/corner/edge maps to match corners and sides / corners / sides; animated tiles use their
 * frames' rows below (animation_separation in grid tiles); collision rectangles become polygons around the tile center.
 */
export function godotTileset(doc: PixelDocument, image: string, layout: TilesetLayout): string {
  const tileset = requireTileset(doc); const { tileWidth: tw, tileHeight: th } = layout;
  const rasters = doc.frames.slice(0, layout.frames).map(frame => readIndices(doc, undefined, frame.id));
  const used = (id: number) => { const area = tileRect(tileset, doc.width, id); return rasters.some(raster => { for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) if (raster[y * doc.width + x]) return true; return false; }); };
  const named = tileset.tiles.some(tile => tile.name); const typed = tileset.tiles.some(tile => tile.type); const colliding = tileset.tiles.some(tile => tile.collision?.length);
  const atlas = ['[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]', 'texture = ExtResource("1_texture")',
    `margins = Vector2i(${layout.margin}, ${layout.margin})`, `separation = Vector2i(${layout.spacing}, ${layout.spacing})`, `texture_region_size = Vector2i(${tw}, ${th})`];
  for (let id = 0; id < layout.tilesPerFrame; id++) {
    const info = tileset.tiles.find(tile => tile.id === id);
    if (!info && !used(id)) continue;
    const key = `${id % layout.columns}:${Math.floor(id / layout.columns)}`;
    if (layout.animated.includes(id)) atlas.push(`${key}/animation_columns = 1`, `${key}/animation_separation = Vector2i(0, ${layout.rows - 1})`, ...doc.frames.map((frame, k) => `${key}/animation_frame_${k}/duration = ${frame.durationMs / 1000}`));
    atlas.push(`${key}/0 = 0`);
    if (info?.probability !== undefined) atlas.push(`${key}/0/probability = ${info.probability}`);
    const terrain = effectiveTerrain(info?.terrain, tileset.terrainMode);
    if (terrain && tileset.terrains.length) {
      atlas.push(`${key}/0/terrain_set = 0`, `${key}/0/terrain = ${terrain[CENTER] - 1}`);
      WANG_POSITIONS.forEach((_, slot) => { if (terrain[slot]) atlas.push(`${key}/0/terrains_peering_bit/${GODOT_NEIGHBORS[slot]} = ${terrain[slot] - 1}`); });
    }
    info?.collision?.forEach((area, i) => {
      const left = area.x - tw / 2, top = area.y - th / 2, right = left + area.width, bottom = top + area.height;
      atlas.push(`${key}/0/physics_layer_0/polygon_${i}/points = PackedVector2Array(${[left, top, right, top, right, bottom, left, bottom].join(', ')})`);
    });
    if (named && info?.name) atlas.push(`${key}/0/custom_data_0 = ${godotString(info.name)}`);
    if (typed && info?.type) atlas.push(`${key}/0/custom_data_${named ? 1 : 0} = ${godotString(info.type)}`);
  }
  const resource = ['[resource]', `tile_size = Vector2i(${tw}, ${th})`];
  if (colliding) resource.push('physics_layer_0/collision_layer = 1');
  if (tileset.terrains.length) resource.push(`terrain_set_0/mode = ${GODOT_MODES[tileset.terrainMode]}`, ...tileset.terrains.flatMap((terrain, i) => [`terrain_set_0/terrain_${i}/name = ${godotString(terrain.name)}`, `terrain_set_0/terrain_${i}/color = ${godotColor(terrain.color)}`]));
  [...(named ? ['name'] : []), ...(typed ? ['type'] : [])].forEach((layer, i) => resource.push(`custom_data_layer_${i}/name = ${godotString(layer)}`, `custom_data_layer_${i}/type = 4`));
  resource.push('sources/0 = SubResource("TileSetAtlasSource_1")');
  return ['[gd_resource type="TileSet" load_steps=3 format=3]', '', `[ext_resource type="Texture2D" path=${godotString(image)} id="1_texture"]`, '', ...atlas, '', ...resource].join('\n') + '\n';
}

/** Manual Unity import settings: one sprite per tile at one unit per tile, plus animated tiles and tile metadata. */
export function unityTilesetManifest(assetId: string, revisionId: string, name: string, doc: PixelDocument, image: string, layout: TilesetLayout) {
  const tileset = requireTileset(doc); const sprite = (id: number) => `${name}_${id}`;
  const rect = (id: number) => { const origin = tileOrigin(layout, id); return { x: origin.x, y: layout.imageHeight - origin.y - layout.tileHeight, width: layout.tileWidth, height: layout.tileHeight }; };
  return {
    schemaVersion: 1, assetId, revisionId, name, texture: image, textureWidth: layout.imageWidth, textureHeight: layout.imageHeight,
    tileWidth: layout.tileWidth, tileHeight: layout.tileHeight, pixelsPerUnit: layout.tileWidth,
    textureImporter: { textureType: 'Sprite', spriteMode: 'Multiple', filterMode: 'Point', textureCompression: 'Uncompressed', mipmapEnabled: false, alphaIsTransparency: true, wrapMode: 'Clamp', spriteMeshType: 'FullRect' },
    rectCoordinateSystem: 'pixels, bottom-left origin',
    sprites: Array.from({ length: layout.tileCount }, (_, id) => ({ name: sprite(id), rect: rect(id), pivot: { x: 0.5, y: 0.5 } })),
    animatedTiles: layout.animated.map(id => ({ tile: sprite(id), frames: doc.frames.map((frame, k) => ({ sprite: sprite(id + k * layout.tilesPerFrame), durationMs: frame.durationMs })) })),
    tiles: tileset.tiles.map(({ id, name: tileName, type, collision }) => ({ sprite: sprite(id), ...(tileName ? { name: tileName } : {}), ...(type ? { type } : {}), ...(collision ? { collision: collision.map(area => ({ ...area, y: layout.tileHeight - area.y - area.height })) } : {}) })).filter(tile => Object.keys(tile).length > 1),
  };
}
