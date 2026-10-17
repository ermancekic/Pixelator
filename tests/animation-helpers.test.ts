import { describe, expect, it } from 'vitest';
import { nextFrameId, nextPlayback, onionFrames, playbackRange, tagHue, tagLanes, totalDuration } from '../web/animation-helpers.js';
import type { Playback } from '../web/animation-helpers.js';
import type { AnimationTag, PixelFrame } from '../src/types.js';

const tag = (name: string, from: number, to: number): AnimationTag => ({ name, from, to, direction: 'forward', loop: true });
const play = (index: number, direction: 1 | -1 = 1): Playback => ({ index, direction, playing: true });
const frames = (...ids: string[]): PixelFrame[] => ids.map((id, i) => ({ id, durationMs: 100 + i * 50, cels: {} }));
function steps(start: Playback, count: number, loop: Parameters<typeof nextPlayback>[2], range = { first: 0, last: 2 }) {
  const seen: number[] = []; let state = start;
  for (let i = 0; i < count && state.playing; i++) { state = nextPlayback(state, range, loop); seen.push(state.index); }
  return { seen, state };
}

describe('animation playback', () => {
  it('plays all frames or only the tag around the current frame', () => {
    const tags = [tag('idle', 0, 1), tag('walk', 2, 5)];
    expect(playbackRange(6, tags, 3, false)).toEqual({ first: 0, last: 5 });
    expect(playbackRange(6, tags, 3, true)).toEqual({ first: 2, last: 5 });
    expect(playbackRange(6, tags, 1, true)).toEqual({ first: 0, last: 1 });
    expect(playbackRange(4, [tag('long', 2, 9)], 3, true)).toEqual({ first: 2, last: 3 });
    expect(playbackRange(6, [], 3, true)).toEqual({ first: 0, last: 5 });
  });

  it('cycles, ping-pongs and stops once in both directions', () => {
    expect(steps(play(0), 5, 'cycle').seen).toEqual([1, 2, 0, 1, 2]);
    expect(steps(play(2, -1), 4, 'cycle').seen).toEqual([1, 0, 2, 1]);
    expect(steps(play(0), 6, 'pingpong').seen).toEqual([1, 2, 1, 0, 1, 2]);
    expect(steps(play(1, -1), 4, 'pingpong').seen).toEqual([0, 1, 2, 1]);
    const once = steps(play(0), 5, 'once');
    expect(once.seen).toEqual([1, 2, 2]);
    expect(once.state).toEqual({ index: 2, direction: 1, playing: false });
    expect(steps(play(2, -1), 5, 'once').seen).toEqual([1, 0, 0]);
  });

  it('clamps a frame chosen outside the range and stops on a single frame', () => {
    expect(nextPlayback(play(7), { first: 2, last: 4 }, 'cycle')).toMatchObject({ index: 2 });
    expect(nextPlayback(play(0), { first: 2, last: 4 }, 'cycle')).toMatchObject({ index: 3 });
    expect(nextPlayback(play(3), { first: 3, last: 3 }, 'cycle')).toEqual({ index: 3, direction: 1, playing: false });
  });
});

describe('onion skin and timeline layout', () => {
  it('selects neighbors inside the animation, farthest first and previous on top at equal distance', () => {
    expect(onionFrames(2, 5, { before: 2, after: 1 })).toEqual([
      { index: 0, distance: 2, side: 'before' }, { index: 3, distance: 1, side: 'after' }, { index: 1, distance: 1, side: 'before' },
    ]);
    expect(onionFrames(0, 3, { before: 3, after: 0 })).toEqual([]);
    expect(onionFrames(2, 3, { before: 0, after: 2 })).toEqual([]);
  });

  it('stacks overlapping tags on separate lanes and reuses free lanes', () => {
    const tags = [tag('walk', 2, 5), tag('idle', 0, 1), tag('step', 3, 3), tag('end', 6, 7)];
    expect(tagLanes(tags).map(({ tag, lane }) => [tag.name, lane])).toEqual([['idle', 0], ['walk', 0], ['step', 1], ['end', 0]]);
    expect(tagHue('walk')).toBe(tagHue('walk'));
    expect(tagHue('walk')).toBeGreaterThanOrEqual(0);
  });

  it('names new frames uniquely and sums durations', () => {
    expect(nextFrameId(frames('frame-1', 'frame-2'))).toBe('frame-3');
    expect(nextFrameId(frames('frame-1', 'frame-3'))).toBe('frame-4');
    expect(nextFrameId(frames('walk_1', 'frame-3', 'frame-4'))).toBe('frame-5');
    expect(totalDuration(frames('a', 'b', 'c'))).toBe(450);
  });
});
