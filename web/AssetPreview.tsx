import { useEffect, useRef, useState } from 'react';
import { composite } from '../src/engine';
import type { PixelDocument } from '../src/types';

export function paint(canvas: HTMLCanvasElement, doc: PixelDocument) {
  canvas.width = doc.width; canvas.height = doc.height;
  const context = canvas.getContext('2d');
  if (context) { const data = context.createImageData(doc.width, doc.height); data.data.set(composite(doc)); context.putImageData(data, 0, 0); }
}

export function Miniature({ doc, className = '' }: { doc: PixelDocument; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paint(ref.current, doc); }, [doc]);
  return <canvas ref={ref} className={`miniature ${className}`} aria-label="Asset-Vorschau"/>;
}

export function AssetPreview({ doc }: { doc?: PixelDocument }) {
  const [scale, setScale] = useState(1);
  const [tiled, setTiled] = useState(false);
  const [background, setBackground] = useState('checker');
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
}
