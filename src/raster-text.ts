import type { Rect } from './types.js';

// One character per palette index: "." is transparent, then 1-9 and a-w for indices 1..32.
export const ROW_ALPHABET = '.123456789abcdefghijklmnopqrstuvw';
export const ROW_PATTERN = /^[.1-9a-w]+$/;
export const MAX_READ_CELLS = 16384;

export const rowIndex = (symbol: string): number => ROW_ALPHABET.indexOf(symbol);

export function encodeRows(indices: ArrayLike<number>, width: number, rect: Rect): string[] {
  const rows: string[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    let row = '';
    for (let x = rect.x; x < rect.x + rect.width; x++) row += ROW_ALPHABET[indices[y * width + x]];
    rows.push(row);
  }
  return rows;
}

export function rowLegend(palette: string[]): Record<string, string> {
  return Object.fromEntries(palette.map((color, index) => [ROW_ALPHABET[index], index ? color : 'transparent']));
}
