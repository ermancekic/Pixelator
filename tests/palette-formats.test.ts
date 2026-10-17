import { describe, expect, it } from 'vitest';
import { readPalette, writePalette } from '../src/palette-formats.js';

const palette = ['#00000000', '#0F380F', '#8bac0f', '#FFFFFF'];

describe('palette files', () => {
  it.each(['gpl', 'hex', 'pal'] as const)('round-trips %s without the transparent index', format => {
    expect(readPalette(writePalette(palette, format, 'Test'))).toEqual(['#0F380F', '#8BAC0F', '#FFFFFF']);
  });

  it('reads GIMP palettes with names, comments and tab-separated labels', () => {
    expect(readPalette('GIMP Palette\nName: Demo\nColumns: 4\n# comment\n  0   0   0\tBlack\n255 128   0 Orange\n')).toEqual(['#000000', '#FF8000']);
  });

  it('reads Lospec hex lists, CSS colors, Paint.NET AARRGGBB and drops duplicates and transparent entries', () => {
    expect(readPalette('﻿; paint.net palette\nFFFF0000\n00FFFFFF\n#ff0000, #0f0 0x0000FF\n// note\nabcdef\n')).toEqual(['#FF0000', '#00FF00', '#0000FF', '#ABCDEF']);
  });

  it('rejects channels above 255', () => {
    expect(() => readPalette('JASC-PAL\n0100\n1\n300 0 0\n')).toThrow('INVALID_PALETTE');
  });
});
