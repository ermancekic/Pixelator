import { rowIndex } from './raster-text.js';
import { activeSlots, autotileLayout, CENTER, composeTile, MAX_TERRAINS, MAX_TILE_TEXT, missingCombinations, TEMPLATE_COLUMNS, TEMPLATE_MODE, templateRows, TERRAIN_COLORS, TERRAIN_SLOTS, tileGrid, wangOf } from './tiles.js';
import type { KeyTile } from './tiles.js';
import type {
  AnimationTag, AnimationTagInput, EditScope, FrameReport, FrameView, Issue, LegacyPixelDocument, Operation, PixelDiff,
  PixelDocument, PixelFrame, PixelLayer, PixelStyle, ProjectStyle, Rect, TerrainMode, TileInfo, Tileset, ValidationReport,
} from './types.js';

export const DEFAULT_PALETTE = [
  '#00000000', '#140C1C', '#442434', '#30346D', '#4E4A4E', '#854C30', '#346524',
  '#D04648', '#757161', '#597DCE', '#D27D2C', '#8595A1', '#6DAA2C', '#D2AA99',
  '#6DC2CA', '#DAD45E', '#DEEED6',
];

function preset(preset: PixelStyle, palette: string[]): ProjectStyle {
  return {
    preset, palette, maxColors: palette.length - 1, paletteLocked: false,
    width: 32, height: 32, perspective: 'side', lighting: 'upper-left',
    outline: 'single-pixel', theme: 'neutral',
  };
}

export const STYLE_PRESETS: Record<PixelStyle, ProjectStyle> = {
  '1-bit': preset('1-bit', ['#00000000', '#171820', '#F4F4DC']),
  'game-boy': preset('game-boy', ['#00000000', '#0F380F', '#306230', '#8BAC0F', '#9BBC0F']),
  '8-bit': preset('8-bit', [...DEFAULT_PALETTE]),
  '16-bit': preset('16-bit', [...DEFAULT_PALETTE]),
};

export const MAX_LAYERS = 32;
export const MAX_FRAMES = 64;
export const MAX_TAGS = 32;
export const DEFAULT_FRAME_MS = 100;
export const MIN_FRAME_MS = 10;
export const MAX_FRAME_MS = 60000;
export const FIRST_FRAME_ID = 'frame-1';
const MAX_OPERATIONS = 512;
const TAG_DIRECTIONS = ['forward', 'reverse', 'pingpong'];
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
const duration = (value: unknown): value is number => integer(value) && value >= MIN_FRAME_MS && value <= MAX_FRAME_MS;
const inside = (rect: Rect, x: number, y: number) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;

function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }
function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) fail(code, message);
}

function paletteIssues(palette: unknown, maxColors: number): Issue[] {
  const issue = (message: string): Issue[] => [{ code: 'INVALID_PALETTE', severity: 'error', message }];
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > maxColors + 1) return issue(`Palette must contain transparency and 1..${maxColors} opaque colors.`);
  if (palette[0] !== '#00000000') return issue('Palette index 0 must be #00000000.');
  if (Array.from(palette.slice(1)).some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) return issue('Opaque palette colors must be #RRGGBB.');
  if (new Set(palette.map(color => color.toUpperCase())).size !== palette.length) return issue('Palette colors must be unique.');
  return [];
}

function tagIssues(tags: unknown, frameCount: number): Issue[] {
  const issue = (message: string): Issue[] => [{ code: 'INVALID_TAGS', severity: 'error', message }];
  if (!Array.isArray(tags) || tags.length > MAX_TAGS) return issue(`Tags must be a list of at most ${MAX_TAGS} entries.`);
  const names = new Set<string>();
  for (const tag of tags) {
    if (!object(tag) || !name(tag.name)) return issue('Each tag needs a name.');
    if (names.has(tag.name)) return issue(`Tag names must be unique: ${tag.name}.`);
    names.add(tag.name);
    if (!integer(tag.from) || !integer(tag.to) || tag.from < 0 || tag.to < tag.from || tag.to >= frameCount) return issue(`Tag ${tag.name} must cover existing frames with 0 <= from <= to.`);
    if (tag.direction !== undefined && !TAG_DIRECTIONS.includes(tag.direction as string)) return issue('Tag direction must be forward, reverse or pingpong.');
    if (tag.loop !== undefined && typeof tag.loop !== 'boolean') return issue('Tag loop must be boolean.');
  }
  return [];
}

const rgbOf = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** Index of the opaque palette color closest to hex, weighted for perceived brightness; never the transparent index 0. */
export function nearestColor(hex: string, palette: string[]): number {
  const [r, g, b] = rgbOf(hex); let best = 1; let distance = Infinity;
  for (let i = 1; i < palette.length; i++) {
    const [pr, pg, pb] = rgbOf(palette[i]);
    const d = 2 * (pr - r) ** 2 + 4 * (pg - g) ** 2 + 3 * (pb - b) ** 2;
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}

const TERRAIN_MODES = ['corner', 'edge', 'mixed'];
const tileText = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TILE_TEXT;
function tilesetIssues(tileset: unknown, width: number, height: number): Issue[] {
  const issue = (message: string): Issue[] => [{ code: 'INVALID_TILESET', severity: 'error', message }];
  if (!object(tileset)) return issue('tileset must be an object.');
  const { tileWidth, tileHeight, terrainMode, terrains, tiles } = tileset;
  if (!integer(tileWidth) || tileWidth < 1 || !integer(tileHeight) || tileHeight < 1) return issue('Tile width and height must be positive integers.');
  if (width % tileWidth || height % tileHeight) return issue(`Canvas ${width}×${height} must be a multiple of the tile size ${tileWidth}×${tileHeight}.`);
  if (!TERRAIN_MODES.includes(terrainMode as string)) return issue('terrainMode must be corner, edge or mixed.');
  if (!Array.isArray(terrains) || terrains.length > MAX_TERRAINS || !terrains.every(terrain => object(terrain) && name(terrain.name) && typeof terrain.color === 'string' && /^#[0-9a-f]{6}$/i.test(terrain.color))) return issue(`Terrains need a name and #RRGGBB color; at most ${MAX_TERRAINS}.`);
  if (!Array.isArray(tiles)) return issue('tiles must be a list.');
  const count = (width / tileWidth) * (height / tileHeight); const seen = new Set<number>(); const slots = activeSlots(terrainMode as TerrainMode);
  for (const tile of tiles) {
    if (!object(tile) || !integer(tile.id) || tile.id < 0 || tile.id >= count || seen.has(tile.id)) return issue(`Tile IDs must be unique and below ${count}.`);
    seen.add(tile.id);
    if ((tile.name !== undefined && !tileText(tile.name)) || (tile.type !== undefined && !tileText(tile.type))) return issue(`Tile ${tile.id}: name and type need 1..${MAX_TILE_TEXT} characters.`);
    if (tile.probability !== undefined && (typeof tile.probability !== 'number' || !Number.isFinite(tile.probability) || tile.probability < 0 || tile.probability > 1000)) return issue(`Tile ${tile.id}: probability must be in 0..1000.`);
    if (tile.collision !== undefined && (!Array.isArray(tile.collision) || tile.collision.length > 8 || !tile.collision.every(area => object(area) && integer(area.x) && integer(area.y) && integer(area.width) && integer(area.height) && area.x >= 0 && area.y >= 0 && area.width >= 1 && area.height >= 1 && area.x + area.width <= tileWidth && area.y + area.height <= tileHeight))) return issue(`Tile ${tile.id}: collision needs up to 8 rectangles inside the tile.`);
    if (tile.terrain !== undefined && (!Array.isArray(tile.terrain) || tile.terrain.length !== TERRAIN_SLOTS || !tile.terrain.every((value, slot) => integer(value) && value >= 0 && value <= terrains.length && (!value || slot === CENTER || slots.includes(slot))))) return issue(`Tile ${tile.id}: terrain needs ${TERRAIN_SLOTS} values in 0..${terrains.length}, set only on positions the ${terrainMode} mode reads.`);
  }
  return [];
}
/** Clears terrain values the mode ignores or whose terrain no longer exists; drops labels that end up empty. */
function cleanTile(tile: TileInfo, mode: TerrainMode, terrains: number): TileInfo {
  if (!tile.terrain) return tile;
  const slots = activeSlots(mode); const terrain = tile.terrain.map((value, slot) => value <= terrains && (slot === CENTER || slots.includes(slot)) ? value : 0);
  const { terrain: _old, ...rest } = tile;
  return terrain.some(Boolean) ? { ...rest, terrain } : rest;
}

const normalizeTag = (tag: AnimationTagInput): AnimationTag => ({ name: tag.name, from: tag.from, to: tag.to, direction: tag.direction ?? 'forward', loop: tag.loop ?? true });

/** Pixelorama's rule: a frame inserted inside a tag or directly after its last frame extends it; earlier frames shift it. */
export function insertFrameIntoTags(tags: AnimationTag[], index: number): AnimationTag[] {
  return tags.map(tag => index > tag.from && index <= tag.to + 1 ? { ...tag, to: tag.to + 1 } : index <= tag.from ? { ...tag, from: tag.from + 1, to: tag.to + 1 } : tag);
}

/** Removing a frame shrinks the tags containing it; a tag that loses its only frame disappears. */
export function removeFrameFromTags(tags: AnimationTag[], index: number): AnimationTag[] {
  return tags.flatMap(tag => index < tag.from ? [{ ...tag, from: tag.from - 1, to: tag.to - 1 }] : index > tag.to ? [tag] : tag.from === tag.to ? [] : [{ ...tag, to: tag.to - 1 }]);
}

function compositeIndices(doc: PixelDocument, frame: PixelFrame): Uint8Array {
  const result = new Uint8Array(doc.width * doc.height);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const pixels = frame.cels[layer.id];
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] !== 0) result[i] = pixels[i];
    }
  }
  return result;
}

function renderUnchecked(doc: PixelDocument, frame: PixelFrame): Uint8Array {
  const result = new Uint8Array(doc.width * doc.height * 4);
  const pixels = new Uint32Array(result.buffer);
  const paletteBytes = new Uint8Array(doc.palette.length * 4);
  for (let i = 1; i < doc.palette.length; i++) {
    const color = doc.palette[i];
    paletteBytes[i * 4] = parseInt(color.slice(1, 3), 16);
    paletteBytes[i * 4 + 1] = parseInt(color.slice(3, 5), 16);
    paletteBytes[i * 4 + 2] = parseInt(color.slice(5, 7), 16);
    paletteBytes[i * 4 + 3] = 255;
  }
  const palette = new Uint32Array(paletteBytes.buffer);
  const indices = compositeIndices(doc, frame);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== 0) pixels[i] = palette[indices[i]];
  }
  return result;
}

function validateStructure(doc: PixelDocument): ValidationReport {
  const issues: Issue[] = [];
  const error = (code: string, message: string, ids: { layerId?: string; frameId?: string } = {}) => issues.push({ code, severity: 'error', message, ...(ids.layerId ? { layerId: ids.layerId } : {}), ...(ids.frameId ? { frameId: ids.frameId } : {}) });
  const report: ValidationReport = { valid: false, issues, colorCount: 0, opaquePixels: 0, boundingBox: null, isolatedPixels: 0 };
  if (!object(doc)) { error('INVALID_DOCUMENT', 'Document must be an object.'); return report; }
  if (doc.schemaVersion !== 2) error('INVALID_SCHEMA', 'schemaVersion must be 2.');
  if (!integer(doc.width) || doc.width < 1 || !integer(doc.height) || doc.height < 1 || !integer(doc.width * doc.height)) error('INVALID_SIZE', 'Canvas dimensions and pixel count must be positive safe integers.');
  if (!integer(doc.maxColors) || doc.maxColors < 1 || doc.maxColors > 32) error('INVALID_COLOR_LIMIT', 'maxColors must be an integer in 1..32.');
  issues.push(...paletteIssues(doc.palette, integer(doc.maxColors) ? doc.maxColors : 32));
  if (typeof doc.paletteLocked !== 'boolean') error('INVALID_DOCUMENT', 'paletteLocked must be boolean.');
  if (!object(doc.pivot) || typeof doc.pivot.x !== 'number' || !Number.isFinite(doc.pivot.x) || doc.pivot.x < 0 || doc.pivot.x > doc.width || typeof doc.pivot.y !== 'number' || !Number.isFinite(doc.pivot.y) || doc.pivot.y < 0 || doc.pivot.y > doc.height) error('INVALID_PIVOT', 'Pivot must use pixel coordinates inside the canvas edges.');
  if (!Array.isArray(doc.layers) || doc.layers.length < 1 || doc.layers.length > MAX_LAYERS) {
    error('INVALID_LAYERS', `Document must contain 1..${MAX_LAYERS} layers.`);
    return report;
  }
  const ids = new Set<string>();
  for (const layer of doc.layers) {
    if (!object(layer)) { error('INVALID_LAYER', 'Each layer must be an object.'); continue; }
    if (!identifier(layer.id) || ids.has(layer.id)) error('INVALID_LAYER_ID', 'Layer IDs must be unique identifiers.');
    else ids.add(layer.id);
    if (!name(layer.name) || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') error('INVALID_LAYER', 'Layer name, visibility or lock is invalid.', { layerId: layer.id });
  }
  if (!Array.isArray(doc.frames) || doc.frames.length < 1 || doc.frames.length > MAX_FRAMES) {
    error('INVALID_FRAMES', `Document must contain 1..${MAX_FRAMES} frames.`);
    return report;
  }
  const frameIds = new Set<string>();
  for (const frame of doc.frames) {
    if (!object(frame)) { error('INVALID_FRAME', 'Each frame must be an object.'); continue; }
    if (!identifier(frame.id) || frameIds.has(frame.id)) error('INVALID_FRAME_ID', 'Frame IDs must be unique identifiers.');
    else frameIds.add(frame.id);
    if (!duration(frame.durationMs)) error('INVALID_DURATION', `Frame duration must be an integer in ${MIN_FRAME_MS}..${MAX_FRAME_MS} ms.`, { frameId: frame.id });
    if (!object(frame.cels) || Object.keys(frame.cels).length !== ids.size || Object.keys(frame.cels).some(id => !ids.has(id))) {
      error('INVALID_CELS', 'Each frame needs exactly one raster per layer.', { frameId: frame.id });
      continue;
    }
    for (const id of ids) {
      const pixels = frame.cels[id];
      let pixelsValid = Array.isArray(pixels) && pixels.length === doc.width * doc.height && Array.isArray(doc.palette);
      if (pixelsValid) for (let i = 0; i < pixels.length; i++) {
        const pixel = pixels[i];
        if (!integer(pixel) || pixel < 0 || pixel >= doc.palette.length) { pixelsValid = false; break; }
      }
      if (!pixelsValid) error('INVALID_PIXELS', 'Pixels must contain exactly one valid palette index per canvas cell.', { layerId: id, frameId: frame.id });
    }
  }
  issues.push(...tagIssues(doc.tags, doc.frames.length));
  if (doc.tileset !== undefined) issues.push(...tilesetIssues(doc.tileset, doc.width, doc.height));
  if (Array.isArray(doc.tags) && doc.tags.some(tag => object(tag) && (!TAG_DIRECTIONS.includes(tag.direction) || typeof tag.loop !== 'boolean'))) error('INVALID_TAGS', 'Stored tags need a direction and loop flag.');
  report.valid = !issues.some(issue => issue.severity === 'error');
  return report;
}

export function validateDocument(doc: PixelDocument): ValidationReport {
  const report = validateStructure(doc);
  if (!report.valid) return report;
  const colors = new Uint8Array(doc.palette.length); const frames: FrameReport[] = [];
  let x0 = doc.width; let y0 = doc.height; let x1 = -1; let y1 = -1;
  for (const frame of doc.frames) {
    const indices = compositeIndices(doc, frame);
    let opaque = 0; let fx0 = doc.width; let fy0 = doc.height; let fx1 = -1; let fy1 = -1;
    for (let i = 0; i < indices.length; i++) {
      if (!indices[i]) continue;
      opaque++; colors[indices[i]] = 1;
      const x = i % doc.width; const y = Math.floor(i / doc.width);
      fx0 = Math.min(fx0, x); fy0 = Math.min(fy0, y); fx1 = Math.max(fx1, x); fy1 = Math.max(fy1, y);
      let neighbor = false;
      for (let dy = -1; dy <= 1 && !neighbor; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && x + dx < doc.width && y + dy >= 0 && y + dy < doc.height && indices[(y + dy) * doc.width + x + dx]) { neighbor = true; break; }
      }
      if (!neighbor) report.isolatedPixels++;
    }
    report.opaquePixels += opaque;
    frames.push({ frameId: frame.id, opaquePixels: opaque, boundingBox: fx1 < 0 ? null : { x: fx0, y: fy0, width: fx1 - fx0 + 1, height: fy1 - fy0 + 1 } });
    if (fx1 >= 0) { x0 = Math.min(x0, fx0); y0 = Math.min(y0, fy0); x1 = Math.max(x1, fx1); y1 = Math.max(y1, fy1); }
  }
  report.colorCount = colors.reduce((count, used) => count + used, 0);
  report.boundingBox = x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  report.frames = frames;
  if (!report.opaquePixels) report.issues.push({ code: 'EMPTY_ASSET', severity: 'warning', message: 'Asset has no visible pixels.' });
  else for (const frame of frames) {
    if (!frame.opaquePixels) report.issues.push({ code: 'EMPTY_FRAME', severity: 'warning', message: `Frame ${frame.frameId} has no visible pixels.`, frameId: frame.frameId });
  }
  if (report.isolatedPixels && !doc.tileset) report.issues.push({ code: 'ISOLATED_PIXELS', severity: 'warning', message: `${report.isolatedPixels} visible pixels have no opaque neighbor.` });
  if (doc.tileset) {
    const used = new Set(doc.tileset.tiles.flatMap(tile => tile.terrain ?? []).filter(Boolean));
    for (const terrain of [...used].sort((a, b) => a - b)) {
      const missing = missingCombinations(doc.tileset, terrain).length;
      if (missing) report.issues.push({ code: 'TERRAIN_INCOMPLETE', severity: 'warning', message: `Terrain ${doc.tileset.terrains[terrain - 1].name}: ${missing} ${doc.tileset.terrainMode} combinations against empty cells have no labeled tile.` });
    }
  }
  return report;
}

function assertDocument(doc: PixelDocument): void {
  const report = validateStructure(doc);
  const error = report.issues.find(issue => issue.severity === 'error');
  if (error) fail(error.code, error.message);
}

/** Lifts a document stored before animation support into the frame model without changing a pixel. */
export function upgradeDocument(doc: PixelDocument | LegacyPixelDocument): PixelDocument {
  if (!object(doc) || doc.schemaVersion !== 1 || !Array.isArray(doc.layers) || !doc.layers.every(object)) return doc as PixelDocument;
  const { layers, ...rest } = doc;
  return {
    ...rest, schemaVersion: 2,
    layers: layers.map(({ pixels: _pixels, ...layer }) => layer),
    frames: [{ id: FIRST_FRAME_ID, durationMs: DEFAULT_FRAME_MS, cels: Object.fromEntries(layers.map(layer => [layer.id, layer.pixels])) }],
    tags: [],
  };
}

export function createDocument(input: {
  width: number; height: number; palette?: string[]; maxColors?: number; paletteLocked?: boolean;
  layers?: { id: string; name: string }[]; pivot?: { x: number; y: number };
  frames?: { id: string; durationMs?: number }[]; tags?: AnimationTagInput[]; tileSize?: { width: number; height: number };
}): PixelDocument {
  requireValue(object(input), 'INVALID_DOCUMENT', 'Document options must be an object.');
  requireValue(integer(input.width) && input.width >= 1 && integer(input.height) && input.height >= 1 && integer(input.width * input.height), 'INVALID_SIZE', 'Canvas dimensions and pixel count must be positive safe integers.');
  const palette = input.palette ?? DEFAULT_PALETTE;
  requireValue(Array.isArray(palette), 'INVALID_PALETTE', 'Palette must be an array.');
  const layerOptions = input.layers ?? [{ id: 'base', name: 'Base' }];
  requireValue(Array.isArray(layerOptions) && layerOptions.length >= 1 && layerOptions.length <= MAX_LAYERS, 'INVALID_LAYERS', 'Invalid layer list.');
  requireValue(Array.from(layerOptions).every(layer => object(layer)), 'INVALID_LAYER', 'Layer options must be objects.');
  const frameOptions = input.frames ?? [{ id: FIRST_FRAME_ID }];
  requireValue(Array.isArray(frameOptions) && frameOptions.length >= 1 && frameOptions.length <= MAX_FRAMES && Array.from(frameOptions).every(frame => object(frame)), 'INVALID_FRAMES', `Documents need 1..${MAX_FRAMES} frame objects.`);
  const tags = input.tags ?? [];
  const issues = tagIssues(tags, frameOptions.length);
  requireValue(!issues.length, 'INVALID_TAGS', issues[0]?.message ?? 'Invalid tags.');
  const cells = input.width * input.height;
  const doc: PixelDocument = {
    schemaVersion: 2, width: input.width, height: input.height,
    palette: [...palette], maxColors: input.maxColors ?? palette.length - 1, paletteLocked: input.paletteLocked ?? false,
    layers: layerOptions.map(layer => ({ id: layer.id, name: layer.name, visible: true, locked: false })),
    frames: frameOptions.map(frame => ({ id: frame.id, durationMs: frame.durationMs ?? DEFAULT_FRAME_MS, cels: Object.fromEntries(layerOptions.map(layer => [layer.id, new Array(cells).fill(0)])) })),
    tags: tags.map(normalizeTag),
    pivot: input.pivot ? { ...input.pivot } : { x: input.width / 2, y: input.height / 2 },
    ...(input.tileSize ? { tileset: { tileWidth: input.tileSize.width, tileHeight: input.tileSize.height, terrainMode: 'mixed' as const, terrains: [], tiles: [] } } : {}),
  };
  assertDocument(doc);
  return doc;
}

/** The requested frame, or the first frame when no ID is given. */
export function getFrame(doc: PixelDocument, frameId?: string): PixelFrame {
  const frame = frameId === undefined ? doc.frames[0] : doc.frames.find(item => item.id === frameId);
  requireValue(frame, 'UNKNOWN_FRAME', `Unknown frame: ${frameId}.`);
  return frame;
}

/** One frame with its rasters attached to the layers; shares the document's arrays. */
export function frameView(doc: PixelDocument, frameId?: string): FrameView {
  const frame = getFrame(doc, frameId);
  return { width: doc.width, height: doc.height, palette: doc.palette, layers: doc.layers.map(layer => ({ ...layer, pixels: frame.cels[layer.id] })) };
}

export function composite(doc: PixelDocument, frameId?: string): Uint8Array {
  assertDocument(doc);
  return renderUnchecked(doc, getFrame(doc, frameId));
}

/** Palette indices of one layer, or of the visible composite when no layer is given. */
export function readIndices(doc: PixelDocument, layerId?: string, frameId?: string): ArrayLike<number> {
  assertDocument(doc);
  const frame = getFrame(doc, frameId);
  if (layerId === undefined) return compositeIndices(doc, frame);
  requireValue(doc.layers.some(item => item.id === layerId), 'UNKNOWN_LAYER', `Unknown layer: ${layerId}.`);
  return frame.cels[layerId];
}

type AppliedOperations = {
  document: PixelDocument; diff: PixelDiff; validation: ValidationReport;
};
type Raster = { pixels: number[]; frame: PixelFrame };

export function applyOperations(original: PixelDocument, operations: Operation[], editScope: EditScope): AppliedOperations {
  return editDocument(original, operations, editScope, false);
}

export function previewOperations(original: PixelDocument, operations: Operation[], editScope: EditScope): PixelDocument {
  return editDocument(original, operations, editScope, true);
}

function editDocument(original: PixelDocument, operations: Operation[], editScope: EditScope, preview: true): PixelDocument;
function editDocument(original: PixelDocument, operations: Operation[], editScope: EditScope, preview: false): AppliedOperations;
function editDocument(original: PixelDocument, operations: Operation[], editScope: EditScope, preview: boolean): PixelDocument | AppliedOperations {
  assertDocument(original);
  requireValue(Array.isArray(operations) && operations.length >= 1 && operations.length <= MAX_OPERATIONS, 'INVALID_BATCH', `A batch must contain 1..${MAX_OPERATIONS} operations.`);
  requireValue(object(editScope) && Array.isArray(editScope.layerIds) && editScope.layerIds.length > 0 && editScope.layerIds.length <= MAX_LAYERS && Array.from(editScope.layerIds).every(identifier) && new Set(editScope.layerIds).size === editScope.layerIds.length, 'INVALID_SCOPE', 'Scope must contain unique layer IDs.');
  requireValue(editScope.frameIds === undefined || (Array.isArray(editScope.frameIds) && editScope.frameIds.length > 0 && editScope.frameIds.length <= MAX_FRAMES && Array.from(editScope.frameIds).every(identifier) && new Set(editScope.frameIds).size === editScope.frameIds.length), 'INVALID_SCOPE', 'frameIds must contain unique frame IDs.');
  requireValue(editScope.allowLayerChanges === undefined || typeof editScope.allowLayerChanges === 'boolean', 'INVALID_SCOPE', 'allowLayerChanges must be boolean.');
  requireValue(editScope.allowPaletteChanges === undefined || typeof editScope.allowPaletteChanges === 'boolean', 'INVALID_SCOPE', 'allowPaletteChanges must be boolean.');
  requireValue(editScope.allowFrameChanges === undefined || typeof editScope.allowFrameChanges === 'boolean', 'INVALID_SCOPE', 'allowFrameChanges must be boolean.');
  const doc: PixelDocument = {
    ...original, palette: [...original.palette], pivot: { ...original.pivot },
    layers: original.layers.map(layer => ({ ...layer })),
    frames: original.frames.map(frame => ({ ...frame, cels: Object.fromEntries(Object.entries(frame.cels).map(([id, pixels]) => [id, pixels.slice()])) })),
    tags: original.tags.map(tag => ({ ...tag })),
    ...(original.tileset ? { tileset: structuredClone(original.tileset) } : {}),
  };
  // resize_canvas replaces both for the rest of the batch.
  let cells = doc.width * doc.height;
  let canvas: Rect = { x: 0, y: 0, width: doc.width, height: doc.height };
  const rect = (value: unknown): Rect => {
    requireValue(object(value) && integer(value.x) && integer(value.y) && integer(value.width) && integer(value.height) && value.width >= 1 && value.height >= 1 && value.x >= 0 && value.y >= 0 && value.x + value.width <= doc.width && value.y + value.height <= doc.height, 'INVALID_RECT', 'Rectangle must have positive integer dimensions inside the canvas.');
    return value as unknown as Rect;
  };
  const scopeRect = editScope.rect === undefined ? undefined : rect(editScope.rect);
  requireValue(editScope.mask === undefined || (scopeRect && Array.isArray(editScope.mask) && editScope.mask.length === scopeRect.height && editScope.mask.every(row => typeof row === 'string' && row.length === scopeRect.width && /^[.#]+$/.test(row))), 'INVALID_SCOPE', 'mask needs rect and one row of # (writable) and . (protected) per rect row.');
  const scopeMask = editScope.mask;
  const writable = (x: number, y: number) => !scopeRect || (inside(scopeRect, x, y) && (!scopeMask || scopeMask[y - scopeRect.y][x - scopeRect.x] === '#'));
  const allowedLayers = new Set(editScope.layerIds);
  requireValue(editScope.layerIds.every(id => doc.layers.some(layer => layer.id === id)), 'INVALID_SCOPE', 'Scope contains an unknown layer.');
  const allowedFrames = editScope.frameIds === undefined ? null : new Set(editScope.frameIds);
  requireValue(editScope.frameIds?.every(id => doc.frames.some(frame => frame.id === id)) ?? true, 'INVALID_SCOPE', 'Scope contains an unknown frame.');
  const allLayers = () => doc.layers.every(layer => allowedLayers.has(layer.id));
  const allFrames = () => !allowedFrames || doc.frames.every(frame => allowedFrames.has(frame.id));
  const fullScope = !scopeRect && allLayers() && allFrames();
  const requireLayerChanges = () => requireValue(fullScope && editScope.allowLayerChanges === true, 'LAYER_CHANGE_FORBIDDEN', 'Layer and document metadata changes require full scope and allowLayerChanges.');
  const requireFrameChanges = () => requireValue(!scopeRect && allLayers() && editScope.allowFrameChanges === true, 'FRAME_CHANGE_FORBIDDEN', 'Frame, timing and tag changes require every layer in scope, no rect and allowFrameChanges.');
  const layerFor = (id: unknown, writable = true): PixelLayer => {
    requireValue(typeof id === 'string', 'INVALID_LAYER_ID', 'layerId must be a string.');
    const layer = doc.layers.find(layer => layer.id === id);
    requireValue(layer, 'UNKNOWN_LAYER', `Unknown layer: ${id}.`);
    requireValue(allowedLayers.has(id), 'SCOPE_VIOLATION', `Layer ${id} is outside the edit scope.`);
    if (writable) requireValue(!layer.locked, 'LAYER_LOCKED', `Layer ${id} is locked.`);
    return layer;
  };
  const frameFor = (value: unknown, writable = true): PixelFrame => {
    const id = value !== undefined ? value
      : editScope.frameIds?.length === 1 ? editScope.frameIds[0]
        : doc.frames.length === 1 ? doc.frames[0].id
          : fail('FRAME_REQUIRED', 'frameId is required when several frames are editable.');
    requireValue(typeof id === 'string', 'INVALID_FRAME_ID', 'frameId must be a string.');
    const frame = doc.frames.find(frame => frame.id === id);
    requireValue(frame, 'UNKNOWN_FRAME', `Unknown frame: ${id}.`);
    if (writable) requireValue(!allowedFrames || allowedFrames.has(id), 'SCOPE_VIOLATION', `Frame ${id} is outside the edit scope.`);
    return frame;
  };
  const raster = (layerId: unknown, frameId: unknown): Raster => {
    const layer = layerFor(layerId); const frame = frameFor(frameId);
    return { pixels: frame.cels[layer.id], frame };
  };
  const newFrameId = (id: unknown): string => {
    requireValue(identifier(id), 'INVALID_FRAME_ID', 'New frame needs a valid ID.');
    requireValue(doc.frames.length < MAX_FRAMES && !doc.frames.some(frame => frame.id === id), 'INVALID_FRAMES', 'Frame limit exceeded or ID already exists.');
    return id;
  };
  const insertionIndex = (value: unknown, fallback: number): number => {
    const index = value === undefined ? fallback : value;
    requireValue(integer(index) && index >= 0 && index <= doc.frames.length, 'INVALID_FRAMES', `Frame index must be in 0..${doc.frames.length}.`);
    return index;
  };
  const insertFrame = (index: number, frame: PixelFrame) => {
    doc.frames.splice(index, 0, frame);
    doc.tags = insertFrameIntoTags(doc.tags, index);
    allowedFrames?.add(frame.id);
  };
  const requireTileset = (): Tileset => { requireValue(doc.tileset, 'NO_TILESET', 'This asset has no tile grid; set one with the tileset operation.'); return doc.tileset; };
  const color = (value: unknown): number => {
    requireValue(integer(value) && value >= 0 && value < doc.palette.length, 'INVALID_COLOR', 'Color must be an existing palette index.');
    return value;
  };
  const coordinate = (value: unknown): number => {
    requireValue(integer(value), 'INVALID_COORDINATE', 'Coordinates must be safe integers.');
    return value;
  };
  const write = (target: Raster, x: number, y: number, value: number) => {
    if (!inside(canvas, x, y)) {
      if (value !== 0) fail('OUT_OF_BOUNDS', 'Operation would clip an opaque pixel.');
      return;
    }
    const index = y * doc.width + x;
    if (target.pixels[index] === value) return;
    requireValue(writable(x, y), 'SCOPE_VIOLATION', 'Operation changes pixels outside the edit rectangle or mask.');
    target.pixels[index] = value;
  };
  const line = (target: Raster, x1: number, y1: number, x2: number, y2: number, value: number) => {
    requireValue(inside(canvas, x1, y1) && inside(canvas, x2, y2), 'OUT_OF_BOUNDS', 'Line endpoints must be inside the canvas.');
    const dx = Math.abs(x2 - x1); const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1; const sy = y1 < y2 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      write(target, x1, y1, value);
      if (x1 === x2 && y1 === y2) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x1 += sx; }
      if (twice <= dx) { error += dx; y1 += sy; }
    }
  };

  for (const operation of operations) {
    requireValue(object(operation) && typeof operation.op === 'string', 'INVALID_OPERATION', 'Operation must be a named object.');
    switch (operation.op) {
      case 'pixels': {
        const target = raster(operation.layerId, operation.frameId);
        requireValue(Array.isArray(operation.points) && operation.points.length > 0, 'INVALID_POINTS', 'Pixel batches must contain at least one point.');
        for (const point of operation.points) {
          requireValue(Array.isArray(point) && point.length === 3, 'INVALID_POINTS', 'A pixel point must contain x, y, color.');
          write(target, coordinate(point[0]), coordinate(point[1]), color(point[2]));
        }
        break;
      }
      case 'patch': {
        const target = raster(operation.layerId, operation.frameId);
        const area = rect(operation);
        requireValue(Array.isArray(operation.pixels) && operation.pixels.length === area.width * area.height, 'INVALID_PATCH', 'Patch pixels must match its dimensions.');
        for (let i = 0; i < operation.pixels.length; i++) write(target, area.x + i % area.width, area.y + Math.floor(i / area.width), color(operation.pixels[i]));
        break;
      }
      case 'rows': {
        const target = raster(operation.layerId, operation.frameId);
        requireValue(operation.mode === undefined || operation.mode === 'replace' || operation.mode === 'over', 'INVALID_OPERATION', 'Rows mode must be replace or over.');
        requireValue(Array.isArray(operation.rows) && operation.rows.length > 0 && Array.from(operation.rows).every(row => typeof row === 'string' && row.length > 0 && row.length === operation.rows[0].length), 'INVALID_ROWS', 'Rows must be non-empty strings of equal length.');
        const area = rect({ x: operation.x, y: operation.y, width: operation.rows[0].length, height: operation.rows.length });
        for (let y = 0; y < area.height; y++) for (let x = 0; x < area.width; x++) {
          const symbol = operation.rows[y][x]; const value = rowIndex(symbol);
          requireValue(value >= 0, 'INVALID_ROWS', `Unknown row symbol "${symbol}". Use . for transparent and 1-9, a-w for palette indices 1-32.`);
          if (operation.mode === 'over' && value === 0) continue;
          write(target, area.x + x, area.y + y, color(value));
        }
        break;
      }
      case 'line': {
        line(raster(operation.layerId, operation.frameId), coordinate(operation.x1), coordinate(operation.y1), coordinate(operation.x2), coordinate(operation.y2), color(operation.color));
        break;
      }
      case 'rect': case 'ellipse': {
        const target = raster(operation.layerId, operation.frameId); const area = rect(operation); const value = color(operation.color);
        requireValue(operation.filled === undefined || typeof operation.filled === 'boolean', 'INVALID_OPERATION', 'filled must be boolean.');
        const filled = operation.filled ?? true;
        const ellipseInside = (x: number, y: number) => {
          const dx = 2 * x + 1 - area.width; const dy = 2 * y + 1 - area.height;
          return dx * dx * area.height * area.height + dy * dy * area.width * area.width <= area.width * area.width * area.height * area.height;
        };
        for (let y = 0; y < area.height; y++) for (let x = 0; x < area.width; x++) {
          const selected = operation.op === 'rect'
            ? filled || x === 0 || y === 0 || x === area.width - 1 || y === area.height - 1
            : ellipseInside(x, y) && (filled || !ellipseInside(x - 1, y) || !ellipseInside(x + 1, y) || !ellipseInside(x, y - 1) || !ellipseInside(x, y + 1));
          if (selected) write(target, area.x + x, area.y + y, value);
        }
        break;
      }
      case 'polygon': {
        const target = raster(operation.layerId, operation.frameId); const value = color(operation.color);
        requireValue(operation.filled === undefined || typeof operation.filled === 'boolean', 'INVALID_OPERATION', 'filled must be boolean.');
        requireValue(Array.isArray(operation.points) && operation.points.length >= 3 && operation.points.length <= 128, 'INVALID_POINTS', 'Polygons need 3..128 vertices.');
        const points = Array.from(operation.points, point => {
          requireValue(Array.isArray(point) && point.length === 2, 'INVALID_POINTS', 'A polygon vertex must contain x, y.');
          const x = coordinate(point[0]); const y = coordinate(point[1]);
          requireValue(inside(canvas, x, y), 'OUT_OF_BOUNDS', 'Polygon vertices must be inside the canvas.');
          return [x, y];
        });
        const minX = Math.min(...points.map(point => point[0])); const maxX = Math.max(...points.map(point => point[0]));
        const minY = Math.min(...points.map(point => point[1])); const maxY = Math.max(...points.map(point => point[1]));
        if (operation.filled !== false) for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          let selected = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i]; const [xj, yj] = points[j];
            if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) selected = !selected;
          }
          if (selected) write(target, x, y, value);
        }
        for (let i = 0; i < points.length; i++) {
          const next = points[(i + 1) % points.length];
          line(target, points[i][0], points[i][1], next[0], next[1], value);
        }
        break;
      }
      case 'fill': {
        const target = raster(operation.layerId, operation.frameId); const value = color(operation.color);
        requireValue(operation.reference === undefined || operation.reference === 'layer' || operation.reference === 'composite', 'INVALID_OPERATION', 'Fill reference must be layer or composite.');
        requireValue(operation.contiguous === undefined || typeof operation.contiguous === 'boolean', 'INVALID_OPERATION', 'contiguous must be boolean.');
        const x = coordinate(operation.x); const y = coordinate(operation.y);
        requireValue(inside(canvas, x, y), 'OUT_OF_BOUNDS', 'Fill start must be inside the canvas.');
        requireValue(writable(x, y), 'SCOPE_VIOLATION', 'Fill start must be inside the edit rectangle or mask.');
        const source = operation.reference === 'composite' ? compositeIndices(doc, target.frame) : target.pixels;
        const from = source[y * doc.width + x];
        if (from === value && operation.reference !== 'composite') break;
        if (operation.contiguous === false) {
          const area = scopeRect ?? canvas;
          for (let py = area.y; py < area.y + area.height; py++) for (let px = area.x; px < area.x + area.width; px++) {
            if (source[py * doc.width + px] === from && writable(px, py)) write(target, px, py, value);
          }
          break;
        }
        const area = scopeRect ?? canvas;
        const queue: number[] = [];
        const seen = operation.reference === 'composite' ? new Uint8Array(source.length) : undefined;
        const enqueue = (position: number) => {
          if (source[position] !== from || seen?.[position] || !writable(position % doc.width, Math.floor(position / doc.width))) return;
          if (seen) seen[position] = 1;
          write(target, position % doc.width, Math.floor(position / doc.width), value);
          queue.push(position);
        };
        enqueue(y * doc.width + x);
        for (let i = 0; i < queue.length; i++) {
          const position = queue[i]; const px = position % doc.width; const py = Math.floor(position / doc.width);
          if (px > area.x) enqueue(position - 1);
          if (px + 1 < area.x + area.width) enqueue(position + 1);
          if (py > area.y) enqueue(position - doc.width);
          if (py + 1 < area.y + area.height) enqueue(position + doc.width);
        }
        break;
      }
      case 'move': case 'copy': case 'flip': case 'rotate': {
        const target = raster(operation.layerId, operation.frameId); const area = operation.rect === undefined ? canvas : rect(operation.rect);
        const source = target.pixels.slice();
        let dx = 0; let dy = 0;
        if (operation.op === 'move' || operation.op === 'copy') { dx = coordinate(operation.dx); dy = coordinate(operation.dy); }
        if (operation.op === 'flip') requireValue(operation.axis === 'x' || operation.axis === 'y', 'INVALID_OPERATION', 'Flip axis must be x or y.');
        if (operation.op === 'rotate') requireValue(operation.turns === 1 || operation.turns === 2 || operation.turns === 3, 'INVALID_OPERATION', 'Rotation turns must be 1, 2 or 3 clockwise quarter turns.');
        if (operation.op !== 'copy') for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) write(target, x, y, 0);
        for (let y = 0; y < area.height; y++) for (let x = 0; x < area.width; x++) {
          let tx = x + dx; let ty = y + dy;
          if (operation.op === 'flip') { tx = operation.axis === 'x' ? area.width - 1 - x : x; ty = operation.axis === 'y' ? area.height - 1 - y : y; }
          if (operation.op === 'rotate') {
            if (operation.turns === 1) { tx = area.height - 1 - y; ty = x; }
            if (operation.turns === 2) { tx = area.width - 1 - x; ty = area.height - 1 - y; }
            if (operation.turns === 3) { tx = y; ty = area.width - 1 - x; }
          }
          write(target, area.x + tx, area.y + ty, source[(area.y + y) * doc.width + area.x + x]);
        }
        break;
      }
      case 'stamp': {
        const target = raster(operation.layerId, operation.frameId);
        requireValue(operation.mode === undefined || operation.mode === 'over' || operation.mode === 'replace', 'INVALID_OPERATION', 'Stamp mode must be over or replace.');
        // Reading another layer or frame does not need write scope, like a composite fill reference.
        const sourceLayerId = operation.sourceLayerId ?? operation.layerId;
        requireValue(doc.layers.some(layer => layer.id === sourceLayerId), 'UNKNOWN_LAYER', `Unknown layer: ${sourceLayerId}.`);
        const sourceFrame = operation.sourceFrameId === undefined ? target.frame : frameFor(operation.sourceFrameId, false);
        const area = operation.rect === undefined ? canvas : rect(operation.rect);
        const dx = coordinate(operation.dx ?? 0); const dy = coordinate(operation.dy ?? 0);
        const source = sourceFrame.cels[sourceLayerId].slice();
        for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) {
          const value = source[y * doc.width + x];
          if (operation.mode !== 'replace' && value === 0) continue;
          write(target, x + dx, y + dy, value);
        }
        break;
      }
      case 'replace': {
        const target = raster(operation.layerId, operation.frameId); const from = color(operation.from); const to = color(operation.to);
        const area = operation.rect === undefined ? scopeRect ?? canvas : rect(operation.rect);
        for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) {
          if (target.pixels[y * doc.width + x] === from && writable(x, y)) write(target, x, y, to);
        }
        break;
      }
      case 'outline': {
        const target = raster(operation.layerId, operation.frameId); const value = color(operation.color);
        requireValue(value !== 0, 'INVALID_COLOR', 'Outline must use an opaque color.');
        requireValue(operation.reference === undefined || operation.reference === 'layer' || operation.reference === 'composite', 'INVALID_OPERATION', 'Outline reference must be layer or composite.');
        requireValue(operation.corners === undefined || typeof operation.corners === 'boolean', 'INVALID_OPERATION', 'corners must be boolean.');
        // The outline grows around the reference shape and stays inside the rect, edit rectangle and mask.
        const source = operation.reference === 'composite' ? compositeIndices(doc, target.frame) : target.pixels.slice();
        const area = operation.rect === undefined ? canvas : rect(operation.rect); const corners = operation.corners ?? true;
        for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) {
          if (source[y * doc.width + x] || target.pixels[y * doc.width + x] || !writable(x, y)) continue;
          let neighbor = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if ((corners || !dx || !dy) && inside(canvas, x + dx, y + dy) && source[(y + dy) * doc.width + x + dx]) neighbor = true;
          }
          if (neighbor) write(target, x, y, value);
        }
        break;
      }
      case 'shift': {
        // Offsets with wrap-around, like an image offset filter, to bring tile edges into the middle.
        const target = raster(operation.layerId, operation.frameId); const area = operation.rect === undefined ? canvas : rect(operation.rect);
        const dx = coordinate(operation.dx); const dy = coordinate(operation.dy); const source = target.pixels.slice();
        const wrap = (value: number, size: number) => ((value % size) + size) % size;
        for (let y = 0; y < area.height; y++) for (let x = 0; x < area.width; x++) write(target, area.x + wrap(x + dx, area.width), area.y + wrap(y + dy, area.height), source[(area.y + y) * doc.width + area.x + x]);
        break;
      }
      case 'autotile': {
        requireLayerChanges(); const target = raster(operation.layerId, operation.frameId); const tileset = requireTileset();
        const template = operation.template;
        requireValue(template === 'blob' || template === 'edge' || template === 'corner', 'INVALID_OPERATION', 'Autotile template must be blob, edge or corner.');
        const { tileWidth: tw, tileHeight: th } = tileset;
        requireValue(!(tw % 2) && !(th % 2), 'TILE_SIZE', 'Autotiles are built from quarter tiles and need an even tile width and height.');
        const grid = tileGrid(tileset, doc.width, doc.height); const ox = coordinate(operation.x ?? 0); const oy = coordinate(operation.y ?? 0); const rows = templateRows(template);
        requireValue(ox >= 0 && oy >= 0 && ox + TEMPLATE_COLUMNS <= grid.columns && oy + rows <= grid.rows, 'TEMPLATE_DOES_NOT_FIT', `The ${template} template needs ${TEMPLATE_COLUMNS}×${rows} tiles starting at tile column ${ox}, row ${oy}; the grid has ${grid.columns}×${grid.rows}.`);
        const terrain = operation.terrain ?? 1;
        requireValue(integer(terrain) && terrain >= 1 && terrain <= MAX_TERRAINS, 'INVALID_TERRAIN', `terrain must be in 1..${MAX_TERRAINS}.`);
        const layout = autotileLayout(template);
        const read = (column: number, row: number) => {
          const pixels: number[] = [];
          for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) pixels.push(target.pixels[((oy + row) * th + y) * doc.width + (ox + column) * tw + x]);
          return pixels;
        };
        const keys = Object.fromEntries(layout.filter(cell => cell.key).map(cell => [cell.key, read(cell.column, cell.row)])) as Record<KeyTile, number[]>;
        keys.fill ??= keys.cross;
        for (const cell of layout) {
          if (cell.key) continue;
          const pixels = composeTile(keys, template, cell.mask!, tw, th);
          for (let i = 0; i < pixels.length; i++) write(target, (ox + cell.column) * tw + i % tw, (oy + cell.row) * th + Math.floor(i / tw), pixels[i]);
        }
        while (tileset.terrains.length < terrain) tileset.terrains.push({ name: `Terrain ${tileset.terrains.length + 1}`, color: TERRAIN_COLORS[tileset.terrains.length] });
        if (tileset.terrainMode !== TEMPLATE_MODE[template]) { tileset.terrainMode = TEMPLATE_MODE[template]; tileset.tiles = tileset.tiles.map(tile => cleanTile(tile, tileset.terrainMode, tileset.terrains.length)); }
        for (const cell of layout) {
          const id = (oy + cell.row) * grid.columns + ox + cell.column; const existing = tileset.tiles.find(tile => tile.id === id);
          const { terrain: _old, ...rest } = existing ?? { id };
          const next: TileInfo = cell.mask === null ? rest : { ...rest, terrain: wangOf(cell.mask, terrain) };
          tileset.tiles = [...tileset.tiles.filter(tile => tile.id !== id), ...(Object.keys(next).length > 1 ? [next] : [])];
        }
        tileset.tiles.sort((a, b) => a.id - b.id);
        break;
      }
      case 'tileset': {
        requireLayerChanges(); const current = doc.tileset;
        const tileWidth = operation.tileWidth ?? current?.tileWidth; const tileHeight = operation.tileHeight ?? current?.tileHeight;
        requireValue(integer(tileWidth) && tileWidth >= 1 && integer(tileHeight) && tileHeight >= 1, 'INVALID_TILESET', 'A new tile grid needs tileWidth and tileHeight.');
        requireValue(!(doc.width % tileWidth) && !(doc.height % tileHeight), 'TILE_GRID', `Canvas ${doc.width}×${doc.height} must be a multiple of the tile size ${tileWidth}×${tileHeight}.`);
        const terrainMode = operation.terrainMode ?? current?.terrainMode ?? 'mixed'; const terrains = operation.terrains ?? current?.terrains ?? [];
        requireValue(TERRAIN_MODES.includes(terrainMode), 'INVALID_TILESET', 'terrainMode must be corner, edge or mixed.');
        requireValue(Array.isArray(terrains) && terrains.length <= MAX_TERRAINS && terrains.every(terrain => object(terrain) && name(terrain.name) && typeof terrain.color === 'string' && /^#[0-9a-f]{6}$/i.test(terrain.color)), 'INVALID_TILESET', `Terrains need a name and #RRGGBB color; at most ${MAX_TERRAINS}.`);
        // Tile IDs depend on the grid, so a new tile size starts without per-tile metadata.
        const sameGrid = current && current.tileWidth === tileWidth && current.tileHeight === tileHeight;
        doc.tileset = { tileWidth, tileHeight, terrainMode, terrains: terrains.map(terrain => ({ name: terrain.name, color: terrain.color.toUpperCase() })), tiles: sameGrid ? current.tiles.map(tile => cleanTile(tile, terrainMode, terrains.length)) : [] };
        break;
      }
      case 'remove_tileset': {
        requireLayerChanges(); requireTileset(); delete doc.tileset;
        break;
      }
      case 'tile_properties': {
        requireLayerChanges(); const tileset = requireTileset(); const { count } = tileGrid(tileset, doc.width, doc.height);
        requireValue(Array.isArray(operation.tiles) && operation.tiles.length > 0, 'INVALID_TILE', 'tile_properties needs at least one tile.');
        for (const input of operation.tiles) {
          requireValue(object(input) && integer(input.id) && input.id >= 0 && input.id < count, 'INVALID_TILE', `Tile IDs must be in 0..${count - 1}.`);
          const next: Record<string, unknown> = { ...(tileset.tiles.find(tile => tile.id === input.id) ?? { id: input.id }) };
          for (const key of ['name', 'type', 'probability', 'collision', 'terrain'] as const) {
            if (input[key] === null) delete next[key];
            else if (input[key] !== undefined) next[key] = structuredClone(input[key]);
          }
          tileset.tiles = [...tileset.tiles.filter(tile => tile.id !== input.id), ...(Object.keys(next).length > 1 ? [next as unknown as TileInfo] : [])];
        }
        tileset.tiles.sort((a, b) => a.id - b.id);
        break;
      }
      case 'add_layer': {
        requireLayerChanges();
        requireValue(identifier(operation.id) && name(operation.name), 'INVALID_LAYER', 'New layer needs a valid ID and name.');
        requireValue(doc.layers.length < MAX_LAYERS && !doc.layers.some(layer => layer.id === operation.id), 'INVALID_LAYERS', 'Layer limit exceeded or ID already exists.');
        doc.layers.push({ id: operation.id, name: operation.name, visible: true, locked: false });
        for (const frame of doc.frames) frame.cels[operation.id] = new Array(cells).fill(0);
        allowedLayers.add(operation.id);
        break;
      }
      case 'duplicate_layer': {
        requireLayerChanges(); const source = layerFor(operation.layerId, false);
        requireValue(identifier(operation.id) && name(operation.name), 'INVALID_LAYER', 'New layer needs a valid ID and name.');
        requireValue(doc.layers.length < MAX_LAYERS && !doc.layers.some(layer => layer.id === operation.id), 'INVALID_LAYERS', 'Layer limit exceeded or ID already exists.');
        doc.layers.splice(doc.layers.indexOf(source) + 1, 0, { ...source, id: operation.id, name: operation.name });
        for (const frame of doc.frames) frame.cels[operation.id] = frame.cels[source.id].slice();
        allowedLayers.add(operation.id);
        break;
      }
      case 'remove_layer': {
        requireLayerChanges(); layerFor(operation.layerId);
        requireValue(doc.layers.length > 1, 'INVALID_LAYERS', 'Cannot remove the last layer.');
        doc.layers = doc.layers.filter(layer => layer.id !== operation.layerId);
        for (const frame of doc.frames) delete frame.cels[operation.layerId];
        break;
      }
      case 'update_layer': {
        requireLayerChanges(); const layer = layerFor(operation.layerId, false);
        if (operation.name !== undefined) { requireValue(name(operation.name), 'INVALID_LAYER', 'Invalid layer name.'); layer.name = operation.name; }
        if (operation.visible !== undefined) { requireValue(typeof operation.visible === 'boolean', 'INVALID_LAYER', 'visible must be boolean.'); layer.visible = operation.visible; }
        if (operation.locked !== undefined) { requireValue(typeof operation.locked === 'boolean', 'INVALID_LAYER', 'locked must be boolean.'); layer.locked = operation.locked; }
        break;
      }
      case 'reorder_layers': {
        requireLayerChanges();
        requireValue(Array.isArray(operation.layerIds) && operation.layerIds.length === doc.layers.length && new Set(operation.layerIds).size === doc.layers.length && operation.layerIds.every(id => doc.layers.some(layer => layer.id === id)), 'INVALID_LAYERS', 'Reorder must contain every layer exactly once.');
        doc.layers = operation.layerIds.map(id => doc.layers.find(layer => layer.id === id)!);
        break;
      }
      case 'merge_layers': {
        requireLayerChanges();
        requireValue(Array.isArray(operation.layerIds) && operation.layerIds.length >= 2 && new Set(operation.layerIds).size === operation.layerIds.length, 'INVALID_LAYERS', 'Merging needs at least two different layers.');
        const merged = operation.layerIds.map(id => layerFor(id));
        requireValue(merged.every(layer => layer.visible), 'INVALID_LAYERS', 'Only visible layers can be merged.');
        const positions = merged.map(layer => doc.layers.indexOf(layer)).sort((a, b) => a - b);
        // A visible layer between the merged ones would change the rendered image once its neighbors collapse.
        requireValue(doc.layers.slice(positions[0], positions.at(-1)! + 1).every(layer => !layer.visible || operation.layerIds.includes(layer.id)), 'INVALID_LAYERS', 'Visible layers between merged layers must be merged as well.');
        const target = doc.layers[positions[0]]; const sources = positions.slice(1).map(index => doc.layers[index]);
        for (const frame of doc.frames) {
          const pixels = frame.cels[target.id];
          for (const layer of sources) {
            const upper = frame.cels[layer.id];
            for (let i = 0; i < cells; i++) if (upper[i]) pixels[i] = upper[i];
            delete frame.cels[layer.id];
          }
        }
        doc.layers = doc.layers.filter(layer => !sources.includes(layer));
        break;
      }
      case 'resize_canvas': {
        requireLayerChanges();
        const width = operation.width; const height = operation.height;
        requireValue(integer(width) && width >= 1 && integer(height) && height >= 1 && integer(width * height), 'INVALID_SIZE', 'Canvas dimensions and pixel count must be positive safe integers.');
        const dx = coordinate(operation.offsetX ?? 0); const dy = coordinate(operation.offsetY ?? 0);
        const target: Rect = { x: 0, y: 0, width, height };
        if (doc.tileset) {
          // Tile IDs follow the grid; whole-tile changes keep each tile's metadata with its pixels.
          const { tileWidth: tw, tileHeight: th } = doc.tileset;
          requireValue(!(width % tw) && !(height % th) && !(dx % tw) && !(dy % th), 'TILE_GRID', `With a ${tw}×${th} tile grid, size and offset must be multiples of the tile size. Remove the tile grid first for other sizes.`);
          const before = tileGrid(doc.tileset, doc.width, doc.height); const after = tileGrid(doc.tileset, width, height);
          doc.tileset.tiles = doc.tileset.tiles.flatMap(tile => {
            const column = tile.id % before.columns + dx / tw; const row = Math.floor(tile.id / before.columns) + dy / th;
            return column >= 0 && row >= 0 && column < after.columns && row < after.rows ? [{ ...tile, id: row * after.columns + column }] : [];
          }).sort((a, b) => a.id - b.id);
        }
        for (const frame of doc.frames) {
          for (const layer of doc.layers) {
            const source = frame.cels[layer.id]; const pixels = new Array(width * height).fill(0);
            for (let i = 0; i < source.length; i++) {
              if (!source[i]) continue;
              const x = i % doc.width + dx; const y = Math.floor(i / doc.width) + dy;
              if (inside(target, x, y)) pixels[y * width + x] = source[i];
              else requireValue(!layer.locked, 'LAYER_LOCKED', `Cropping would remove pixels of locked layer ${layer.id}.`);
            }
            frame.cels[layer.id] = pixels;
          }
        }
        doc.width = width; doc.height = height;
        doc.pivot = { x: Math.max(0, Math.min(width, doc.pivot.x + dx)), y: Math.max(0, Math.min(height, doc.pivot.y + dy)) };
        cells = width * height; canvas = target;
        break;
      }
      case 'add_frame': {
        requireFrameChanges();
        const id = newFrameId(operation.id); const index = insertionIndex(operation.index, doc.frames.length);
        requireValue(operation.durationMs === undefined || duration(operation.durationMs), 'INVALID_DURATION', `Frame duration must be an integer in ${MIN_FRAME_MS}..${MAX_FRAME_MS} ms.`);
        insertFrame(index, { id, durationMs: operation.durationMs ?? DEFAULT_FRAME_MS, cels: Object.fromEntries(doc.layers.map(layer => [layer.id, new Array(cells).fill(0)])) });
        break;
      }
      case 'duplicate_frame': {
        requireFrameChanges(); const source = frameFor(operation.frameId, false);
        const id = newFrameId(operation.id); const index = insertionIndex(operation.index, doc.frames.indexOf(source) + 1);
        insertFrame(index, { id, durationMs: source.durationMs, cels: Object.fromEntries(Object.entries(source.cels).map(([layerId, pixels]) => [layerId, pixels.slice()])) });
        break;
      }
      case 'remove_frame': {
        requireFrameChanges(); const frame = frameFor(operation.frameId);
        requireValue(doc.frames.length > 1, 'INVALID_FRAMES', 'Cannot remove the last frame.');
        const index = doc.frames.indexOf(frame);
        doc.frames.splice(index, 1);
        doc.tags = removeFrameFromTags(doc.tags, index);
        break;
      }
      case 'reorder_frames': {
        requireFrameChanges();
        requireValue(allFrames(), 'SCOPE_VIOLATION', 'Reordering frames requires every frame in scope.');
        requireValue(Array.isArray(operation.frameIds) && operation.frameIds.length === doc.frames.length && new Set(operation.frameIds).size === doc.frames.length && operation.frameIds.every(id => doc.frames.some(frame => frame.id === id)), 'INVALID_FRAMES', 'Reorder must contain every frame exactly once.');
        doc.frames = operation.frameIds.map(id => doc.frames.find(frame => frame.id === id)!);
        break;
      }
      case 'frame_duration': {
        requireFrameChanges();
        requireValue(Array.isArray(operation.frameIds) && operation.frameIds.length > 0 && new Set(operation.frameIds).size === operation.frameIds.length, 'INVALID_FRAMES', 'frameIds must list unique frames.');
        requireValue(duration(operation.durationMs), 'INVALID_DURATION', `Frame duration must be an integer in ${MIN_FRAME_MS}..${MAX_FRAME_MS} ms.`);
        for (const id of operation.frameIds) frameFor(id).durationMs = operation.durationMs;
        break;
      }
      case 'set_tags': {
        requireFrameChanges();
        const issues = tagIssues(operation.tags, doc.frames.length);
        requireValue(!issues.length, 'INVALID_TAGS', issues[0]?.message ?? 'Invalid tags.');
        doc.tags = operation.tags.map(normalizeTag);
        break;
      }
      case 'palette': {
        requireValue(fullScope && editScope.allowPaletteChanges === true, 'PALETTE_CHANGE_FORBIDDEN', 'Palette changes require full scope and allowPaletteChanges.');
        requireValue(!doc.paletteLocked, 'PALETTE_LOCKED', 'This asset palette is locked.');
        // maxColors raises or lowers the color budget; the new palette must fit it.
        const maxColors = operation.maxColors ?? doc.maxColors;
        requireValue(integer(maxColors) && maxColors >= 1 && maxColors <= 32, 'INVALID_COLOR_LIMIT', 'maxColors must be an integer in 1..32.');
        const issues = paletteIssues(operation.colors, maxColors);
        requireValue(!issues.length, 'INVALID_PALETTE', issues[0]?.message ?? 'Invalid palette.');
        requireValue(operation.remap === undefined || operation.remap === 'index' || operation.remap === 'nearest', 'INVALID_OPERATION', 'Palette remap must be index or nearest.');
        // index keeps every pixel's index; nearest moves each color to the closest color of the new palette.
        const mapping = doc.palette.map((hex, index) => operation.remap !== 'nearest' || index === 0 ? index : nearestColor(hex, operation.colors));
        for (const layer of doc.layers) {
          if (!layer.locked) continue;
          for (const frame of doc.frames) requireValue(frame.cels[layer.id].every(index => doc.palette[index].toUpperCase() === operation.colors[mapping[index]]?.toUpperCase()), 'LAYER_LOCKED', `Palette would change locked layer ${layer.id}.`);
        }
        if (operation.remap === 'nearest') for (const frame of doc.frames) for (const layer of doc.layers) frame.cels[layer.id] = frame.cels[layer.id].map(index => mapping[index]);
        doc.palette = [...operation.colors];
        doc.maxColors = maxColors;
        break;
      }
      case 'pivot': {
        requireLayerChanges();
        requireValue(typeof operation.x === 'number' && Number.isFinite(operation.x) && operation.x >= 0 && operation.x <= doc.width && typeof operation.y === 'number' && Number.isFinite(operation.y) && operation.y >= 0 && operation.y <= doc.height, 'INVALID_PIVOT', 'Pivot must lie within canvas edges.');
        doc.pivot = { x: operation.x, y: operation.y };
        break;
      }
      default: fail('UNKNOWN_OPERATION', `Unknown operation: ${(operation as { op: string }).op}.`);
    }
  }

  if (preview) {
    assertDocument(doc);
    return doc;
  }
  const validation = validateDocument(doc);
  requireValue(validation.valid, validation.issues[0]?.code ?? 'INVALID_DOCUMENT', validation.issues[0]?.message ?? 'Invalid operation result.');
  return { document: doc, diff: diffDocuments(original, doc, { layers: allowedLayers, frames: allowedFrames, writable }), validation };
}

/** Compares two valid documents and enforces that every changed pixel lies inside the write scope. */
function diffDocuments(original: PixelDocument, doc: PixelDocument, scope: { layers: Set<string>; frames: Set<string> | null; writable: (x: number, y: number) => boolean }): PixelDiff {
  const cells = doc.width * doc.height;
  if (original.width !== doc.width || original.height !== doc.height) {
    // A resized canvas was authorized by resize_canvas, which requires full scope; every remaining pixel counts as changed.
    return { changedPixels: cells * doc.frames.length, changedLayers: doc.layers.map(layer => layer.id), changedFrames: doc.frames.map(frame => frame.id), boundingBox: { x: 0, y: 0, width: doc.width, height: doc.height } };
  }
  const beforePalette = original.palette.map(color => color.toUpperCase()); const afterPalette = doc.palette.map(color => color.toUpperCase());
  const layerIds = [...new Set([...original.layers.map(layer => layer.id), ...doc.layers.map(layer => layer.id)])];
  const frameIds = [...new Set([...original.frames.map(frame => frame.id), ...doc.frames.map(frame => frame.id)])];
  const changedLayers = new Set<string>(); const changedFrames: string[] = [];
  for (const id of layerIds) {
    const oldLayer = original.layers.find(layer => layer.id === id); const newLayer = doc.layers.find(layer => layer.id === id);
    if (!oldLayer || !newLayer || oldLayer.name !== newLayer.name || oldLayer.visible !== newLayer.visible || oldLayer.locked !== newLayer.locked || original.layers.indexOf(oldLayer) !== doc.layers.indexOf(newLayer)) changedLayers.add(id);
  }
  const union = new Uint8Array(cells); const marks = new Uint8Array(cells);
  let changedPixels = 0;
  for (const frameId of frameIds) {
    const oldFrame = original.frames.find(frame => frame.id === frameId); const newFrame = doc.frames.find(frame => frame.id === frameId);
    // Added and removed frames were authorized by their structure operation; existing frames are checked pixel by pixel.
    const checked = !!oldFrame && !!newFrame;
    const writable = !scope.frames || scope.frames.has(frameId);
    let frameChanged = !checked || oldFrame.durationMs !== newFrame.durationMs || original.frames.indexOf(oldFrame) !== doc.frames.indexOf(newFrame);
    marks.fill(0);
    const before = oldFrame && compositeIndices(original, oldFrame); const after = newFrame && compositeIndices(doc, newFrame);
    for (let i = 0; i < cells; i++) {
      const a = before ? beforePalette[before[i]] : beforePalette[0]; const b = after ? afterPalette[after[i]] : afterPalette[0];
      if (a === b) continue;
      if (checked) requireValue(writable && scope.writable(i % doc.width, Math.floor(i / doc.width)), 'SCOPE_VIOLATION', 'Rendered pixels changed outside the edit scope.');
      marks[i] = 1;
    }
    for (const layerId of layerIds) {
      const oldPixels = oldFrame?.cels[layerId]; const newPixels = newFrame?.cels[layerId];
      for (let i = 0; i < cells; i++) {
        const a = oldPixels?.[i] ?? 0; const b = newPixels?.[i] ?? 0;
        if (a === b && original.palette[a] === doc.palette[b]) continue;
        changedLayers.add(layerId); marks[i] = 1;
        if (checked) requireValue(scope.layers.has(layerId) && writable && scope.writable(i % doc.width, Math.floor(i / doc.width)), 'SCOPE_VIOLATION', 'Stored pixels changed outside the edit scope.');
      }
    }
    for (let i = 0; i < cells; i++) if (marks[i]) { changedPixels++; union[i] = 1; frameChanged = true; }
    if (frameChanged) changedFrames.push(frameId);
  }
  let x0 = doc.width; let y0 = doc.height; let x1 = -1; let y1 = -1;
  for (let i = 0; i < cells; i++) if (union[i]) {
    const x = i % doc.width; const y = Math.floor(i / doc.width);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const boundingBox = x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  return { changedPixels, changedLayers: layerIds.filter(id => changedLayers.has(id)), changedFrames, boundingBox };
}
