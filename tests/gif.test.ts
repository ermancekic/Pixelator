import { describe, expect, it } from 'vitest';
import { applyOperations, createDocument } from '../src/engine.js';
import { encodeGif } from '../src/gif.js';
import { renderGif } from '../src/images.js';

/** Minimal independent GIF reader for the subset the encoder writes. */
function decodeGif(bytes: Buffer) {
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
  const width = bytes.readUInt16LE(6); const height = bytes.readUInt16LE(8); const packed = bytes[10];
  const tableSize = 2 << (packed & 7); let at = 13;
  const palette = Array.from({ length: tableSize }, (_, i) => `#${bytes.subarray(at + i * 3, at + i * 3 + 3).toString('hex').toUpperCase()}`);
  at += tableSize * 3;
  const frames: { indices: number[]; delayCs: number; transparentIndex: number; disposal: number }[] = [];
  let loop = false; let control = { delayCs: 0, transparentIndex: -1, disposal: 0 };
  while (bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      const label = bytes[at + 1]; at += 2;
      if (label === 0xf9) control = { disposal: bytes[at + 1] >> 2 & 7, delayCs: bytes.readUInt16LE(at + 2), transparentIndex: bytes[at + 1] & 1 ? bytes[at + 4] : -1 };
      if (label === 0xff && bytes.subarray(at + 1, at + 12).toString() === 'NETSCAPE2.0') loop = true;
      while (bytes[at] !== 0) at += bytes[at] + 1;
      at++;
      continue;
    }
    expect(bytes[at]).toBe(0x2c);
    expect([bytes.readUInt16LE(at + 5), bytes.readUInt16LE(at + 7)]).toEqual([width, height]);
    const minCodeSize = bytes[at + 10]; at += 11;
    const data: number[] = [];
    while (bytes[at] !== 0) { data.push(...bytes.subarray(at + 1, at + 1 + bytes[at])); at += bytes[at] + 1; }
    at++;
    const clear = 1 << minCodeSize; const end = clear + 1; const output: number[] = [];
    let size = minCodeSize + 1; let table: number[][] = []; let previous: number[] | null = null; let bit = 0;
    const reset = () => { table = Array.from({ length: end + 1 }, (_, i) => [i]); size = minCodeSize + 1; previous = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= (data[bit >> 3] >> (bit & 7) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === end) break;
      const entry: number[] = code < table.length ? table[code] : [...previous!, previous![0]];
      output.push(...entry);
      if (previous) table.push([...previous, entry[0]]);
      previous = entry;
      if (table.length === 1 << size && size < 12) size++;
    }
    frames.push({ indices: output, ...control });
  }
  return { width, height, palette, frames, loop };
}

describe('animated GIF export', () => {
  it('round-trips indices through LZW, including long runs that grow and reset the code table', () => {
    const palette = ['#00000000', ...Array.from({ length: 32 }, (_, i) => `#${(i * 7 + 16).toString(16).padStart(2, '0')}2040`)];
    let seed = 7; const noise = Array.from({ length: 120 * 90 }, () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % 33; });
    const runs = Array.from({ length: 64 * 64 }, (_, i) => Math.floor(i / 97) % 3);
    const decodedNoise = decodeGif(encodeGif(120, 90, palette, [{ indices: noise, delayCs: 5 }], false));
    expect(decodedNoise.frames[0].indices).toEqual(noise);
    expect(decodedNoise.loop).toBe(false);
    expect(decodedNoise.palette.slice(1, 3)).toEqual(palette.slice(1, 3));
    expect(decodeGif(encodeGif(64, 64, ['#00000000', '#FF0000', '#00FF00'], [{ indices: runs, delayCs: 2 }], true)).frames[0].indices).toEqual(runs);
    expect(decodeGif(encodeGif(1, 1, ['#00000000', '#FF0000'], [{ indices: [1], delayCs: 2 }], true)).frames[0].indices).toEqual([1]);
  });

  it('exports frames with durations, transparency, scale and the tag direction', () => {
    let doc = createDocument({
      width: 2, height: 1, palette: ['#00000000', '#FF0000', '#0000FF'],
      frames: [{ id: 'a', durationMs: 120 }, { id: 'b', durationMs: 15 }, { id: 'c', durationMs: 300 }],
      tags: [{ name: 'bounce', from: 0, to: 2, direction: 'pingpong', loop: false }, { name: 'back', from: 1, to: 2, direction: 'reverse' }],
    });
    doc = applyOperations(doc, [
      { op: 'rows', layerId: 'base', frameId: 'a', x: 0, y: 0, rows: ['1.'] },
      { op: 'rows', layerId: 'base', frameId: 'b', x: 0, y: 0, rows: ['.2'] },
      { op: 'rows', layerId: 'base', frameId: 'c', x: 0, y: 0, rows: ['12'] },
    ], { layerIds: ['base'] }).document;
    const all = decodeGif(renderGif(doc));
    expect(all).toMatchObject({ width: 2, height: 1, loop: true });
    expect(all.frames.map(frame => [frame.indices, frame.delayCs, frame.transparentIndex, frame.disposal])).toEqual([[[1, 0], 12, 0, 2], [[0, 2], 2, 0, 2], [[1, 2], 30, 0, 2]]);
    expect(all.palette.slice(0, 3)).toEqual(['#000000', '#FF0000', '#0000FF']);
    const bounce = decodeGif(renderGif(doc, { tag: 'bounce' }));
    expect(bounce.loop).toBe(false);
    expect(bounce.frames.map(frame => frame.indices)).toEqual([[1, 0], [0, 2], [1, 2], [0, 2]]);
    expect(decodeGif(renderGif(doc, { tag: 'back' })).frames.map(frame => frame.delayCs)).toEqual([30, 2]);
    const scaled = decodeGif(renderGif(doc, { scale: 2 }));
    expect([scaled.width, scaled.height]).toEqual([4, 2]);
    expect(scaled.frames[0].indices).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
    expect(() => renderGif(doc, { scale: 17 })).toThrow(expect.objectContaining({ code: 'RENDER_SIZE' }));
    expect(() => renderGif(doc, { tag: 'walk' })).toThrow(expect.objectContaining({ code: 'UNKNOWN_TAG' }));
  });
});
