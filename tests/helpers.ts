import type { PixelDocument } from '../src/types.js';

/** Raster of a layer in a frame, addressed by position in the document's lists. */
export const cel = (doc: PixelDocument, layer = 0, frame = 0): number[] => doc.frames[frame].cels[doc.layers[layer].id];
export const setCel = (doc: PixelDocument, layer: number, pixels: number[], frame = 0) => { doc.frames[frame].cels[doc.layers[layer].id] = pixels; };
