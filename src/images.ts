import { PNG } from 'pngjs';
import { composite, createDocument, readIndices } from './engine.js';
import { AppError } from './store.js';
import type { AnimationTag, PixelDocument } from './types.js';

const validScale = (scale: number) => {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new AppError('RENDER_SIZE', 'Zoom muss ganzzahlig sein und zwischen 1 und 32 liegen.');
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
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) throw new AppError('RENDER_SIZE', 'Die Vorschaudimension muss eine positive ganze Zahl sein.');
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

// Onion tints follow Pixelorama's blue (previous) / red (next) mode and fade with distance.
export const ONION_COLORS = { before: ['#3060FF', '#7090FF', '#B0C0FF'], after: ['#FF4040', '#FF8080', '#FFC0C0'] } as const;
const GUTTER_CANDIDATES = ['#FF00FF', '#00FFFF', '#FFFF00', '#00FF00', '#FF8000', '#8000FF'];
const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

export interface SheetOptions { frameIds?: string[]; columns?: number; scale?: number; gutter?: number; onion?: { before?: number; after?: number } }
export interface SheetCell { frameId: string; column: number; row: number; x: number; y: number; width: number; height: number; durationMs: number }
export interface SheetLayout { columns: number; rows: number; gutter: number; gutterColor: string | null; width: number; height: number; cells: SheetCell[] }

/** Positions of the frames in a sheet, in source pixels (before scaling). */
export function sheetLayout(document: PixelDocument, { frameIds, columns, gutter = 0 }: SheetOptions = {}): SheetLayout {
  const ids = frameIds ?? document.frames.map(frame => frame.id);
  if (!ids.length) throw new AppError('INVALID_FRAMES', 'Mindestens ein Frame ist erforderlich.');
  const frames = ids.map(id => {
    const frame = document.frames.find(item => item.id === id);
    if (!frame) throw new AppError('UNKNOWN_FRAME', `Frame ${id} existiert nicht.`);
    return frame;
  });
  const count = Math.max(1, Math.min(columns ?? frames.length, frames.length));
  if (!Number.isInteger(count) || !Number.isInteger(gutter) || gutter < 0 || gutter > 8) throw new AppError('INVALID_LAYOUT', 'Spalten und Abstand müssen gültige ganze Zahlen sein.');
  const rows = Math.ceil(frames.length / count);
  const palette = document.palette.map(color => color.toUpperCase());
  const gutterColor = gutter ? GUTTER_CANDIDATES.find(color => !palette.includes(color)) ?? GUTTER_CANDIDATES[0] : null;
  return {
    columns: count, rows, gutter, gutterColor,
    width: count * document.width + (count - 1) * gutter, height: rows * document.height + (rows - 1) * gutter,
    cells: frames.map((frame, index) => {
      const column = index % count; const row = Math.floor(index / count);
      return { frameId: frame.id, column, row, x: column * (document.width + gutter), y: row * (document.height + gutter), width: document.width, height: document.height, durationMs: frame.durationMs };
    }),
  };
}

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

/** Frames of a tag in timeline order, or all frames. */
export function framesFor(document: PixelDocument, tagName?: string): string[] {
  if (tagName === undefined) return document.frames.map(frame => frame.id);
  const tag = document.tags.find(item => item.name === tagName);
  if (!tag) throw new AppError('UNKNOWN_TAG', `Tag ${tagName} existiert nicht.`);
  return document.frames.slice(tag.from, tag.to + 1).map(frame => frame.id);
}

/** Tags fully contained in the exported frames, re-indexed to the sheet order. */
function exportedTags(document: PixelDocument, frameIds: string[]): AnimationTag[] {
  return document.tags.flatMap(tag => {
    const ids = document.frames.slice(tag.from, tag.to + 1).map(frame => frame.id);
    const from = frameIds.indexOf(ids[0]);
    return from >= 0 && ids.every((id, offset) => frameIds[from + offset] === id) ? [{ ...tag, from, to: from + ids.length - 1 }] : [];
  });
}

/** Sheet metadata in Aseprite's JSON array format, which common engine importers read. */
export function sheetManifest(name: string, image: string, document: PixelDocument, layout: SheetLayout) {
  const frameIds = layout.cells.map(cell => cell.frameId);
  return {
    frames: layout.cells.map(cell => ({
      filename: `${name} ${cell.frameId}`, frame: { x: cell.x, y: cell.y, w: cell.width, h: cell.height }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cell.width, h: cell.height }, sourceSize: { w: cell.width, h: cell.height }, duration: cell.durationMs,
    })),
    meta: {
      app: 'https://github.com/ermancekic/Pixelator', version: '0.1.0', image, format: 'RGBA8888', size: { w: layout.width, h: layout.height }, scale: '1',
      frameTags: exportedTags(document, frameIds).map(({ name, from, to, direction }) => ({ name, from, to, direction })),
      layers: document.layers.map(layer => ({ name: layer.name, opacity: 255, blendMode: 'normal' })),
      slices: [], pivot: document.pivot,
    },
  };
}

export function importPng(base64: string, maxColors: number, paletteLocked = false): PixelDocument {
  const bytes = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new AppError('PNG_REQUIRED', 'Eine gültige PNG-Datei ist erforderlich.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) throw new AppError('PNG_SIZE', 'PNG-Abmessungen müssen positiv sein.');
  let image: PNG;
  try { image = PNG.sync.read(bytes, { checkCRC: true }); }
  catch { throw new AppError('PNG_INVALID', 'Die PNG-Datei konnte nicht verlustfrei gelesen werden.'); }
  const palette = ['#00000000'];
  const colors = new Map<number, number>(); const pixels = new Array<number>(image.width * image.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3];
    if (alpha !== 0 && alpha !== 255) throw new AppError('PARTIAL_ALPHA', 'Teiltransparente Pixel werden nicht automatisch verändert. Bitte vorher ausdrücklich konvertieren.');
    if (!alpha) { pixels[i / 4] = 0; continue; }
    const color = image.data[i] * 65536 + image.data[i + 1] * 256 + image.data[i + 2];
    let index = colors.get(color);
    if (index === undefined) {
      palette.push(`#${color.toString(16).padStart(6, '0').toUpperCase()}`); index = palette.length - 1;
      colors.set(color, index);
    }
    if (palette.length - 1 > maxColors) throw new AppError('PALETTE_LIMIT', `Das Bild enthält mehr als ${maxColors} Farben. Keine automatische Quantisierung.`);
    pixels[i / 4] = index;
  }
  if (palette.length === 1) palette.push('#000000');
  const document = createDocument({ width, height, palette, maxColors, paletteLocked, layers: [{ id: 'import', name: 'PNG (unsegmentiert)' }] });
  document.frames[0].cels.import = pixels;
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
