import { z } from 'zod';
import { ROW_PATTERN } from './raster-text.js';

const coordinate = z.number().int().min(0);
const size = z.number().int().min(1);
const offset = z.number().int();
const color = z.number().int().min(0).max(32);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(160);
export const assetType = z.enum(['character', 'item', 'prop', 'ui', 'tileset']);
export const preset = z.enum(['1-bit', 'game-boy', '8-bit', '16-bit']);
export const perspective = z.enum(['front', 'side', 'top-down', 'three-quarter', 'isometric']);
export const runQuality = z.enum(['draft', 'standard', 'polished']);
const colorName = z.string().max(40);
const paletteNames = z.array(colorName).max(33).describe('Role names parallel to the palette, "" for unnamed; entry 0 belongs to transparency.');
export const ramp = z.object({ name: z.string().trim().min(1).max(40), indices: z.array(z.number().int().min(1).max(32)).min(2).max(16).describe('Palette indices from dark to light.') }).strict();
const ramps = z.array(ramp).max(16).describe('Named shading ramps of palette indices, dark to light.');
export const palette = z.array(z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)).min(2).max(33);
export const rect = z.object({ x: coordinate, y: coordinate, width: size, height: size }).strict();
export const projectStyle = z.object({
  preset, palette, maxColors: z.number().int().min(1).max(32), paletteLocked: z.boolean(),
  width: size, height: size, perspective,
  lighting: z.string().max(300), outline: z.string().max(300), theme: z.string().max(1000),
  paletteNames: paletteNames.optional(), ramps: ramps.optional(),
}).strict();
const pivot = z.object({ x: z.number().min(0), y: z.number().min(0) }).strict();
const durationMs = z.number().int().min(10).max(60000);
const tagDirection = z.enum(['forward', 'reverse', 'pingpong']);
export const tagInput = z.object({ name, from: z.number().int().min(0), to: z.number().int().min(0), direction: tagDirection.optional(), loop: z.boolean().optional() }).strict();
const legacyDocumentSchema = z.object({
  schemaVersion: z.literal(1), width: size, height: size, palette,
  maxColors: z.number().int().min(1).max(32), paletteLocked: z.boolean(),
  paletteNames: paletteNames.optional(), ramps: ramps.optional(),
  layers: z.array(z.object({
    id, name, visible: z.boolean(), locked: z.boolean(),
    pixels: z.array(color),
  }).strict()).min(1).max(32),
  pivot,
}).strict();
const terrainMode = z.enum(['corner', 'edge', 'mixed']);
const terrainType = z.object({ name, color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict();
const tileText = z.string().trim().min(1).max(80);
const tileFields = {
  name: tileText, type: tileText, probability: z.number().min(0).max(1000),
  collision: z.array(z.object({ x: coordinate, y: coordinate, width: size, height: size }).strict()).max(8),
  terrain: z.array(z.number().int().min(0).max(8)).length(9),
};
const tileInfo = z.object({ id: z.number().int().min(0), name: tileFields.name.optional(), type: tileFields.type.optional(), probability: tileFields.probability.optional(), collision: tileFields.collision.optional(), terrain: tileFields.terrain.optional() }).strict();
const tilesetSchema = z.object({ tileWidth: size, tileHeight: size, terrainMode, terrains: z.array(terrainType).max(8), tiles: z.array(tileInfo) }).strict();
const documentSchemaV2 = z.object({
  schemaVersion: z.literal(2), width: size, height: size, palette,
  maxColors: z.number().int().min(1).max(32), paletteLocked: z.boolean(),
  paletteNames: paletteNames.optional(), ramps: ramps.optional(),
  layers: z.array(z.object({ id, name, visible: z.boolean(), locked: z.boolean() }).strict()).min(1).max(32),
  frames: z.array(z.object({ id, durationMs, cels: z.record(z.string(), z.array(color)) }).strict()).min(1).max(64),
  tags: z.array(z.object({ name, from: z.number().int().min(0), to: z.number().int().min(0), direction: tagDirection, loop: z.boolean() }).strict()).max(32),
  pivot, tileset: tilesetSchema.optional(),
}).strict();
/** Accepts documents written before animation support; callers upgrade them with upgradeDocument. */
export const documentSchema = z.discriminatedUnion('schemaVersion', [legacyDocumentSchema, documentSchemaV2]);
const layerId = id;
// Every drawing operation shares these; apply_operations explains them once instead of repeating a description per operation.
const frameId = id.optional();
const frameIds = z.union([z.array(id).min(1).max(64), z.literal('all')]).optional();
const draw = { layerId, frameId, frameIds };
const areaRect = rect.optional();
export const operation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('pixels'), ...draw, points: z.array(z.tuple([coordinate, coordinate, color])).min(1) }).strict().describe('Set single pixels; each point is [x, y, paletteIndex], index 0 erases.'),
  z.object({ op: z.literal('patch'), ...draw, x: coordinate, y: coordinate, width: size, height: size, pixels: z.array(color) }).strict().describe('Write a width×height block from a flat list of palette indices, row by row. Prefer rows.'),
  z.object({ op: z.literal('rows'), ...draw, x: coordinate, y: coordinate, rows: z.array(z.string().regex(ROW_PATTERN, 'Use . for transparent and 1-9, a-w for palette indices 1-32.')).min(1), mode: z.enum(['replace', 'over']).optional() }).strict().describe('Write a block as text with its top-left at (x, y): one string per row, "." transparent, 1-9 and a-w = palette index 1-32, all rows equally long. mode replace (default) also writes the transparent cells; over keeps existing pixels under ".".'),
  z.object({ op: z.literal('line'), ...draw, x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, color }).strict().describe('1 px line from (x1, y1) to (x2, y2), both end points included.'),
  z.object({ op: z.literal('rect'), ...draw, x: coordinate, y: coordinate, width: size, height: size, color, filled: z.boolean().optional() }).strict().describe('Rectangle with top-left (x, y); filled (default) or, with filled false, a 1 px border.'),
  z.object({ op: z.literal('ellipse'), ...draw, x: coordinate, y: coordinate, width: size, height: size, color, filled: z.boolean().optional() }).strict().describe('Ellipse inscribed in the box with top-left (x, y) and the given width and height (not center and radius); filled (default) or a 1 px ring.'),
  z.object({ op: z.literal('polygon'), ...draw, points: z.array(z.tuple([coordinate, coordinate])).min(3).max(128), color, filled: z.boolean().optional() }).strict().describe('Closed polygon through the [x, y] vertices; filled (default) or outline only.'),
  z.object({ op: z.literal('fill'), ...draw, x: coordinate, y: coordinate, color, reference: z.enum(['layer', 'composite']).optional(), contiguous: z.boolean().optional() }).strict().describe('Flood fill from (x, y) over 4-connected pixels of the same index. contiguous false recolors every matching pixel in scope. reference composite reads the visible image but writes only this layer, e.g. to color under an outline layer.'),
  z.object({ op: z.literal('move'), ...draw, dx: offset, dy: offset, rect: areaRect }).strict().describe('Move the layer content (or rect) by dx/dy. The source area is cleared and the destination overwritten, including by transparent pixels; opaque pixels must stay on the canvas.'),
  z.object({ op: z.literal('copy'), ...draw, dx: offset, dy: offset, rect: areaRect }).strict().describe('Copy the layer content (or rect) by dx/dy, overwriting the destination including with transparent pixels. Use stamp to keep what lies under transparency.'),
  z.object({ op: z.literal('flip'), ...draw, axis: z.enum(['x', 'y']), rect: areaRect }).strict().describe('Mirror the layer (or rect) in place: axis x swaps left and right, y swaps top and bottom.'),
  z.object({ op: z.literal('rotate'), ...draw, turns: z.union([z.literal(1), z.literal(2), z.literal(3)]), rect: areaRect }).strict().describe('Rotate the layer (or rect) clockwise by quarter turns, anchored at its top-left; a non-square area changes its footprint.'),
  z.object({ op: z.literal('replace'), ...draw, from: color, to: color, rect: areaRect }).strict().describe('Recolor every pixel of palette index from to index to, inside rect or the edit scope.'),
  z.object({ op: z.literal('outline'), ...draw, color, rect: areaRect, reference: z.enum(['layer', 'composite']).optional(), corners: z.boolean().optional() }).strict().describe('Draw a 1 px outline on the transparent pixels around the shape. reference composite outlines all visible layers onto this layer; corners false leaves out diagonal neighbors (thinner, 4-connected).'),
  z.object({ op: z.literal('shift'), ...draw, dx: offset, dy: offset, rect: areaRect }).strict().describe('Offset the layer (or rect) with wrap-around, to bring tile edges into the middle for seam cleanup.'),
  z.object({ op: z.literal('autotile'), ...draw, template: z.enum(['blob', 'edge', 'corner']), x: coordinate.optional(), y: coordinate.optional(), terrain: z.number().int().min(1).max(8).optional() }).strict().describe('Complete an autotile template eight tiles wide from the hand-drawn key tiles in its first row (single, horizontal, vertical, cross, fill): blob 47 tiles, edge 16, corner keys plus 15. x/y are the template origin in tiles. Needs allowLayerChanges, full scope and even tile sizes.'),
  z.object({ op: z.literal('stamp'), ...draw, sourceAssetId: id.optional(), sourceLayerId: id.optional(), sourceFrameId: id.optional(), rect: rect.optional().describe('Source area; defaults to the whole source canvas.'), dx: offset.optional(), dy: offset.optional(), mode: z.enum(['over', 'replace']).optional(), colorMatch: z.enum(['exact', 'nearest']).optional() }).strict().describe('Copy a region from another layer, frame or asset. Destination = source position + dx/dy. sourceLayerId defaults to the target layer and sourceFrameId to the target frame. With sourceAssetId the source is that asset\'s current revision: sourceLayerId then defaults to its visible composite, sourceFrameId to its first frame, and colors are matched by hex (colorMatch exact, default, fails on missing colors) or to the closest palette color (nearest). mode over (default) skips transparent source pixels; replace copies them too.'),
  z.object({ op: z.literal('add_layer'), id, name }).strict().describe('Add an empty layer on top. Needs allowLayerChanges and full scope, like every layer and document metadata operation.'),
  z.object({ op: z.literal('duplicate_layer'), layerId, id, name }).strict().describe('Insert an independent copy of layerId directly above it, in every frame.'),
  z.object({ op: z.literal('remove_layer'), layerId }).strict(),
  z.object({ op: z.literal('update_layer'), layerId, name: name.optional(), visible: z.boolean().optional(), locked: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('reorder_layers'), layerIds: z.array(id).min(1).max(32) }).strict().describe('New order of all layers, bottom to top.'),
  z.object({ op: z.literal('merge_layers'), layerIds: z.array(id).min(2).max(32) }).strict().describe('Combine visible layers into the lowest of them; visible layers in between must be included.'),
  z.object({ op: z.literal('resize_canvas'), width: size, height: size, offsetX: offset.optional(), offsetY: offset.optional() }).strict().describe('Set the canvas size and place the old content at offsetX/offsetY; negative offsets crop. Moves the pivot along.'),
  z.object({ op: z.literal('add_frame'), id, index: z.number().int().min(0).optional(), durationMs: durationMs.optional() }).strict().describe('Add an empty frame at index (default: end). Frame operations need allowFrameChanges, every layer in scope and no rect.'),
  z.object({ op: z.literal('duplicate_frame'), frameId: id, id, index: z.number().int().min(0).optional() }).strict().describe('Copy a frame with all its layers, by default directly after the source.'),
  z.object({ op: z.literal('remove_frame'), frameId: id }).strict(),
  z.object({ op: z.literal('reorder_frames'), frameIds: z.array(id).min(1).max(64) }).strict().describe('New order of all frames.'),
  z.object({ op: z.literal('frame_duration'), frameIds: z.array(id).min(1).max(64), durationMs }).strict().describe('Set the display time of the listed frames.'),
  z.object({ op: z.literal('set_tags'), tags: z.array(tagInput).max(32) }).strict().describe('Replace all animation tags; from/to are zero-based and inclusive.'),
  z.object({ op: z.literal('palette'), colors: palette, remap: z.enum(['index', 'nearest']).optional(), maxColors: z.number().int().min(1).max(32).optional(), names: z.array(colorName.nullable()).max(33).optional().describe('Role names parallel to colors; null or "" for unnamed.'), ramps: ramps.optional() }).strict().describe('Replace the palette (colors[0] must be #00000000). remap index (default) keeps every pixel\'s index, so changing a color recolors its pixels; nearest moves each pixel to the closest new color. maxColors (1..32) changes the color budget of the asset, which is otherwise fixed at creation. Needs allowPaletteChanges, full scope and an unlocked palette. Without names/ramps, index keeps the existing ones and nearest drops them.'),
  z.object({ op: z.literal('palette_names'), names: z.array(z.object({ index: z.number().int().min(1).max(32), name: colorName.nullable() }).strict()).min(1).max(32).optional(), ramps: ramps.optional() }).strict().describe('Name palette colors by role (e.g. "skin shadow") and define shading ramps without changing a pixel; null clears a name, ramps replaces all ramps. Works on a locked palette; needs allowLayerChanges and full scope.'),
  z.object({ op: z.literal('pivot'), x: z.number().min(0), y: z.number().min(0) }).strict().describe('Set the pivot in canvas pixels (characters default to bottom center).'),
  z.object({ op: z.literal('tileset'), tileWidth: size.optional(), tileHeight: size.optional(), terrainMode: terrainMode.optional(), terrains: z.array(terrainType).max(8).optional() }).strict().describe('Set the tile grid (canvas must be a multiple of the tile size; a new size drops tile metadata), the terrain mode and up to 8 terrains.'),
  z.object({ op: z.literal('remove_tileset') }).strict(),
  z.object({ op: z.literal('tile_properties'), tiles: z.array(z.object({
    id: z.number().int().min(0), name: tileFields.name.nullable().optional(), type: tileFields.type.nullable().optional(), probability: tileFields.probability.nullable().optional(),
    collision: tileFields.collision.nullable().optional(), terrain: tileFields.terrain.nullable().optional(),
  }).strict()).min(1).max(4096) }).strict().describe('Set per-tile metadata by tile id (row by row): name, type, probability, collision rectangles in tile pixels and terrain as nine values in Tiled Wang order top, top-right, right, bottom-right, bottom, bottom-left, left, top-left plus center (0 unset, n = terrains[n-1]); null clears a field.'),
]);
export const editScope = z.object({
  layerIds: z.array(id).max(32).describe('Layers this batch may change; all others are protected.'),
  rect: rect.optional().describe('Only pixels inside this rectangle may change.'),
  mask: z.array(z.string().regex(/^[.#]+$/, 'Use # for writable and . for protected pixels.')).min(1).optional().describe('Irregular region inside rect: one string per rect row, "#" writable, "." protected.'),
  frameIds: z.array(id).min(1).max(64).optional().describe('Frames this batch may change; omitted means all.'),
  allowPaletteChanges: z.boolean().optional(), allowLayerChanges: z.boolean().optional(), allowFrameChanges: z.boolean().optional(),
}).strict();
export const applyRequest = z.object({
  expectedRevision: id, requestId: id, label: z.string().max(300).optional(),
  actor: z.enum(['human', 'agent']).optional(), runId: id.optional(), editScope,
  operations: z.array(operation).min(1).max(512),
}).strict();
export const createAssetInput = z.object({
  projectId: id, name, type: assetType, tags: z.array(z.string().max(80)).max(30).optional(),
  width: size.optional(), height: size.optional(), palette: palette.optional(),
  maxColors: z.number().int().min(1).max(32).optional(),
  paletteNames: paletteNames.optional(), ramps: ramps.optional(),
  layers: z.array(z.object({ id, name }).strict()).min(1).max(32).optional(),
  frames: z.array(z.object({ id, durationMs: durationMs.optional() }).strict()).min(1).max(64).optional(),
  animationTags: z.array(tagInput).max(32).optional(),
  tileWidth: size.optional(), tileHeight: size.optional(),
  sourceAssetId: id.optional(), runId: id.optional(),
}).strict();
export const assetUpdate = z.object({ name: name.optional(), tags: z.array(z.string().max(80)).max(30).optional() }).strict();
export const projectInput = z.object({ name, preset: preset.optional() }).strict();
export const assetSearch = z.object({ projectId: id, q: z.string().max(300).optional(), type: z.union([assetType, z.literal('')]).optional() }).strict();
export const projectUpdate = z.object({ name: name.optional(), style: projectStyle.optional() }).strict();
export const restoreInput = z.object({ revisionId: id, expectedRevision: id, requestId: id, label: z.string().max(300).optional(), actor: z.enum(['human', 'agent']).optional() }).strict();
export const runInput = z.object({
  projectId: id, assetId: id.optional(), prompt: z.string().trim().min(1).max(12000),
  quality: runQuality.optional().describe('Review and batch budget: draft (quick sketch), standard (default) or polished (more correction rounds, no time target).'),
}).strict();
export const reviewInput = z.object({
  revisionId: id, observations: z.string().trim().min(1).max(6000),
  issues: z.array(z.string().max(1000)).max(30),
  reviewer: z.enum(['self', 'independent']).optional().describe('independent when a separate agent that saw only the image and the task wrote these observations.'),
}).strict();
export const artistRunImport = runInput.extend({
  id, status: z.enum(['active', 'completed', 'needs_review', 'cancelled', 'interrupted']),
  reviews: z.array(reviewInput.extend({ createdAt: z.string().datetime() })).max(8),
  inspectedRevisionId: id.optional(), inspectedFrameIds: z.array(id).max(64).optional(), batchCount: z.number().int().min(0).max(400),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export const importPngInput = z.object({
  projectId: id, name, type: assetType, pngBase64: z.string().min(1),
  frameWidth: size.optional(), frameHeight: size.optional(), frameCount: z.number().int().min(1).max(64).optional(), durationMs: durationMs.optional(),
}).strict().refine(input => (input.frameWidth === undefined) === (input.frameHeight === undefined), { message: 'frameWidth and frameHeight belong together.' });
export const revisionImport = z.object({
  id, assetId: id, parentId: id.nullable(), document: documentSchema,
  label: z.string().max(300), actor: z.enum(['human', 'agent', 'import']),
  runId: id.optional(), operations: z.array(operation).max(512),
  validation: z.unknown().optional(), createdAt: z.string().datetime(),
}).strict();
export const projectBundle = z.object({
  kind: z.literal('pixelator-project'), schemaVersion: z.union([z.literal(1), z.literal(2)]),
  project: z.object({ id, name, style: projectStyle, createdAt: z.string().datetime() }).strict(),
  assets: z.array(z.object({
    id, projectId: id, name, type: assetType, tags: z.array(z.string().max(80)).max(30),
    headRevisionId: id, sourceAssetId: id.optional(), style: projectStyle,
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  }).strict()).max(500),
  revisions: z.array(revisionImport).max(10000),
  runs: z.array(artistRunImport).max(10000).optional(),
}).strict();
