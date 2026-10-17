import { memo, useEffect, useRef, useState } from 'react';
import { composite, getFrame, readIndices } from '../src/engine';
import type { PixelDocument } from '../src/types';
import { onionFrames } from './animation-helpers';
import type { OnionSettings } from './animation-helpers';

// Documents are immutable; keep only the current document's renders so history does not retain pixel buffers.
let cachedDocument: PixelDocument | undefined;
let rendered = new Map<string, ImageData>();
const THUMBNAIL_SIZE = 48;

export type PaintOptions = { frameId?: string; layerId?: string; thumbnail?: boolean };

/** Draws one frame's composite, or a single layer of it; layer and frame thumbnails are bounded to 48 px. */
export function paint(canvas: HTMLCanvasElement, doc: PixelDocument, { frameId, layerId, thumbnail = !!layerId }: PaintOptions = {}) {
  const scale = thumbnail ? Math.min(1, THUMBNAIL_SIZE / Math.max(doc.width, doc.height)) : 1;
  const width = Math.max(1, Math.round(doc.width * scale)), height = Math.max(1, Math.round(doc.height * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  if (cachedDocument !== doc) { cachedDocument = doc; rendered = new Map(); }
  const frame = getFrame(doc, frameId);
  const key = `${frame.id}\n${layerId ?? ''}\n${thumbnail}`;
  let data = rendered.get(key);
  if (!data) {
    data = context.createImageData(width, height);
    if (thumbnail) {
      const colors = doc.palette.map(color => [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255]);
      const indices = layerId ? frame.cels[layerId] : readIndices(doc, undefined, frame.id);
      // Sample thumbnail pixels directly to avoid full-size image buffers for every layer and frame.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = indices[Math.floor((y + .5) * doc.height / height) * doc.width + Math.floor((x + .5) * doc.width / width)];
        if (index !== 0) data.data.set(colors[index], (y * width + x) * 4);
      }
    } else data.data.set(composite(doc, frame.id));
    rendered.set(key, data);
  }
  context.putImageData(data, 0, 0);
}

// Pixelorama's blue/red onion mode: previous frames blue, next frames red, opacity 0.6 / distance.
const ONION_RGB = { before: [48, 96, 255], after: [255, 64, 64] } as const;
const ONION_OPACITY = 0.6;

/** RGBA ghosts of neighboring frames for the editor canvas; a pure view that never touches the document. */
export function onionPixels(doc: PixelDocument, frameId: string, settings: OnionSettings): Uint8ClampedArray {
  const result = new Uint8ClampedArray(doc.width * doc.height * 4);
  const index = doc.frames.findIndex(frame => frame.id === frameId);
  for (const ghost of onionFrames(index, doc.frames.length, settings)) {
    const indices = readIndices(doc, undefined, doc.frames[ghost.index].id);
    const [r, g, b] = ONION_RGB[ghost.side]; const alpha = Math.round(255 * ONION_OPACITY / ghost.distance);
    for (let i = 0; i < indices.length; i++) if (indices[i]) result.set([r, g, b, alpha], i * 4);
  }
  return result;
}

export function paintOnion(canvas: HTMLCanvasElement, doc: PixelDocument, frameId: string, settings: OnionSettings) {
  if (canvas.width !== doc.width) canvas.width = doc.width;
  if (canvas.height !== doc.height) canvas.height = doc.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const data = context.createImageData(doc.width, doc.height);
  data.data.set(onionPixels(doc, frameId, settings));
  context.putImageData(data, 0, 0);
}

export const Miniature = memo(function Miniature({ doc, className = '', ...options }: { doc: PixelDocument; className?: string } & PaintOptions) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paint(ref.current, doc, options); }, [doc, options.frameId, options.layerId, options.thumbnail]);
  return <canvas ref={ref} className={`miniature ${className}`} aria-label="Asset-Vorschau"/>;
});

export const AssetPreview = memo(function AssetPreview({ doc, frameId, playing = false }: { doc?: PixelDocument; frameId?: string; playing?: boolean }) {
  const [scale, setScale] = useState(1);
  const [tiled, setTiled] = useState(false);
  const [background, setBackground] = useState('checker');
  useEffect(() => () => {
    if (cachedDocument === doc) { cachedDocument = undefined; rendered = new Map(); }
  }, [doc]);
  return <section className="inspector-section preview-section">
    <div className="section-heading"><span>VORSCHAU</span><span className="muted">{doc && doc.frames.length > 1 && `${playing ? '▶ ' : ''}FRAME ${Math.max(0, doc.frames.findIndex(frame => frame.id === frameId)) + 1}/${doc.frames.length} · `}{scale * 100} %</span></div>
    <div className="preview-options">
      <label>Zoom<select aria-label="Vorschau-Zoom" value={scale} onChange={event => setScale(Number(event.target.value))}>{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      <label>Hintergrund<select aria-label="Vorschau-Hintergrund" value={background} onChange={event => setBackground(event.target.value)}><option value="checker">Schachbrett</option><option value="dark">Dunkel</option><option value="light">Hell</option></select></label>
      <label className="preview-tile-option"><input type="checkbox" checked={tiled} onChange={event => setTiled(event.target.checked)} disabled={!doc}/> Kacheln 3×3</label>
    </div>
    <div className={`preview-background preview-viewport ${background === 'checker' ? 'checker' : `preview-${background}`}`} tabIndex={0} role="img" aria-label={tiled ? 'Gekachelte Vorschau, 3 mal 3' : 'Asset-Vorschau'}>
      {doc ? <div className="preview-sheet" style={{ gridTemplateColumns: `repeat(${tiled ? 3 : 1}, ${doc.width * scale}px)`, gridAutoRows: doc.height * scale }}>
        {Array.from({ length: tiled ? 9 : 1 }, (_, index) => <div key={index} className="preview-cell" style={{ width: doc.width * scale, height: doc.height * scale }}><Miniature doc={doc} frameId={frameId}/></div>)}
      </div> : <span className="muted">Kein Asset ausgewählt</span>}
    </div>
  </section>;
});
