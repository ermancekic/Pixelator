import type { Rect } from './types.js';

/** Opaque colors an asset may hold. Index 0 is transparency, so a palette has at most 256 entries: one byte per pixel and a full GIF color table. */
export const MAX_COLORS = 255;
// One character per palette index: "." is transparent, then 1-9 and a-w for indices 1..32.
export const ROW_ALPHABET = '.123456789abcdefghijklmnopqrstuvw';
/** char spells one pixel with one ROW_ALPHABET symbol (indices 0..32); hex spells it with two characters, ".." (or "00") transparent and 01..ff for indices 1..255. */
export type RowEncoding = 'char' | 'hex';
/** Characters of both encodings; the engine checks every row against its declared encoding. */
export const ROW_PATTERN = /^[.0-9a-wA-F]+$/;
export const MAX_READ_CELLS = 16384;

/** The encoding that spells every index of a palette with this many entries (transparency included). */
export const rowEncodingFor = (paletteLength: number): RowEncoding => paletteLength > ROW_ALPHABET.length ? 'hex' : 'char';

/** Palette index of one pixel symbol, or -1 when the encoding does not know it. */
export function rowIndex(symbol: string, encoding: RowEncoding = 'char'): number {
  if (encoding === 'hex') return symbol === '..' ? 0 : /^[0-9a-fA-F]{2}$/.test(symbol) ? parseInt(symbol, 16) : -1;
  return symbol.length === 1 ? ROW_ALPHABET.indexOf(symbol) : -1;
}

export const rowSymbol = (index: number, encoding: RowEncoding = 'char'): string => encoding === 'hex' ? (index ? index.toString(16).padStart(2, '0') : '..') : ROW_ALPHABET[index];

export function encodeRows(indices: ArrayLike<number>, width: number, rect: Rect, encoding: RowEncoding = 'char'): string[] {
  const rows: string[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    let row = '';
    for (let x = rect.x; x < rect.x + rect.width; x++) row += rowSymbol(indices[y * width + x], encoding);
    rows.push(row);
  }
  return rows;
}

/** Row symbol to color; a role name follows the hex value when the palette has one. */
export function rowLegend(palette: string[], names?: string[], encoding: RowEncoding = 'char'): Record<string, string> {
  return Object.fromEntries(palette.map((color, index) => [rowSymbol(index, encoding), index ? `${color}${names?.[index] ? ` ${names[index]}` : ''}` : 'transparent']));
}
