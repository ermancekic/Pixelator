import { PNG } from 'pngjs';
import { tilesetRgba } from './tileset-formats.js';
import type { TilesetExportOptions, TilesetLayout } from './tileset-formats.js';
import type { PixelDocument } from './types.js';
export * from './tileset-formats.js';

/** The tileset image as PNG. */
export function renderTilesetImage(doc: PixelDocument, options: TilesetExportOptions = {}): { png: Buffer; layout: TilesetLayout } {
  const { rgba, layout } = tilesetRgba(doc, options);
  const png = new PNG({ width: layout.imageWidth, height: layout.imageHeight });
  png.data.set(rgba);
  return { png: PNG.sync.write(png), layout };
}
