import { AppError } from './errors.js';
import type { PixelDocument } from './types.js';

// Layout of exported frames, shared by the server renderers and the editor's export preview.
// Onion tints follow Pixelorama's blue (previous) / red (next) mode and fade with distance.
export const ONION_COLORS = { before: ['#3060FF', '#7090FF', '#B0C0FF'], after: ['#FF4040', '#FF8080', '#FFC0C0'] } as const;
export const GUTTER_CANDIDATES = ['#FF00FF', '#00FFFF', '#FFFF00', '#00FF00', '#FF8000', '#8000FF'];

export interface SheetOptions { frameIds?: string[]; columns?: number; scale?: number; gutter?: number; onion?: { before?: number; after?: number } }
export interface SheetCell { frameId: string; column: number; row: number; x: number; y: number; width: number; height: number; durationMs: number }
export interface SheetLayout { columns: number; rows: number; gutter: number; gutterColor: string | null; width: number; height: number; cells: SheetCell[] }

/** Positions of the frames in a sheet, in source pixels (before scaling). */
export function sheetLayout(document: PixelDocument, { frameIds, columns, gutter = 0 }: SheetOptions = {}): SheetLayout {
  const ids = frameIds ?? document.frames.map(frame => frame.id);
  if (!ids.length) throw new AppError('INVALID_FRAMES', 'At least one frame is required.');
  const frames = ids.map(id => {
    const frame = document.frames.find(item => item.id === id);
    if (!frame) throw new AppError('UNKNOWN_FRAME', `Frame ${id} does not exist.`);
    return frame;
  });
  const count = Math.max(1, Math.min(columns ?? frames.length, frames.length));
  if (!Number.isInteger(count) || !Number.isInteger(gutter) || gutter < 0 || gutter > 8) throw new AppError('INVALID_LAYOUT', 'Columns and spacing must be valid whole numbers.');
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

/** Frames of a tag in timeline order, or all frames. */
export function framesFor(document: PixelDocument, tagName?: string): string[] {
  if (tagName === undefined) return document.frames.map(frame => frame.id);
  const tag = document.tags.find(item => item.name === tagName);
  if (!tag) throw new AppError('UNKNOWN_TAG', `Tag ${tagName} does not exist.`);
  return document.frames.slice(tag.from, tag.to + 1).map(frame => frame.id);
}

/** Frame order of an animated GIF: all frames or one tag, played in the tag's direction. */
export function gifFrameIds(document: PixelDocument, tagName?: string): string[] {
  const tag = tagName === undefined ? undefined : document.tags.find(item => item.name === tagName);
  const ids = framesFor(document, tagName);
  if (tag?.direction === 'reverse') return [...ids].reverse();
  if (tag?.direction === 'pingpong' && ids.length > 2) return [...ids, ...ids.slice(1, -1).reverse()];
  return ids;
}
