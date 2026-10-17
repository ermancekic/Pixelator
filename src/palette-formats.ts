/** Palette files shared by the editor and the export endpoint; index 0 (transparency) is never written. */
export type PaletteFormat = 'gpl' | 'hex' | 'pal';
export const PALETTE_FORMATS: Record<PaletteFormat, { extension: string; mime: string; label: string }> = {
  gpl: { extension: 'gpl', mime: 'text/plain', label: 'GIMP (.gpl)' },
  hex: { extension: 'hex', mime: 'text/plain', label: 'Lospec/Hex (.hex)' },
  pal: { extension: 'pal', mime: 'text/plain', label: 'JASC (.pal)' },
};

const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
const toHex = (values: number[]) => {
  if (values.some(value => value > 255)) throw new Error('INVALID_PALETTE: Color channels must be in 0..255.');
  return `#${values.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

/** Serializes the opaque colors of a document palette. */
export function writePalette(palette: string[], format: PaletteFormat, name = 'Pixelator'): string {
  const colors = palette.slice(1);
  if (format === 'hex') return colors.map(color => color.slice(1, 7).toUpperCase()).join('\n') + '\n';
  if (format === 'pal') return ['JASC-PAL', '0100', String(colors.length), ...colors.map(color => channels(color).join(' '))].join('\r\n') + '\r\n';
  return ['GIMP Palette', `Name: ${name.replace(/[\r\n]+/g, ' ')}`, 'Columns: 8', '#', ...colors.map(color => `${channels(color).map(value => String(value).padStart(3)).join(' ')}\t${color.toUpperCase()}`)].join('\n') + '\n';
}

/**
 * Reads GIMP (.gpl), JASC/Paint Shop Pro (.pal), Paint.NET (.txt, AARRGGBB) and plain hex lists (Lospec .hex, CSS-like #RRGGBB).
 * Returns unique #RRGGBB colors in file order; fully transparent Paint.NET entries are skipped.
 */
export function readPalette(text: string): string[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(line => line.trim());
  const colors: string[] = [];
  if (lines[0] === 'GIMP Palette') {
    for (const line of lines.slice(1)) {
      const match = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/.exec(line);
      if (match) colors.push(toHex(match.slice(1, 4).map(Number)));
    }
  } else if (lines[0] === 'JASC-PAL') {
    for (const line of lines.slice(3)) {
      const match = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(line);
      if (match) colors.push(toHex(match.slice(1, 4).map(Number)));
    }
  } else {
    for (const line of lines) {
      if (!line || line.startsWith(';') || line.startsWith('//')) continue;
      for (const token of line.split(/[\s,;]+/)) {
        const value = token.replace(/^(#|0x)/i, '');
        if (/^[0-9a-f]{8}$/i.test(value)) { if (value.slice(0, 2).toLowerCase() !== '00') colors.push(`#${value.slice(2)}`.toUpperCase()); }
        else if (/^[0-9a-f]{6}$/i.test(value)) colors.push(`#${value}`.toUpperCase());
        else if (/^[0-9a-f]{3}$/i.test(value)) colors.push(`#${[...value].map(c => c + c).join('')}`.toUpperCase());
      }
    }
  }
  return [...new Set(colors)];
}
