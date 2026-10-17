import { memo, useEffect, useRef, useState } from 'react';
import { composite } from '../src/engine';
import type { PixelDocument, PixelLayer } from '../src/types';

// Documents are immutable; keep only the current render so history does not retain pixel buffers.
let cachedDocument: PixelDocument | undefined;
let compositeData: ImageData | undefined;
let layerData = new WeakMap<PixelLayer, ImageData>();

export function paint(canvas: HTMLCanvasElement, doc: PixelDocument, layer?: PixelLayer) {
  const scale = layer ? Math.min(1, 48 / Math.max(doc.width, doc.height)) : 1;
  const width = Math.max(1, Math.round(doc.width * scale)), height = Math.max(1, Math.round(doc.height * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  if (cachedDocument !== doc) { cachedDocument = doc; compositeData = undefined; layerData = new WeakMap(); }
  let data = layer ? layerData.get(layer) : compositeData;
  if (!data) {
    data = context.createImageData(width, height);
    if (layer) {
      const colors = doc.palette.map(color => [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255]);
      // Sample thumbnail pixels directly to avoid full-size buffers for every layer.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = layer.pixels[Math.floor((y + .5) * doc.height / height) * doc.width + Math.floor((x + .5) * doc.width / width)];
        if (index !== 0) data.data.set(colors[index], (y * width + x) * 4);
      }
    } else data.data.set(composite(doc));
    if (layer) layerData.set(layer, data); else compositeData = data;
  }
  context.putImageData(data, 0, 0);
}

export const Miniature = memo(function Miniature({ doc, layer, className = '' }: { doc: PixelDocument; layer?: PixelLayer; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paint(ref.current, doc, layer); }, [doc, layer]);
  return <canvas ref={ref} className={`miniature ${className}`} aria-label="Asset-Vorschau"/>;
});

export const AssetPreview = memo(function AssetPreview({ doc }: { doc?: PixelDocument }) {
  const [scale, setScale] = useState(1);
  const [tiled, setTiled] = useState(false);
  const [background, setBackground] = useState('checker');
  useEffect(() => () => {
    if (cachedDocument === doc) { cachedDocument = undefined; compositeData = undefined; layerData = new WeakMap(); }
  }, [doc]);
  return <section className="inspector-section preview-section">
    <div className="section-heading"><span>VORSCHAU</span><span className="muted">{scale * 100} %</span></div>
    <div className="preview-options">
      <label>Zoom<select aria-label="Vorschau-Zoom" value={scale} onChange={event => setScale(Number(event.target.value))}>{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      <label>Hintergrund<select aria-label="Vorschau-Hintergrund" value={background} onChange={event => setBackground(event.target.value)}><option value="checker">Schachbrett</option><option value="dark">Dunkel</option><option value="light">Hell</option></select></label>
      <label className="preview-tile-option"><input type="checkbox" checked={tiled} onChange={event => setTiled(event.target.checked)} disabled={!doc}/> Kacheln 3×3</label>
    </div>
    <div className={`preview-background preview-viewport ${background === 'checker' ? 'checker' : `preview-${background}`}`} tabIndex={0} role="img" aria-label={tiled ? 'Gekachelte Vorschau, 3 mal 3' : 'Asset-Vorschau'}>
      {doc ? <div className="preview-sheet" style={{ gridTemplateColumns: `repeat(${tiled ? 3 : 1}, ${doc.width * scale}px)`, gridAutoRows: doc.height * scale }}>
        {Array.from({ length: tiled ? 9 : 1 }, (_, index) => <div key={index} className="preview-cell" style={{ width: doc.width * scale, height: doc.height * scale }}><Miniature doc={doc}/></div>)}
      </div> : <span className="muted">Kein Asset ausgewählt</span>}
    </div>
  </section>;
});
