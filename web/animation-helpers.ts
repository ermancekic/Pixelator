import type { AnimationTag, PixelFrame } from '../src/types';

export type LoopMode = 'once' | 'cycle' | 'pingpong';
export interface Playback { index: number; direction: 1 | -1; playing: boolean }
export interface FrameRange { first: number; last: number }
export interface OnionSettings { before: number; after: number }

/** All frames, or with onlyTag the first tag containing the current frame (Pixelorama's calculate_start_end). */
export function playbackRange(frameCount: number, tags: AnimationTag[], index: number, onlyTag: boolean): FrameRange {
  const tag = onlyTag ? tags.find(item => index >= item.from && index <= item.to) : undefined;
  return tag ? { first: tag.from, last: Math.min(frameCount - 1, tag.to) } : { first: 0, last: frameCount - 1 };
}

/** Advances playback by one frame, mirroring Pixelorama's timer for the three loop modes in both directions. */
export function nextPlayback(state: Playback, range: FrameRange, loop: LoopMode): Playback {
  if (range.first >= range.last) return { ...state, index: range.first, playing: false };
  const index = Math.max(range.first, Math.min(range.last, state.index));
  const end = state.direction === 1 ? range.last : range.first;
  if (index !== end) return { ...state, index: index + state.direction };
  if (loop === 'once') return { ...state, index, playing: false };
  if (loop === 'cycle') return { ...state, index: state.direction === 1 ? range.first : range.last };
  const direction = state.direction === 1 ? -1 : 1;
  return { ...state, direction, index: index + direction };
}

/** Neighbor frames to draw behind the current one, farthest first so nearer frames end on top. */
export function onionFrames(index: number, frameCount: number, { before, after }: OnionSettings): { index: number; distance: number; side: 'before' | 'after' }[] {
  const result: { index: number; distance: number; side: 'before' | 'after' }[] = [];
  for (let distance = Math.max(before, after); distance >= 1; distance--) {
    if (distance <= after && index + distance < frameCount) result.push({ index: index + distance, distance, side: 'after' });
    if (distance <= before && index - distance >= 0) result.push({ index: index - distance, distance, side: 'before' });
  }
  return result;
}

/** Places overlapping tags on separate rows so every range stays visible above the frame strip. */
export function tagLanes(tags: AnimationTag[]): { tag: AnimationTag; lane: number }[] {
  const ends: number[] = [];
  return [...tags].sort((a, b) => a.from - b.from || a.to - b.to).map(tag => {
    let lane = ends.findIndex(end => end < tag.from);
    if (lane < 0) { lane = ends.length; ends.push(tag.to); } else ends[lane] = tag.to;
    return { tag, lane };
  });
}

/** A stable hue per tag name for its timeline bar. */
export const tagHue = (name: string) => [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);

/** The first "frame-N" ID not used by the document. */
export function nextFrameId(frames: PixelFrame[]): string {
  const used = new Set(frames.map(frame => frame.id));
  let n = frames.length + 1;
  while (used.has(`frame-${n}`)) n++;
  return `frame-${n}`;
}

export const totalDuration = (frames: PixelFrame[]) => frames.reduce((sum, frame) => sum + frame.durationMs, 0);
