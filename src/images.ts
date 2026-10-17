import { PNG } from 'pngjs';
import { composite, createDocument } from './engine.js';
import { AppError } from './store.js';
import type { PixelDocument } from './types.js';

export function renderPng(document: PixelDocument, scale = 1): Buffer {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new AppError('RENDER_SIZE', 'Zoom muss ganzzahlig sein und zwischen 1 und 32 liegen.');
  const rgba = composite(document);
  const png = new PNG({ width: document.width * scale, height: document.height * scale });
  if (scale === 1) png.data.set(rgba);
  else for (let y = 0; y < document.height; y++) {
    const row = y * scale * png.width * 4;
    for (let x = 0; x < document.width; x++) {
      const src = (y * document.width + x) * 4;
      for (let dx = 0; dx < scale; dx++) {
        const dest = row + (x * scale + dx) * 4;
        png.data[dest] = rgba[src]; png.data[dest + 1] = rgba[src + 1];
        png.data[dest + 2] = rgba[src + 2]; png.data[dest + 3] = rgba[src + 3];
      }
    }
    for (let dy = 1; dy < scale; dy++) png.data.copyWithin(row + dy * png.width * 4, row, row + png.width * 4);
  }
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
  document.layers[0].pixels = pixels;
  return document;
}

export function unityManifest(assetId: string, revisionId: string, name: string, doc: PixelDocument) {
  return {
    schemaVersion: 1, assetId, revisionId, name, width: doc.width, height: doc.height,
    pixelsPerUnit: 32, pivot: { x: doc.pivot.x / doc.width, y: 1 - doc.pivot.y / doc.height },
    pivotCoordinateSystem: 'normalized, bottom-left origin',
    textureImporter: { textureType: 'Sprite', spriteMode: 'Single', filterMode: 'Point', textureCompression: 'Uncompressed', mipmapEnabled: false, alphaIsTransparency: true, wrapMode: 'Clamp', spriteMeshType: 'FullRect' },
  };
}
