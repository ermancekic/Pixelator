export type Point = { x: number; y: number };
export type CanvasView = { zoom: number; pan: Point };
export type Tool = 'pencil' | 'eraser' | 'shade' | 'fill' | 'eyedropper' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'selection' | 'lasso' | 'wand' | 'tile' | 'move' | 'pan';
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 24;

export function zoomAt(view: CanvasView, requestedZoom: number, anchor: Point = { x: 0, y: 0 }): CanvasView {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(requestedZoom)));
  if (zoom === view.zoom) return view;
  const ratio = zoom / view.zoom;
  return { zoom, pan: { x: anchor.x - (anchor.x - view.pan.x) * ratio, y: anchor.y - (anchor.y - view.pan.y) * ratio } };
}

export function fitCanvas(width: number, height: number, viewportWidth: number, viewportHeight: number): CanvasView {
  return { zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor((viewportWidth - 64) / width), Math.floor((viewportHeight - 64) / height))), pan: { x: 0, y: 0 } };
}

/** Scale that shows a whole image in a box: whole numbers when it grows, so pixels stay square; any fraction when it must shrink. */
export function fitScale(width: number, height: number, boxWidth: number, boxHeight: number) {
  if (width < 1 || height < 1 || boxWidth < 1 || boxHeight < 1) return 1;
  const fit = Math.min(boxWidth / width, boxHeight / height);
  return fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.01);
}

export function panFromDrag(pan: Point, start: Point, end: Point): Point {
  return { x: pan.x + end.x - start.x, y: pan.y + end.y - start.y };
}

/** Offset of the old canvas inside a resized one for an anchor column/row: 0 start, 1 center, 2 end. */
export const anchorOffset = (anchor: number, oldSize: number, newSize: number) => anchor === 0 ? 0 : anchor === 1 ? Math.floor((newSize - oldSize) / 2) : newSize - oldSize;

export const panTransform = (pan: Point) => `translate3d(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px), 0)`;

export function createPanPreview(artboard: HTMLElement, initialPan: Point) {
  let pan = initialPan;
  let frame: number | null = null;
  const render = () => { frame = null; artboard.style.transform = panTransform(pan); };
  return {
    move(next: Point) {
      pan = next;
      // Keep pointer-rate updates out of React and reuse the composited image.
      if (frame === null) frame = window.requestAnimationFrame(render);
    },
    finish() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      render();
      return pan;
    },
  };
}

type ShortcutEvent = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; isComposing?: boolean };
type Shortcut = Tool | 'undo' | 'redo' | 'export' | 'zoom-in' | 'zoom-out' | 'fit' | 'actual-size' | 'grid' | 'help' | 'cancel' | 'delete' | 'pan-start' | 'previous-frame' | 'next-frame' | 'play' | 'onion'
  | 'select-all' | 'deselect' | 'copy' | 'copy-merged' | 'cut' | 'paste' | 'paste-layer' | 'swap-colors' | 'brush-smaller' | 'brush-larger' | 'commit'
  | 'settings' | 'toggle-library' | 'toggle-timeline';
const toolKeys: Record<string, Tool> = { p: 'pencil', e: 'eraser', s: 'shade', g: 'fill', i: 'eyedropper', l: 'line', r: 'rect', o: 'ellipse', u: 'polygon', v: 'selection', q: 'lasso', w: 'wand', t: 'tile', m: 'move', h: 'pan' };
export function resolveShortcut(event: ShortcutEvent, blocked = false): Shortcut | null {
  if (blocked || event.isComposing || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'c') return event.shiftKey ? 'copy-merged' : 'copy';
    if (key === 'v') return event.shiftKey ? 'paste-layer' : 'paste';
    // Ctrl+, Ctrl+B and Ctrl+J follow VS Code: settings, side bar and bottom panel.
    if (key === ',') return 'settings';
    if (key === 'b') return 'toggle-library';
    if (key === 'j') return 'toggle-timeline';
    return key === 'y' ? 'redo' : key === 's' ? 'export' : key === 'a' ? 'select-all' : key === 'd' ? 'deselect' : key === 'x' ? 'cut' : null;
  }
  if (key === 'enter') return 'commit';
  if (key === 'x') return 'swap-colors';
  // [ and ] need AltGr on German keyboards, which reads as Ctrl+Alt; < and > work there.
  if (key === '[' || key === '<') return 'brush-smaller';
  if (key === ']' || key === '>') return 'brush-larger';
  if (key === ' ') return 'pan-start';
  if (key === '?') return 'help';
  if (key === 'escape') return 'cancel';
  if (key === 'delete' || key === 'backspace') return 'delete';
  if (key === '+' || key === '=') return 'zoom-in';
  if (key === '-') return 'zoom-out';
  if (key === '0' || key === 'f') return 'fit';
  if (key === '1') return 'actual-size';
  if (key === 'g' && event.shiftKey) return 'grid';
  if (key === 'o' && event.shiftKey) return 'onion';
  if (key === ',') return 'previous-frame';
  if (key === '.') return 'next-frame';
  if (key === 'k') return 'play';
  return toolKeys[key] ?? null;
}
