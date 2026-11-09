import { PNG } from 'pngjs';
import { composite } from './engine.js';
import { AppError } from './errors.js';
import type { SheetLayout } from './export-layout.js';
import { sheetRaster } from './images.js';
import type { PixelDocument, Rect } from './types.js';

// Aids for agents that review an image: detail views, shape and brightness checks, backgrounds, coordinate rulers and contact sheets.
// None of them changes a document; grid lines, rulers, labels and backgrounds are not asset pixels.

export type InspectMode = 'color' | 'silhouette' | 'values';
/** Long edge above which common vision clients shrink an image and blur its pixels. */
export const VISION_EDGE = 1568;
export const MAX_INSPECT_PIXELS = 4096 * 4096;
const CHECKER = [[180, 180, 180, 255], [200, 200, 200, 255]] as const;
const CHECKER_SIZE = 8;
// Cyan reads well as a thin line on most art; the others follow when the palette or the gutter already uses it.
const GRID_CANDIDATES = ['#00FFFF', '#FF00FF', '#FFFF00', '#00FF00', '#FF8000', '#8000FF'];
const INK = [0, 0, 0, 255] as const; const PAPER = [255, 255, 255, 255] as const;

const rgba = (hex: string): readonly number[] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

/** A copy limited to a region and to some layers, so every renderer can show a detail without knowing about it. */
export function viewDocument(document: PixelDocument, { rect, layerIds }: { rect?: Rect; layerIds?: string[] }): PixelDocument {
  const missing = layerIds?.find(id => !document.layers.some(layer => layer.id === id));
  if (missing !== undefined) throw new AppError('UNKNOWN_LAYER', `Layer ${missing} does not exist.`);
  const layers = document.layers.map(layer => layerIds ? { ...layer, visible: layerIds.includes(layer.id) } : layer);
  if (!rect) return { ...document, layers };
  if (rect.x + rect.width > document.width || rect.y + rect.height > document.height) throw new AppError('INVALID_RECT', 'The area must lie inside the canvas.');
  const empty = new Array<number>(rect.width * rect.height).fill(0);
  const crop = (pixels: number[]) => {
    const out = new Array<number>(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) out[y * rect.width + x] = pixels[(rect.y + y) * document.width + rect.x + x];
    return out;
  };
  const { tileset: _tileset, ...rest } = document;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  return {
    ...rest, width: rect.width, height: rect.height, layers,
    // Hidden layers do not reach the image; they share one empty raster instead of being cropped.
    frames: document.frames.map(frame => ({ ...frame, cels: Object.fromEntries(layers.map(layer => [layer.id, layer.visible ? crop(frame.cels[layer.id]) : empty])) })),
    pivot: { x: clamp(document.pivot.x - rect.x, rect.width), y: clamp(document.pivot.y - rect.y, rect.height) },
  };
}

function silhouette(pixels: Uint8Array) {
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) { pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; }
}
/** Perceived brightness (Rec. 601), to compare the contrast of neighboring materials without hue. */
function values(pixels: Uint8Array) {
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) { const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]); pixels[i] = gray; pixels[i + 1] = gray; pixels[i + 2] = gray; }
}

function enlarge(source: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  if (scale === 1) return source;
  const out = new Uint8Array(width * scale * height * scale * 4); const row = width * scale * 4;
  for (let y = 0; y < height; y++) {
    const start = y * scale * row;
    for (let x = 0; x < width; x++) { const pixel = source.subarray((y * width + x) * 4, (y * width + x) * 4 + 4); for (let dx = 0; dx < scale; dx++) out.set(pixel, start + (x * scale + dx) * 4); }
    for (let dy = 1; dy < scale; dy++) out.copyWithin(start + dy * row, start, start + row);
  }
  return out;
}

/** Fills transparent pixels with a flat color or a checkerboard in image pixels. */
function paintBackground(image: Uint8Array, width: number, height: number, background: string) {
  const flat = background === 'checker' ? null : rgba(background);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (!image[i + 3]) image.set(flat ?? CHECKER[(Math.floor(x / CHECKER_SIZE) + Math.floor(y / CHECKER_SIZE)) % 2], i);
  }
}

// 3×5 digits for rulers and labels, drawn twice as large.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];
const GLYPH = 2; const GLYPH_WIDTH = 3 * GLYPH; const GLYPH_HEIGHT = 5 * GLYPH; const ADVANCE = GLYPH_WIDTH + GLYPH;
const textWidth = (text: string) => text.length * ADVANCE - GLYPH;
function drawText(image: Uint8Array, width: number, height: number, text: string, left: number, top: number, color: readonly number[] = INK) {
  [...text].forEach((digit, position) => {
    const glyph = DIGITS[Number(digit)];
    for (let i = 0; i < 15; i++) if (glyph[i] === '1') for (let dy = 0; dy < GLYPH; dy++) for (let dx = 0; dx < GLYPH; dx++) {
      const x = left + position * ADVANCE + (i % 3) * GLYPH + dx; const y = top + Math.floor(i / 3) * GLYPH + dy;
      if (x >= 0 && y >= 0 && x < width && y < height) image.set(color, (y * width + x) * 4);
    }
  });
}
function fillRect(image: Uint8Array, width: number, height: number, left: number, top: number, w: number, h: number, color: readonly number[]) {
  for (let y = Math.max(0, top); y < Math.min(height, top + h); y++) for (let x = Math.max(0, left); x < Math.min(width, left + w); x++) image.set(color, (y * width + x) * 4);
}
function encode(image: Uint8Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.set(image);
  return PNG.sync.write(png);
}

export interface InspectionOptions {
  frameIds: string[]; columns: number; gutter: number; scale: number;
  onion?: { before?: number; after?: number };
  mode?: InspectMode; background?: string; grid?: number;
  /** Canvas position of the view's top-left pixel, for ruler labels of a cropped view. */
  origin?: { x: number; y: number };
}
export interface InspectionImage {
  png: Buffer; width: number; height: number; layout: SheetLayout;
  /** Ruler margins in image pixels; canvas pixel (x, y) of a frame view starts at (left + (x - origin.x) * scale, top + (y - origin.y) * scale). */
  margin: { left: number; top: number };
  grid: { spacing: number; color: string; lines: boolean } | null;
}

/** One inspection image: frames in a sheet, optionally as silhouette or brightness, on a background and with a coordinate grid. */
export function renderInspection(document: PixelDocument, options: InspectionOptions): InspectionImage {
  const { scale } = options; const origin = options.origin ?? { x: 0, y: 0 };
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new AppError('RENDER_SIZE', 'Zoom must be a whole number from 1 to 32.');
  // A flat background goes through the sheet renderer, which fills each frame and keeps the gutter color away from it; the checkerboard is laid over the enlarged image.
  const background = options.background ?? (options.mode === 'silhouette' ? '#FFFFFF' : undefined);
  const flat = background === 'checker' ? undefined : background;
  const sheet = sheetRaster(document, { frameIds: options.frameIds, columns: options.columns, gutter: options.gutter, onion: options.onion, background: flat }, options.mode === 'silhouette' ? silhouette : options.mode === 'values' ? values : undefined);
  const { layout } = sheet; const width = sheet.width * scale; const height = sheet.height * scale;
  const image = enlarge(sheet.rgba, sheet.width, sheet.height, scale);
  if (background === 'checker') paintBackground(image, width, height, background);
  if (!options.grid) return { png: encode(image, width, height), width, height, layout, margin: { left: 0, top: 0 }, grid: null };

  const spacing = options.grid; const palette = document.palette.map(color => color.toUpperCase());
  const color = GRID_CANDIDATES.find(candidate => !palette.includes(candidate) && candidate !== layout.gutterColor && candidate !== flat?.toUpperCase()) ?? GRID_CANDIDATES[0];
  // Lines sit on the left and top edge of the pixel they name; below scale 3 they would hide too much of it.
  const lines = scale >= 3; const line = rgba(color);
  if (lines) for (const cell of layout.cells) {
    for (let x = 1; x < cell.width; x++) if ((origin.x + x) % spacing === 0) fillRect(image, width, height, (cell.x + x) * scale, cell.y * scale, 1, cell.height * scale, line);
    for (let y = 1; y < cell.height; y++) if ((origin.y + y) % spacing === 0) fillRect(image, width, height, cell.x * scale, (cell.y + y) * scale, cell.width * scale, 1, line);
  }
  const left = String(origin.y + document.height - 1).length * ADVANCE + 6; const top = GLYPH_HEIGHT + 6;
  const total = { width: width + left, height: height + top };
  const out = new Uint8Array(total.width * total.height * 4);
  fillRect(out, total.width, total.height, 0, 0, total.width, total.height, PAPER);
  for (let y = 0; y < height; y++) out.set(image.subarray(y * width * 4, (y + 1) * width * 4), ((top + y) * total.width + left) * 4);
  // Each column and row of cells gets its own rulers; a label names the pixel that starts at its tick.
  for (const cell of layout.cells.filter(item => item.row === 0)) {
    let free = 0; const end = left + (cell.x + cell.width) * scale;
    for (let x = 0; x < cell.width; x++) {
      if (x && (origin.x + x) % spacing) continue;
      const tick = left + (cell.x + x) * scale; const label = String(origin.x + x);
      fillRect(out, total.width, total.height, tick, top - 4, 1, 4, INK);
      if (tick + 2 < free || tick + 2 + textWidth(label) > end) continue;
      drawText(out, total.width, total.height, label, tick + 2, 1);
      free = tick + 2 + textWidth(label) + 4;
    }
  }
  for (const cell of layout.cells.filter(item => item.column === 0)) {
    let free = 0; const end = top + (cell.y + cell.height) * scale;
    for (let y = 0; y < cell.height; y++) {
      if (y && (origin.y + y) % spacing) continue;
      const tick = top + (cell.y + y) * scale; const label = String(origin.y + y);
      fillRect(out, total.width, total.height, left - 4, tick, 4, 1, INK);
      if (tick + 2 < free || tick + 2 + GLYPH_HEIGHT > end) continue;
      drawText(out, total.width, total.height, label, left - 6 - textWidth(label), tick + 2);
      free = tick + 2 + GLYPH_HEIGHT + 3;
    }
  }
  return { png: encode(out, total.width, total.height), width: total.width, height: total.height, layout, margin: { left, top }, grid: { spacing, color, lines } };
}

export interface ContactCell { label: number; x: number; y: number; width: number; height: number }

/** Several assets at one scale on a shared background, bottom-aligned per row and numbered, to compare a family's style. */
export function renderContactSheet(documents: PixelDocument[], options: { scale: number; background?: string; maxWidth?: number }): { png: Buffer; width: number; height: number; cells: ContactCell[] } {
  const { scale } = options; const maxWidth = options.maxWidth ?? 1280; const pad = 8; const labelHeight = GLYPH_HEIGHT + 6;
  if (!documents.length) throw new AppError('ASSET_REQUIRED', 'A contact sheet needs at least one asset.');
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new AppError('RENDER_SIZE', 'Zoom must be a whole number from 1 to 32.');
  const cells: ContactCell[] = [];
  let x = pad; let top = pad; let rowHeight = 0; let rowStart = 0; let sheetWidth = 0;
  const closeRow = () => {
    // Sprites of different height stand on one line, like characters on the ground.
    for (const cell of cells.slice(rowStart)) cell.y = top + rowHeight - cell.height;
    top += rowHeight + labelHeight + pad; x = pad; rowHeight = 0; rowStart = cells.length;
  };
  documents.forEach((document, index) => {
    const width = document.width * scale; const height = document.height * scale;
    if (x > pad && x + width + pad > maxWidth) closeRow();
    cells.push({ label: index + 1, x, y: 0, width, height });
    x += width + pad; rowHeight = Math.max(rowHeight, height); sheetWidth = Math.max(sheetWidth, x);
  });
  closeRow();
  const width = sheetWidth; const height = top;
  if (width * height > MAX_INSPECT_PIXELS) throw new AppError('RENDER_SIZE', 'The contact sheet would be too large. Choose a smaller zoom or fewer assets.');
  const out = new Uint8Array(width * height * 4);
  paintBackground(out, width, height, options.background ?? 'checker');
  cells.forEach((cell, index) => {
    const document = documents[index]; const pixels = enlarge(composite(document), document.width, document.height, scale);
    for (let y = 0; y < cell.height; y++) for (let px = 0; px < cell.width; px++) {
      const source = (y * cell.width + px) * 4;
      if (pixels[source + 3]) out.set(pixels.subarray(source, source + 4), ((cell.y + y) * width + cell.x + px) * 4);
    }
    const label = String(cell.label); const plate = cell.y + cell.height + 2;
    fillRect(out, width, height, cell.x, plate, textWidth(label) + 4, GLYPH_HEIGHT + 4, PAPER);
    drawText(out, width, height, label, cell.x + 2, plate + 2);
  });
  return { png: encode(out, width, height), width, height, cells };
}
