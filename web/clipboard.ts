import { nearestColor } from '../src/engine';
import { ROW_ALPHABET } from '../src/raster-text';
import type { Operation, Rect } from '../src/types';
import { fromCanvasMask, selectionContains } from './selection-helpers';
import type { Selection } from './selection-helpers';

/** Copied pixels as #RRGGBB colors so they paste into any asset whatever its palette; null is transparent. */
export type ClipImage = { width: number; height: number; colors: (string | null)[]; origin?: { x: number; y: number } };
export const MAX_CLIP_PIXELS = 2048 * 2048;

/** The selected pixels of a raster (one layer or the visible composite); unselected cells inside the box stay transparent. */
export function copyPixels(indices: ArrayLike<number>, palette: string[], width: number, selection: Selection): ClipImage {
  const { rect } = selection; const colors: (string | null)[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
    const index = selectionContains(selection, x, y) ? indices[y * width + x] : 0;
    colors.push(index ? palette[index].toUpperCase() : null);
  }
  return { width: rect.width, height: rect.height, colors, origin: { x: rect.x, y: rect.y } };
}

export const sameClip = (a: ClipImage, b: ClipImage) => a.width === b.width && a.height === b.height && a.colors.every((color, i) => color === b.colors[i]);

/** Palette indices for the clip: exact matches first, then new palette entries while extend allows, then the nearest color. */
export function mapClipColors(clip: ClipImage, palette: string[], maxColors: number, extend: boolean): { indices: number[]; palette: string[]; added: number; approximated: number } {
  const next = [...palette]; const lookup = new Map<string, number>();
  next.forEach((color, index) => { if (index) lookup.set(color.toUpperCase(), index); });
  let added = 0, approximated = 0;
  for (const color of new Set(clip.colors)) {
    if (color === null || lookup.has(color)) continue;
    if (extend && next.length - 1 < maxColors) { next.push(color); lookup.set(color, next.length - 1); added++; }
    else { lookup.set(color, nearestColor(color, next)); approximated++; }
  }
  return { indices: clip.colors.map(color => color === null ? 0 : lookup.get(color)!), palette: next, added, approximated };
}

/** Where a clip lands: on the selection, at its copy origin, or centered, moved onto the canvas where it fits. */
export function pastePosition(clip: ClipImage, width: number, height: number, selection: Selection | null): { x: number; y: number } {
  const base = selection?.rect ?? clip.origin ?? { x: Math.floor((width - clip.width) / 2), y: Math.floor((height - clip.height) / 2) };
  return { x: Math.max(0, Math.min(base.x, width - clip.width)), y: Math.max(0, Math.min(base.y, height - clip.height)) };
}

/** A rows operation in over mode placing the mapped clip at (x, y), cropped to the canvas, and the selection of its opaque pixels. */
export function pasteOperation(indices: number[], clip: ClipImage, x: number, y: number, width: number, height: number, layerId: string, frameId: string): { operation: Operation; rect: Rect; selection: Selection; cropped: boolean } | null {
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(width, x + clip.width), y1 = Math.min(height, y + clip.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const rows: string[] = []; const flags = new Uint8Array(width * height);
  for (let py = y0; py < y1; py++) {
    let row = '';
    for (let px = x0; px < x1; px++) {
      const index = indices[(py - y) * clip.width + px - x]; row += ROW_ALPHABET[index];
      if (index) flags[py * width + px] = 1;
    }
    rows.push(row);
  }
  const selection = fromCanvasMask(flags, width, height);
  if (!selection) return null;
  return { operation: { op: 'rows', layerId, frameId, x: x0, y: y0, rows, mode: 'over' }, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, selection, cropped: x1 - x0 < clip.width || y1 - y0 < clip.height };
}

export function clipRgba(clip: ClipImage): Uint8ClampedArray {
  const data = new Uint8ClampedArray(clip.width * clip.height * 4);
  clip.colors.forEach((color, i) => { if (color) data.set([parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255], i * 4); });
  return data;
}

/** Reads RGBA pixels; alpha below 128 counts as transparent because indexed pixels are either opaque or empty. */
export function rgbaClip(data: ArrayLike<number>, width: number, height: number): ClipImage {
  if (width * height > MAX_CLIP_PIXELS) throw new Error('Das Bild in der Zwischenablage ist zu groß zum Einfügen.');
  const colors: (string | null)[] = [];
  for (let i = 0; i < width * height; i++) colors.push(data[i * 4 + 3] < 128 ? null : `#${[0, 1, 2].map(c => data[i * 4 + c].toString(16).padStart(2, '0')).join('')}`.toUpperCase());
  return { width, height, colors };
}

export async function clipPng(clip: ClipImage): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = clip.width; canvas.height = clip.height;
  canvas.getContext('2d')!.putImageData(new ImageData(clipRgba(clip) as Uint8ClampedArray<ArrayBuffer>, clip.width, clip.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG konnte nicht erzeugt werden.')), 'image/png'));
}

export async function imageClip(blob: Blob): Promise<ClipImage> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    if (bitmap.width * bitmap.height > MAX_CLIP_PIXELS) throw new Error('Das Bild in der Zwischenablage ist zu groß zum Einfügen.');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0);
    return rgbaClip(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
  } finally { bitmap.close(); }
}
