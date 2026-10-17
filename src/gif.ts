/** One image of an animated GIF: palette indices (0 is transparent) and its display time in hundredths of a second. */
export interface GifFrame { indices: ArrayLike<number>; delayCs: number }

class BitWriter {
  bytes: number[] = []; private current = 0; private bits = 0;
  write(code: number, size: number) {
    this.current |= code << this.bits; this.bits += size;
    while (this.bits >= 8) { this.bytes.push(this.current & 0xff); this.current >>= 8; this.bits -= 8; }
  }
  flush() { if (this.bits > 0) this.bytes.push(this.current & 0xff); this.current = 0; this.bits = 0; }
}

/** Variable-length LZW as GIF requires: codes grow up to 12 bits, then the table is cleared. */
function lzw(indices: ArrayLike<number>, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize; const end = clear + 1;
  const writer = new BitWriter(); const table = new Map<number, number>();
  let size = minCodeSize + 1; let next = end + 1;
  writer.write(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const symbol = indices[i]; const key = prefix << 8 | symbol;
    const known = table.get(key);
    if (known !== undefined) { prefix = known; continue; }
    writer.write(prefix, size);
    if (next < 4096) {
      table.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      writer.write(clear, size); table.clear(); size = minCodeSize + 1; next = end + 1;
    }
    prefix = symbol;
  }
  writer.write(prefix, size); writer.write(end, size); writer.flush();
  return writer.bytes;
}

const word = (value: number) => [value & 0xff, value >> 8 & 0xff];

/** GIF89a with one global palette, binary transparency at index 0 and full-frame redraws (disposal 2). */
export function encodeGif(width: number, height: number, palette: string[], frames: GifFrame[], loop: boolean): Buffer {
  if (!frames.length || palette.length > 256) throw new Error('GIF_INPUT: At least one frame and at most 256 colors are required.');
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const minCodeSize = Math.max(2, bits);
  const out: number[] = [...Buffer.from('GIF89a'), ...word(width), ...word(height), 0x80 | (bits - 1) << 4 | (bits - 1), 0, 0];
  for (let i = 0; i < 1 << bits; i++) {
    const color = palette[i] ?? '#000000';
    out.push(parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16));
  }
  if (loop) out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0);
  for (const frame of frames) {
    out.push(0x21, 0xf9, 0x04, 2 << 2 | 1, ...word(frame.delayCs), 0, 0);
    out.push(0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0, minCodeSize);
    const data = lzw(frame.indices, minCodeSize);
    for (let i = 0; i < data.length; i += 255) { const block = data.slice(i, i + 255); out.push(block.length, ...block); }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}
