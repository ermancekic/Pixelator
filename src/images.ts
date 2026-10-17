import { PNG } from 'pngjs';
import { composite, createDocument } from './engine.js';
import { AppError } from './store.js';
import type { PixelDocument } from './types.js';

export function renderPng(document: PixelDocument, scale = 1): Buffer {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32 || Math.max(document.width, document.height) * scale > 1024) throw new AppError('RENDER_SIZE', 'Zoom muss ganzzahlig sein und die Vorschau darf höchstens 1024 Pixel groß werden.');
  const rgba = composite(document);
  const png = new PNG({ width: document.width * scale, height: document.height * scale });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const src = (Math.floor(y / scale) * document.width + Math.floor(x / scale)) * 4;
    png.data.set(rgba.subarray(src, src + 4), (y * png.width + x) * 4);
  }
  return PNG.sync.write(png);
}

export function importPng(base64: string, maxColors: number, paletteLocked = false): PixelDocument {
  const bytes = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new AppError('PNG_REQUIRED', 'Eine gültige PNG-Datei ist erforderlich.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 64 || height > 64) throw new AppError('PNG_SIZE', 'Importe dürfen höchstens 64×64 Pixel groß sein.');
  let image: PNG;
  try { image = PNG.sync.read(bytes, { checkCRC: true }); }
  catch { throw new AppError('PNG_INVALID', 'Die PNG-Datei konnte nicht verlustfrei gelesen werden.'); }
  const palette = ['#00000000'];
  const pixels: number[] = [];
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3];
    if (alpha !== 0 && alpha !== 255) throw new AppError('PARTIAL_ALPHA', 'Teiltransparente Pixel werden nicht automatisch verändert. Bitte vorher ausdrücklich konvertieren.');
    if (!alpha) { pixels.push(0); continue; }
    const color = `#${image.data.subarray(i, i + 3).toString('hex').toUpperCase()}`;
    let index = palette.indexOf(color);
    if (index === -1) { palette.push(color); index = palette.length - 1; }
    if (palette.length - 1 > maxColors) throw new AppError('PALETTE_LIMIT', `Das Bild enthält mehr als ${maxColors} Farben. Keine automatische Quantisierung.`);
    pixels.push(index);
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
