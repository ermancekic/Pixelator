import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Operation, PixelDocument, Rect } from '../src/types';
import { msg, useT } from './i18n';
import { anchorOffset } from './view-helpers';

const ANCHORS = [msg('Oben links'), msg('Oben'), msg('Oben rechts'), msg('Links'), msg('Mitte'), msg('Rechts'), msg('Unten links'), msg('Unten'), msg('Unten rechts')];

/** Grows a rectangle outward to whole tiles. */
const snapRect = (rect: Rect, tile: { width: number; height: number }): Rect => {
  const x = Math.floor(rect.x / tile.width) * tile.width, y = Math.floor(rect.y / tile.height) * tile.height;
  return { x, y, width: Math.ceil((rect.x + rect.width) / tile.width) * tile.width - x, height: Math.ceil((rect.y + rect.height) / tile.height) * tile.height - y };
};

/** Canvas size form: new size around an anchor, or a crop to the selection or the visible content. */
export function CanvasSizeDialog({ doc, tile, selection: rawSelection, content: rawContent, busy, onApply, onCancel }: { doc: PixelDocument; tile?: { width: number; height: number }; selection: Rect | null; content: Rect | null; busy: boolean; onApply: (operation: Extract<Operation, { op: 'resize_canvas' }>, label: string) => void; onCancel: () => void }) {
  const t = useT();
  const [width, setWidth] = useState(doc.width); const [height, setHeight] = useState(doc.height); const [anchor, setAnchor] = useState(4);
  // With a tile grid every size, offset and crop moves whole tiles so tile metadata stays with its pixels.
  const step = tile ?? { width: 1, height: 1 }; const selection = rawSelection && tile ? snapRect(rawSelection, tile) : rawSelection; const content = rawContent && tile ? snapRect(rawContent, tile) : rawContent;
  const valid = Number.isSafeInteger(width) && width >= 1 && Number.isSafeInteger(height) && height >= 1 && Number.isSafeInteger(width * height) && width % step.width === 0 && height % step.height === 0;
  const offsetX = Math.floor(anchorOffset(anchor % 3, doc.width, width) / step.width) * step.width; const offsetY = Math.floor(anchorOffset(Math.floor(anchor / 3), doc.height, height) / step.height) * step.height;
  const crops = width < doc.width || height < doc.height;
  const crop = (rect: Rect, label: string) => onApply({ op: 'resize_canvas', width: rect.width, height: rect.height, offsetX: -rect.x, offsetY: -rect.y }, label);
  const submit = (event: FormEvent) => { event.preventDefault(); if (valid && (width !== doc.width || height !== doc.height)) onApply({ op: 'resize_canvas', width, height, offsetX, offsetY }, t('Leinwandgröße geändert')); };
  const fitsContent = !!content && (content.width !== doc.width || content.height !== doc.height);
  return <form onSubmit={submit}>
    <p>{t('Gilt für alle Ebenen und Frames. Der Pivot wandert mit dem Inhalt. Rückgängig machen ist jederzeit möglich.')}</p>
    <div className="form-row"><label>{t('Breite')}<input type="number" min={step.width} step={step.width} value={width} onChange={event => setWidth(Number(event.target.value))} required disabled={busy}/></label><span>×</span><label>{t('Höhe')}<input type="number" min={step.height} step={step.height} value={height} onChange={event => setHeight(Number(event.target.value))} required disabled={busy}/></label></div>
    <div className="anchor-field"><span>{t('Inhalt ausrichten')}</span><div className="anchor-grid" role="radiogroup" aria-label={t('Inhalt ausrichten')}>{ANCHORS.map((label, index) => <button type="button" key={label} role="radio" aria-checked={anchor === index} aria-label={t(label)} title={t(label)} className={anchor === index ? 'selected' : ''} onClick={() => setAnchor(index)} disabled={busy}/>)}</div></div>
    {tile && <p className="form-hint-muted">{t('Kachelraster {width} × {height}: Größe, Ausrichtung und Zuschnitt bewegen ganze Kacheln.', { width: tile.width, height: tile.height })}</p>}
    {crops && <p className="form-hint">{t('Die neue Größe schneidet Pixel außerhalb der Leinwand ab. Gesperrte Ebenen verhindern das.')}</p>}
    <div className="crop-actions">
      <button type="button" className="button small" disabled={busy || !selection} onClick={() => selection && crop(selection, t('Auf Auswahl zugeschnitten'))} title={t('Leinwand auf das Auswahlrechteck verkleinern')}>{t('Auf Auswahl zuschneiden')}</button>
      <button type="button" className="button small" disabled={busy || !fitsContent} onClick={() => content && crop(content, t('Auf Inhalt zugeschnitten'))} title={t('Leinwand auf die sichtbaren Pixel aller Frames verkleinern')}>{t('Auf Inhalt zuschneiden')}</button>
    </div>
    <div className="modal-actions"><button className="button" type="button" onClick={onCancel} disabled={busy}>{t('Abbrechen')}</button><button className="button primary" type="submit" disabled={busy || !valid || (width === doc.width && height === doc.height)}>{busy ? t('Wird geändert …') : t('Größe ändern')}</button></div>
  </form>;
}
