import { PNG } from 'pngjs';
import { composite, createDocument, DEFAULT_FRAME_MS, MAX_FRAMES, readIndices } from './engine.js';
import { encodeGif } from './gif.js';
import { renderTerrainMap, terrainMap, tileGrid } from './tiles.js';
import type { TerrainMap } from './tiles.js';
import { AppError } from './errors.js';
import { framesFor, gifFrameIds, GUTTER_CANDIDATES, ONION_COLORS, sheetLayout } from './export-layout.js';
import type { SheetLayout, SheetOptions } from './export-layout.js';
export { framesFor, gifFrameIds, ONION_COLORS, sheetLayout } from './export-layout.js';
export type { SheetCell, SheetLayout, SheetOptions } from './export-layout.js';
import type { AnimationTag, PixelDocument } from './types.js';

const validScale = (scale: number) => {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new AppError('RENDER_SIZE', 'Zoom must be a whole number from 1 to 32.');
};

/** Copies an RGBA raster into the PNG at (left, top), enlarged by nearest neighbor. */
function blit(png: PNG, rgba: Uint8Array, width: number, height: number, scale: number, left = 0, top = 0) {
  for (let y = 0; y < height; y++) {
    const row = ((top + y * scale) * png.width + left) * 4;
    if (scale === 1) { png.data.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row); continue; }
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      for (let dx = 0; dx < scale; dx++) png.data.set(rgba.subarray(src, src + 4), row + (x * scale + dx) * 4);
    }
    for (let dy = 1; dy < scale; dy++) png.data.copyWithin(row + dy * png.width * 4, row, row + width * scale * 4);
  }
}

export function renderPng(document: PixelDocument, scale = 1, frameId?: string): Buffer {
  validScale(scale);
  const rgba = composite(document, frameId);
  const png = new PNG({ width: document.width * scale, height: document.height * scale });
  if (scale === 1) png.data.set(rgba);
  else blit(png, rgba, document.width, document.height, scale);
  return PNG.sync.write(png);
}

export function renderThumbnail(document: PixelDocument, maxSize = 96): Buffer {
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) throw new AppError('RENDER_SIZE', 'The preview size must be a positive whole number.');
  const rgba = composite(document);
  const factor = Math.min(1, maxSize / Math.max(document.width, document.height));
  const width = Math.max(1, Math.round(document.width * factor)); const height = Math.max(1, Math.round(document.height * factor));
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (Math.floor(y * document.height / height) * document.width + Math.floor(x * document.width / width)) * 4;
    const dest = (y * width + x) * 4;
    png.data[dest] = rgba[src]; png.data[dest + 1] = rgba[src + 1];
    png.data[dest + 2] = rgba[src + 2]; png.data[dest + 3] = rgba[src + 3];
  }
  return PNG.sync.write(png);
}

const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

/** Renders frames side by side; gutters and onion tints are inspection aids, not asset pixels. */
export function renderSheet(document: PixelDocument, options: SheetOptions = {}): { png: Buffer; layout: SheetLayout } {
  const scale = options.scale ?? 1; validScale(scale);
  const layout = sheetLayout(document, options);
  const png = new PNG({ width: layout.width * scale, height: layout.height * scale });
  if (layout.gutterColor) {
    const color = rgb(layout.gutterColor);
    for (let i = 0; i < png.data.length; i += 4) png.data.set(color, i);
    for (const cell of layout.cells) for (let y = cell.y * scale; y < (cell.y + cell.height) * scale; y++) png.data.fill(0, (y * png.width + cell.x * scale) * 4, (y * png.width + (cell.x + cell.width) * scale) * 4);
  }
  const before = Math.min(3, options.onion?.before ?? 0); const after = Math.min(3, options.onion?.after ?? 0);
  for (const cell of layout.cells) {
    const index = document.frames.findIndex(frame => frame.id === cell.frameId);
    const rgba = composite(document, cell.frameId);
    if (before || after) {
      const ghosts: { frame: number; color: string }[] = [];
      // Nearer frames are drawn last; at equal distance the previous frame wins because the inspected pose continues from it.
      for (let distance = Math.max(before, after); distance >= 1; distance--) {
        if (distance <= after && index + distance < document.frames.length) ghosts.push({ frame: index + distance, color: ONION_COLORS.after[distance - 1] });
        if (distance <= before && index - distance >= 0) ghosts.push({ frame: index - distance, color: ONION_COLORS.before[distance - 1] });
      }
      const visible = readIndices(document, undefined, cell.frameId);
      for (const ghost of ghosts) {
        const mask = readIndices(document, undefined, document.frames[ghost.frame].id); const color = rgb(ghost.color);
        for (let i = 0; i < mask.length; i++) if (mask[i] && !visible[i]) rgba.set(color, i * 4);
      }
    }
    blit(png, rgba, document.width, document.height, scale, cell.x * scale, cell.y * scale);
  }
  return { png: PNG.sync.write(png), layout };
}

/** Animated GIF of all frames or one tag, honoring the tag's direction and loop flag; index 0 stays transparent. */
export function renderGif(document: PixelDocument, { tag: tagName, scale = 1 }: { tag?: string; scale?: number } = {}): Buffer {
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new AppError('RENDER_SIZE', 'GIF zoom must be a whole number from 1 to 16.');
  const tag = tagName === undefined ? undefined : document.tags.find(item => item.name === tagName);
  const ids = gifFrameIds(document, tagName);
  const width = document.width * scale; const height = document.height * scale;
  const frames = ids.map(id => {
    const source = readIndices(document, undefined, id);
    const indices = scale === 1 ? source : new Uint8Array(width * height);
    if (scale > 1) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) (indices as Uint8Array)[y * width + x] = source[Math.floor(y / scale) * document.width + Math.floor(x / scale)];
    // Browsers treat delays below 2/100 s as 1/10 s, so shorter frames are clamped to 20 ms.
    return { indices, delayCs: Math.max(2, Math.round(document.frames.find(frame => frame.id === id)!.durationMs / 10)) };
  });
  return encodeGif(width, height, document.palette, frames, tag?.loop ?? true);
}

/** Tags fully contained in the exported frames, re-indexed to the sheet order. */
function exportedTags(document: PixelDocument, frameIds: string[]): AnimationTag[] {
  return document.tags.flatMap(tag => {
    const ids = document.frames.slice(tag.from, tag.to + 1).map(frame => frame.id);
    const from = frameIds.indexOf(ids[0]);
    return from >= 0 && ids.every((id, offset) => frameIds[from + offset] === id) ? [{ ...tag, from, to: from + ids.length - 1 }] : [];
  });
}

/** Sheet metadata in Aseprite's JSON array format, which common engine importers read; rectangles address the image rendered at scale. */
export function sheetManifest(name: string, image: string, document: PixelDocument, layout: SheetLayout, scale = 1) {
  const frameIds = layout.cells.map(cell => cell.frameId);
  return {
    frames: layout.cells.map(cell => ({
      filename: `${name} ${cell.frameId}`, frame: { x: cell.x * scale, y: cell.y * scale, w: cell.width * scale, h: cell.height * scale }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cell.width * scale, h: cell.height * scale }, sourceSize: { w: cell.width * scale, h: cell.height * scale }, duration: cell.durationMs,
    })),
    meta: {
      app: 'https://github.com/ermancekic/Pixelator', version: '0.1.0', image, format: 'RGBA8888', size: { w: layout.width * scale, h: layout.height * scale }, scale: String(scale),
      frameTags: exportedTags(document, frameIds).map(({ name, from, to, direction }) => ({ name, from, to, direction })),
      layers: document.layers.map(layer => ({ name: layer.name, opacity: 255, blendMode: 'normal' })),
      slices: [], pivot: { x: document.pivot.x * scale, y: document.pivot.y * scale },
    },
  };
}

export function importPng(base64: string, maxColors: number, paletteLocked = false): PixelDocument {
  const bytes = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new AppError('PNG_REQUIRED', 'A valid PNG file is required.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) throw new AppError('PNG_SIZE', 'PNG dimensions must be positive.');
  let image: PNG;
  try { image = PNG.sync.read(bytes, { checkCRC: true }); }
  catch { throw new AppError('PNG_INVALID', 'The PNG file could not be read losslessly.'); }
  const palette = ['#00000000'];
  const colors = new Map<number, number>(); const pixels = new Array<number>(image.width * image.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3];
    if (alpha !== 0 && alpha !== 255) throw new AppError('PARTIAL_ALPHA', 'Semi-transparent pixels are not changed automatically. Convert them explicitly first.');
    if (!alpha) { pixels[i / 4] = 0; continue; }
    const color = image.data[i] * 65536 + image.data[i + 1] * 256 + image.data[i + 2];
    let index = colors.get(color);
    if (index === undefined) {
      palette.push(`#${color.toString(16).padStart(6, '0').toUpperCase()}`); index = palette.length - 1;
      colors.set(color, index);
    }
    if (palette.length - 1 > maxColors) throw new AppError('PALETTE_LIMIT', `The image has more than ${maxColors} colors. Pixelator does not quantize automatically.`);
    pixels[i / 4] = index;
  }
  if (palette.length === 1) palette.push('#000000');
  const document = createDocument({ width, height, palette, maxColors, paletteLocked, layers: [{ id: 'import', name: 'PNG (unsegmentiert)' }] });
  document.frames[0].cels.import = pixels;
  return document;
}

/** Cuts an imported sheet into frames of equal size, row by row; without frameCount, trailing empty cells are dropped. */
export function sliceSheet(sheet: PixelDocument, frameWidth: number, frameHeight: number, options: { frameCount?: number; durationMs?: number } = {}): PixelDocument {
  if (!Number.isInteger(frameWidth) || frameWidth < 1 || !Number.isInteger(frameHeight) || frameHeight < 1 || sheet.width % frameWidth || sheet.height % frameHeight) throw new AppError('SHEET_SIZE', 'Image width and height must be multiples of the frame size.');
  const columns = sheet.width / frameWidth; const rows = sheet.height / frameHeight;
  const source = sheet.frames[0].cels[sheet.layers[0].id];
  const cells = Array.from({ length: columns * rows }, (_, cell) => {
    const left = cell % columns * frameWidth; const top = Math.floor(cell / columns) * frameHeight; const pixels: number[] = [];
    for (let y = 0; y < frameHeight; y++) for (let x = 0; x < frameWidth; x++) pixels.push(source[(top + y) * sheet.width + left + x]);
    return pixels;
  });
  let count = options.frameCount ?? cells.length;
  if (options.frameCount === undefined) while (count > 1 && cells[count - 1].every(index => index === 0)) count--;
  if (!Number.isInteger(count) || count < 1 || count > cells.length || count > MAX_FRAMES) throw new AppError('SHEET_FRAMES', `The sheet yields ${count} frames; 1 to ${Math.min(cells.length, MAX_FRAMES)} are allowed.`);
  const document = createDocument({
    width: frameWidth, height: frameHeight, palette: sheet.palette, maxColors: sheet.maxColors, paletteLocked: sheet.paletteLocked,
    layers: sheet.layers.map(({ id, name }) => ({ id, name })),
    frames: Array.from({ length: count }, (_, i) => ({ id: `frame-${i + 1}`, durationMs: options.durationMs ?? DEFAULT_FRAME_MS })),
  });
  document.frames.forEach((frame, i) => { frame.cels[sheet.layers[0].id] = cells[i]; });
  return document;
}

const importer = { textureType: 'Sprite', filterMode: 'Point', textureCompression: 'Uncompressed', mipmapEnabled: false, alphaIsTransparency: true, wrapMode: 'Clamp', spriteMeshType: 'FullRect' };

const unityBase = (assetId: string, revisionId: string, name: string, doc: PixelDocument) => ({
  schemaVersion: 1, assetId, revisionId, name, width: doc.width, height: doc.height, pixelsPerUnit: 32,
  pivot: { x: doc.pivot.x / doc.width, y: 1 - doc.pivot.y / doc.height }, pivotCoordinateSystem: 'normalized, bottom-left origin',
});

/** Manual Unity import settings for a single sprite. */
export function unityManifest(assetId: string, revisionId: string, name: string, doc: PixelDocument) {
  return { ...unityBase(assetId, revisionId, name, doc), textureImporter: { ...importer, spriteMode: 'Single' } };
}

/** Manual Unity import settings for a sprite sheet: one sprite per frame and one clip per tag. */
export function unitySheetManifest(assetId: string, revisionId: string, name: string, doc: PixelDocument, sheet: { image: string; layout: SheetLayout }) {
  const base = unityBase(assetId, revisionId, name, doc); const { pivot } = base;
  const { layout } = sheet; const frameIds = layout.cells.map(cell => cell.frameId);
  const spriteName = (frameId: string) => `${name}_${frameId}`;
  const clips = doc.tags.length ? exportedTags(doc, frameIds) : [{ name, from: 0, to: frameIds.length - 1, direction: 'forward' as const, loop: true }];
  return {
    ...base, texture: sheet.image, textureWidth: layout.width, textureHeight: layout.height,
    textureImporter: { ...importer, spriteMode: 'Multiple' },
    rectCoordinateSystem: 'pixels, bottom-left origin',
    sprites: layout.cells.map(cell => ({ name: spriteName(cell.frameId), rect: { x: cell.x, y: layout.height - cell.y - cell.height, width: cell.width, height: cell.height }, pivot })),
    clips: clips.map(tag => ({
      name: tag.name, loop: tag.loop, direction: tag.direction,
      frames: layout.cells.slice(tag.from, tag.to + 1).map(cell => ({ sprite: spriteName(cell.frameId), durationMs: cell.durationMs })),
    })),
  };
}

const encode = (width: number, height: number, rgba: Uint8Array | Uint8ClampedArray, scale: number): Buffer => {
  validScale(scale);
  const png = new PNG({ width: width * scale, height: height * scale });
  blit(png, rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, scale);
  return PNG.sync.write(png);
};

/** The frame repeated 3×3 so seams at the canvas edges become visible. */
export function renderWrapPreview(document: PixelDocument, scale = 1, frameId?: string): { png: Buffer; width: number; height: number } {
  const rgba = composite(document, frameId); const width = document.width * 3; const height = document.height * 3;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.set(rgba.subarray(((y % document.height) * document.width + x % document.width) * 4, ((y % document.height) * document.width + x % document.width) * 4 + 4), (y * width + x) * 4);
  return { png: encode(width, height, out, scale), width: width * scale, height: height * scale };
}

/** Tiles separated by a one-pixel gutter in a color outside the palette, to judge every tile on its own. */
export function renderTileSheet(document: PixelDocument, scale = 1, frameId?: string): { png: Buffer; width: number; height: number; gutterColor: string } {
  if (!document.tileset) throw new AppError('NO_TILESET', 'This asset has no tile grid.');
  const { tileWidth: tw, tileHeight: th } = document.tileset; const { columns, rows } = tileGrid(document.tileset, document.width, document.height);
  const width = columns * tw + columns - 1; const height = rows * th + rows - 1; const rgba = composite(document, frameId);
  const palette = document.palette.map(color => color.toUpperCase()); const gutterColor = GUTTER_CANDIDATES.find(color => !palette.includes(color)) ?? GUTTER_CANDIDATES[0];
  const out = new Uint8Array(width * height * 4); const gutter = rgb(gutterColor);
  for (let i = 0; i < width * height; i++) out.set(gutter, i * 4);
  for (let y = 0; y < document.height; y++) for (let x = 0; x < document.width; x++) {
    const tx = x + Math.floor(x / tw); const ty = y + Math.floor(y / th);
    out.set(rgba.subarray((y * document.width + x) * 4, (y * document.width + x) * 4 + 4), (ty * width + tx) * 4);
  }
  return { png: encode(width, height, out, scale), width: width * scale, height: height * scale, gutterColor };
}

/** A sample map painted with the labeled tiles of one terrain; magenta cells mark combinations without a tile. */
export function renderTerrainPreview(document: PixelDocument, terrain = 1, scale = 1, frameId?: string): { png: Buffer; width: number; height: number; map: TerrainMap } {
  if (!document.tileset) throw new AppError('NO_TILESET', 'This asset has no tile grid.');
  if (!Number.isInteger(terrain) || terrain < 1 || terrain > document.tileset.terrains.length) throw new AppError('UNKNOWN_TERRAIN', 'This terrain does not exist.');
  const map = terrainMap(document.tileset, terrain);
  const image = renderTerrainMap(map, document.tileset, readIndices(document, undefined, frameId), document.palette, document.width);
  return { png: encode(image.width, image.height, image.rgba, scale), width: image.width * scale, height: image.height * scale, map };
}
