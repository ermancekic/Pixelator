import { ResizablePanel } from './ResizablePanel';
import { memo, useEffect, useRef, useState } from 'react';
import { composite, getFrame, readIndices } from '../src/engine';
import type { PixelDocument } from '../src/types';
import { onionFrames } from './animation-helpers';
import type { OnionSettings } from './animation-helpers';
import { useT } from './i18n';
import { fitScale } from './view-helpers';

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
  const ref = useRef<HTMLCanvasElement>(null); const t = useT();
  useEffect(() => { if (ref.current) paint(ref.current, doc, options); }, [doc, options.frameId, options.layerId, options.thumbnail]);
  return <canvas ref={ref} className={`miniature ${className}`} aria-label={t('Asset-Vorschau')}/>;
});

const ZOOMS = ['fit', 1, 2, 4, 8] as const;
type PreviewZoom = typeof ZOOMS[number];

export const AssetPreview = memo(function AssetPreview({ doc, frameId, playing = false }: { doc?: PixelDocument; frameId?: string; playing?: boolean }) {
  const t = useT();
  const [zoom, setZoom] = useState<PreviewZoom>('fit');
  const [tiled, setTiled] = useState(false);
  const [background, setBackground] = useState('checker');
  const viewportRef = useRef<HTMLDivElement>(null); const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => () => {
    if (cachedDocument === doc) { cachedDocument = undefined; rendered = new Map(); }
  }, [doc]);
  useEffect(() => {
    const element = viewportRef.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const repeat = tiled ? 3 : 1;
  const scale = !doc ? 1 : zoom === 'fit' ? fitScale(doc.width * repeat, doc.height * repeat, box.width, box.height) : zoom;
  const cell = doc ? { width: Math.max(1, Math.round(doc.width * scale)), height: Math.max(1, Math.round(doc.height * scale)) } : { width: 0, height: 0 };
  return <ResizablePanel id="preview" label={t('Vorschau')} className="inspector-section preview-section" edge="bottom" minSize={200}>
    <div className="section-heading"><span>{t('VORSCHAU')}</span><span className="muted">{doc && doc.frames.length > 1 && `${playing ? '▶ ' : ''}${t('FRAME')} ${Math.max(0, doc.frames.findIndex(frame => frame.id === frameId)) + 1}/${doc.frames.length} · `}{Math.round(scale * 100)} %</span></div>
    <div className="preview-options">
      <div className="segmented preview-zoom" role="radiogroup" aria-label={t('Vorschau-Zoom')}>{ZOOMS.map(value => <button key={value} role="radio" aria-checked={zoom === value} className={zoom === value ? 'selected' : ''} title={value === 'fit' ? t('Ganzes Bild einpassen') : undefined} onClick={() => setZoom(value)}>{value === 'fit' ? t('Einpassen') : `${value}×`}</button>)}</div>
      <label>{t('Hintergrund')}<select aria-label={t('Vorschau-Hintergrund')} value={background} onChange={event => setBackground(event.target.value)}><option value="checker">{t('Schachbrett')}</option><option value="dark">{t('Dunkel')}</option><option value="light">{t('Hell')}</option></select></label>
      <label className="preview-tile-option"><input type="checkbox" checked={tiled} onChange={event => setTiled(event.target.checked)} disabled={!doc}/> {t('Kacheln 3×3')}</label>
    </div>
    <div ref={viewportRef} className={`preview-background preview-viewport${zoom === 'fit' ? ' is-fit' : ''} ${background === 'checker' ? 'checker' : `preview-${background}`}`} tabIndex={0} role="img" aria-label={tiled ? t('Gekachelte Vorschau, 3 mal 3') : t('Asset-Vorschau')}>
      {doc ? <div className="preview-sheet" style={{ gridTemplateColumns: `repeat(${repeat}, ${cell.width}px)`, gridAutoRows: cell.height }}>
        {Array.from({ length: repeat * repeat }, (_, index) => <div key={index} className={`preview-cell${scale < 1 ? ' smooth' : ''}`} style={{ width: cell.width, height: cell.height }}><Miniature doc={doc} frameId={frameId}/></div>)}
      </div> : <span className="muted">{t('Kein Asset ausgewählt')}</span>}
    </div>
  </ResizablePanel>;
});
