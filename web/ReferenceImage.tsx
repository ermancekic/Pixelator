import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/** A tracing aid shown over or under the canvas; it is never part of the document or its exports. */
export type ReferenceImage = { url: string; name: string; opacity: number; above: boolean; visible: boolean; fit: 'contain' | 'fill' };
const STORAGE_PREFIX = 'pixelator.reference.';
// localStorage holds about 5 MB per origin; larger references stay for this session only.
const MAX_STORED_URL = 1_500_000;
const session = new Map<string, ReferenceImage>();

function stored(assetId: string): ReferenceImage | null {
  try { const value = window.localStorage.getItem(STORAGE_PREFIX + assetId); return value ? JSON.parse(value) as ReferenceImage : null; } catch { return null; }
}
function store(assetId: string, reference: ReferenceImage | null) {
  try {
    if (!reference || reference.url.length > MAX_STORED_URL) window.localStorage.removeItem(STORAGE_PREFIX + assetId);
    else window.localStorage.setItem(STORAGE_PREFIX + assetId, JSON.stringify(reference));
  } catch { /* Storage may be full or blocked; the session copy still works. */ }
}

/** The reference image of an asset, kept per asset for the session and, when small enough, in this browser. */
export function useReferenceImage(assetId: string | undefined) {
  const [reference, setReference] = useState<ReferenceImage | null>(null);
  useEffect(() => { setReference(assetId ? session.get(assetId) ?? stored(assetId) : null); }, [assetId]);
  const save = (next: ReferenceImage | null) => {
    if (!assetId) return;
    if (next) session.set(assetId, next); else session.delete(assetId);
    store(assetId, next); setReference(next);
  };
  return {
    reference,
    update: (changes: Partial<ReferenceImage>) => { if (reference) save({ ...reference, ...changes }); },
    remove: () => save(null),
    load: (file: File) => new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { save({ url: String(reader.result), name: file.name, opacity: reference?.opacity ?? .5, above: reference?.above ?? false, visible: true, fit: reference?.fit ?? 'contain' }); resolve(); };
      reader.onerror = () => reject(new Error('Das Referenzbild konnte nicht gelesen werden.'));
      reader.readAsDataURL(file);
    }),
  };
}

export function ReferenceOverlay({ reference }: { reference: ReferenceImage | null }) {
  if (!reference?.visible) return null;
  return <img className={`reference-image${reference.above ? ' above' : ''}`} src={reference.url} alt="" aria-hidden="true" draggable={false} style={{ opacity: reference.opacity, objectFit: reference.fit }}/>;
}

export function ReferencePanel({ reference, disabled, onLoad, onChange, onRemove }: { reference: ReferenceImage | null; disabled: boolean; onLoad: (file: File) => void; onChange: (changes: Partial<ReferenceImage>) => void; onRemove: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return <section className="inspector-section reference-section"><details className="compact-details"><summary>Referenzbild {reference && <span className="preset-badge">{reference.visible ? 'sichtbar' : 'aus'}</span>}</summary>
    <p>Vorlage zum Abpausen. Sie gehört nicht zum Asset und erscheint in keinem Export.</p>
    <div className="reference-actions"><button className="button small" disabled={disabled} onClick={() => fileRef.current?.click()}><Icon name="image" size={13}/> {reference ? 'Ersetzen …' : 'Bild laden …'}</button>{reference && <button className="button small" onClick={onRemove}>Entfernen</button>}</div>
    {reference && <>
      <label>Sichtbar<input type="checkbox" checked={reference.visible} onChange={event => onChange({ visible: event.target.checked })}/></label>
      <label>Deckkraft<input type="range" min="0.1" max="1" step="0.05" value={reference.opacity} aria-label="Deckkraft des Referenzbilds" onChange={event => onChange({ opacity: Number(event.target.value) })}/></label>
      <label>Lage<select value={reference.above ? 'above' : 'below'} onChange={event => onChange({ above: event.target.value === 'above' })}><option value="below">Hinter der Zeichnung</option><option value="above">Über der Zeichnung</option></select></label>
      <label>Größe<select value={reference.fit} onChange={event => onChange({ fit: event.target.value as ReferenceImage['fit'] })}><option value="contain">Seitenverhältnis halten</option><option value="fill">Leinwand füllen</option></select></label>
    </>}
    <input ref={fileRef} type="file" accept="image/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) onLoad(file); event.target.value = ''; }}/>
  </details></section>;
}
