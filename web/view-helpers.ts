export type Point = { x: number; y: number };
export type CanvasView = { zoom: number; pan: Point };
export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'line' | 'rect' | 'ellipse' | 'selection' | 'move' | 'pan';
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

export function panFromDrag(pan: Point, start: Point, end: Point): Point {
  return { x: pan.x + end.x - start.x, y: pan.y + end.y - start.y };
}

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
type Shortcut = Tool | 'undo' | 'redo' | 'export' | 'zoom-in' | 'zoom-out' | 'fit' | 'actual-size' | 'grid' | 'help' | 'cancel' | 'delete' | 'pan-start' | 'previous-frame' | 'next-frame' | 'play' | 'onion';
const toolKeys: Record<string, Tool> = { p: 'pencil', e: 'eraser', g: 'fill', i: 'eyedropper', l: 'line', r: 'rect', o: 'ellipse', v: 'selection', m: 'move', h: 'pan' };
export function resolveShortcut(event: ShortcutEvent, blocked = false): Shortcut | null {
  if (blocked || event.isComposing || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    return key === 'y' ? 'redo' : key === 's' ? 'export' : null;
  }
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
