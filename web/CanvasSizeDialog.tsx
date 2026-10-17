import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Operation, PixelDocument, Rect } from '../src/types';
import { anchorOffset } from './view-helpers';

const ANCHORS = ['Oben links', 'Oben', 'Oben rechts', 'Links', 'Mitte', 'Rechts', 'Unten links', 'Unten', 'Unten rechts'];

/** Canvas size form: new size around an anchor, or a crop to the selection or the visible content. */
export function CanvasSizeDialog({ doc, selection, content, busy, onApply, onCancel }: { doc: PixelDocument; selection: Rect | null; content: Rect | null; busy: boolean; onApply: (operation: Extract<Operation, { op: 'resize_canvas' }>, label: string) => void; onCancel: () => void }) {
  const [width, setWidth] = useState(doc.width); const [height, setHeight] = useState(doc.height); const [anchor, setAnchor] = useState(4);
  const valid = Number.isSafeInteger(width) && width >= 1 && Number.isSafeInteger(height) && height >= 1 && Number.isSafeInteger(width * height);
  const offsetX = anchorOffset(anchor % 3, doc.width, width); const offsetY = anchorOffset(Math.floor(anchor / 3), doc.height, height);
  const crops = width < doc.width || height < doc.height;
  const crop = (rect: Rect, label: string) => onApply({ op: 'resize_canvas', width: rect.width, height: rect.height, offsetX: -rect.x, offsetY: -rect.y }, label);
  const submit = (event: FormEvent) => { event.preventDefault(); if (valid && (width !== doc.width || height !== doc.height)) onApply({ op: 'resize_canvas', width, height, offsetX, offsetY }, 'Leinwandgröße geändert'); };
  const fitsContent = !!content && (content.width !== doc.width || content.height !== doc.height);
  return <form onSubmit={submit}>
    <p>Gilt für alle Ebenen und Frames. Der Pivot wandert mit dem Inhalt. Rückgängig machen ist jederzeit möglich.</p>
    <div className="form-row"><label>Breite<input type="number" min="1" step="1" value={width} onChange={event => setWidth(Number(event.target.value))} required disabled={busy}/></label><span>×</span><label>Höhe<input type="number" min="1" step="1" value={height} onChange={event => setHeight(Number(event.target.value))} required disabled={busy}/></label></div>
    <div className="anchor-field"><span>Inhalt ausrichten</span><div className="anchor-grid" role="radiogroup" aria-label="Inhalt ausrichten">{ANCHORS.map((label, index) => <button type="button" key={label} role="radio" aria-checked={anchor === index} aria-label={label} title={label} className={anchor === index ? 'selected' : ''} onClick={() => setAnchor(index)} disabled={busy}/>)}</div></div>
    {crops && <p className="form-hint">Die neue Größe schneidet Pixel außerhalb der Leinwand ab. Gesperrte Ebenen verhindern das.</p>}
    <div className="crop-actions">
      <button type="button" className="button small" disabled={busy || !selection} onClick={() => selection && crop(selection, 'Auf Auswahl zugeschnitten')} title="Leinwand auf das Auswahlrechteck verkleinern">Auf Auswahl zuschneiden</button>
      <button type="button" className="button small" disabled={busy || !fitsContent} onClick={() => content && crop(content, 'Auf Inhalt zugeschnitten')} title="Leinwand auf die sichtbaren Pixel aller Frames verkleinern">Auf Inhalt zuschneiden</button>
    </div>
    <div className="modal-actions"><button className="button" type="button" onClick={onCancel} disabled={busy}>Abbrechen</button><button className="button primary" type="submit" disabled={busy || !valid || (width === doc.width && height === doc.height)}>{busy ? 'Wird geändert …' : 'Größe ändern'}</button></div>
  </form>;
}
