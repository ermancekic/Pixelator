import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { composite } from '../src/engine';
import { framesFor, gifFrameIds, sheetLayout } from '../src/export-layout';
import { PALETTE_FORMATS, writePalette } from '../src/palette-formats';
import { godotTileset, tiledTileset, tiledTilesetXml, tilesetLayout, tilesetRgba } from '../src/tileset-formats';
import type { PaletteFormat } from '../src/palette-formats';
import type { PixelDocument } from '../src/types';
import { msg, useT } from './i18n';
import { Icon, IconButton } from './icons';
import { fitScale } from './view-helpers';

export type ExportFormat = 'png' | 'sheet' | 'gif' | 'tileset' | 'unity' | 'palette' | 'project';
type TileTarget = 'tsx' | 'tsj' | 'tres' | 'unity';
interface Options { scale: number; frameId: string; tag: string; columns: number; sheetJson: boolean; targets: TileTarget[]; extrude: number; spacing: number; palette: PaletteFormat; background: 'checker' | 'dark' | 'light' }
const DEFAULTS: Options = { scale: 1, frameId: '', tag: '', columns: 0, sheetJson: true, targets: ['tsx', 'tres'], extrude: 0, spacing: 0, palette: 'gpl', background: 'checker' };
const STORAGE = 'pixelator.export';
const SCALES = [1, 2, 4, 8, 16];
const FORMATS: { id: ExportFormat; icon: string; title: string; description: string }[] = [
  { id: 'png', icon: 'image', title: msg('Bild (PNG)'), description: msg('Ein Frame mit echter Transparenz') },
  { id: 'sheet', icon: 'film', title: msg('Sprite-Sheet'), description: msg('Alle Frames in einem Bild, mit Aseprite-JSON') },
  { id: 'gif', icon: 'play', title: msg('Animiertes GIF'), description: msg('Zum Teilen; spielt Richtung und Loop eines Tags') },
  { id: 'tileset', icon: 'tile', title: msg('Tileset'), description: msg('Für Tiled, Godot und Unity') },
  { id: 'unity', icon: 'cube', title: msg('Unity'), description: msg('Bild mit Import-Einstellungen und Pivot') },
  { id: 'palette', icon: 'palette', title: msg('Palette'), description: msg('GIMP, JASC oder Hex für andere Programme') },
  { id: 'project', icon: 'folder', title: msg('Projektdatei'), description: msg('Pixelator-JSON mit Verlauf zum Weiterbearbeiten') },
];
const TILE_TARGETS: { id: TileTarget; label: string }[] = [{ id: 'tsx', label: 'Tiled .tsx' }, { id: 'tsj', label: 'Tiled .tsj' }, { id: 'tres', label: 'Godot .tres' }, { id: 'unity', label: 'Unity' }];
/** The download name the server gives an asset. */
export const fileBase = (name: string) => name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'asset';
const loadOptions = (): Options => { try { return { ...DEFAULTS, ...JSON.parse(window.localStorage.getItem(STORAGE) ?? '{}') }; } catch { return DEFAULTS; } };

type Image = { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray };
interface ExportFile { name: string; url: string; detail?: string }

/** Export window: choose a format, adjust it while watching the exact result, then download its files. */
export function ExportDialog({ assetId, name, doc, frameId, revisions, initialFormat, onClose }: { assetId: string; name: string; doc: PixelDocument; frameId: string; revisions: number; initialFormat?: ExportFormat; onClose: () => void }) {
  const t = useT(); const base = fileBase(name);
  const animated = doc.frames.length > 1; const tiles = !!doc.tileset;
  const available = (format: ExportFormat) => format === 'sheet' || format === 'gif' ? animated : format === 'tileset' ? tiles : format === 'unity' ? !tiles : true;
  const [format, setFormat] = useState<ExportFormat>(() => initialFormat && available(initialFormat) ? initialFormat : tiles ? 'tileset' : 'png');
  const [options, setOptions] = useState<Options>(() => ({ ...loadOptions(), frameId }));
  const [view, setView] = useState<'image' | 'file'>('image'); const [downloading, setDownloading] = useState(false);
  const set = (changes: Partial<Options>) => setOptions(current => ({ ...current, ...changes }));
  useEffect(() => { try { const { frameId: _frame, ...stored } = options; window.localStorage.setItem(STORAGE, JSON.stringify(stored)); } catch { /* Defaults next time. */ } }, [options]);
  const frame = doc.frames.find(item => item.id === options.frameId) ?? doc.frames[0];
  const tag = doc.tags.some(item => item.name === options.tag) ? options.tag : '';
  const frameIds = useMemo(() => framesFor(doc, tag || undefined), [doc, tag]);
  const columns = options.columns > 0 ? Math.min(options.columns, frameIds.length) : frameIds.length;
  const query = (format: string, extra: Record<string, string | number | undefined> = {}) => `/api/assets/${assetId}/export?${new URLSearchParams(Object.entries({ format, ...extra }).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))}`;
  const tileOptions = { extrude: options.extrude, spacing: options.spacing };

  // Every format names its files and renders exactly what the first file will contain.
  const plan = useMemo((): { files: ExportFile[]; image?: Image; text?: { name: string; content: string }; animation?: string[]; summary?: [string, string][] } => {
    const scale = options.scale; const size = (width: number, height: number) => `${width * scale} × ${height * scale} px`;
    if (format === 'png') return { files: [{ name: `${base}.png`, url: query('png', { frameId: animated ? frame.id : undefined, scale }), detail: size(doc.width, doc.height) }], image: { width: doc.width, height: doc.height, rgba: composite(doc, frame.id) } };
    if (format === 'gif') return { files: [{ name: `${base}.gif`, url: query('gif', { tag, scale }), detail: size(doc.width, doc.height) }], animation: gifFrameIds(doc, tag || undefined) };
    if (format === 'sheet' || (format === 'unity' && animated)) {
      const layout = sheetLayout(doc, { frameIds, columns }); const rgba = new Uint8Array(layout.width * layout.height * 4);
      for (const cell of layout.cells) { const source = composite(doc, cell.frameId); for (let y = 0; y < doc.height; y++) rgba.set(source.subarray(y * doc.width * 4, (y + 1) * doc.width * 4), ((cell.y + y) * layout.width + cell.x) * 4); }
      const params = { tag, columns: options.columns > 0 ? columns : undefined, scale: format === 'unity' ? undefined : scale };
      const files = [{ name: `${base}.sheet.png`, url: query('sheet', params), detail: format === 'unity' ? `${layout.width} × ${layout.height} px` : size(layout.width, layout.height) }];
      if (format === 'unity') files.push({ name: `${base}.unity.json`, url: query('unity', { tag, columns: params.columns }), detail: t('Import-Einstellungen') });
      if (format === 'sheet' && options.sheetJson) files.push({ name: `${base}.sheet.json`, url: query('sheet-json', params), detail: 'Aseprite JSON' });
      return { files, image: { width: layout.width, height: layout.height, rgba } };
    }
    if (format === 'unity') return { files: [{ name: `${base}.png`, url: query('png'), detail: `${doc.width} × ${doc.height} px` }, { name: `${base}.unity.json`, url: query('unity'), detail: t('Import-Einstellungen') }], image: { width: doc.width, height: doc.height, rgba: composite(doc, doc.frames[0].id) } };
    if (format === 'tileset') {
      const { rgba, layout } = tilesetRgba(doc, tileOptions); const image = `${base}.tileset.png`;
      const files: ExportFile[] = [{ name: image, url: query('tileset', tileOptions), detail: `${layout.imageWidth} × ${layout.imageHeight} px · ${t(layout.tileCount === 1 ? '1 Kachel' : '{count} Kacheln', { count: layout.tileCount })}` }];
      for (const target of options.targets) files.push({ name: target === 'unity' ? `${base}.unity.json` : `${base}.${target}`, url: query(target === 'unity' ? 'unity' : target, tileOptions), detail: TILE_TARGETS.find(item => item.id === target)!.label });
      const first = options.targets.find(target => target !== 'unity');
      const text = first === 'tsx' ? tiledTilesetXml(doc, name, image, layout) : first === 'tsj' ? JSON.stringify(tiledTileset(doc, name, image, layout), null, 2) : first === 'tres' ? godotTileset(doc, image, layout) : undefined;
      return { files, image: { width: layout.imageWidth, height: layout.imageHeight, rgba }, ...(text && first ? { text: { name: `${base}.${first}`, content: text } } : {}) };
    }
    if (format === 'palette') {
      const file = `${base}.${PALETTE_FORMATS[options.palette].extension}`;
      return { files: [{ name: file, url: query(options.palette), detail: t(doc.palette.length === 2 ? '1 Farbe' : '{count} Farben', { count: doc.palette.length - 1 }) }], text: { name: file, content: writePalette(doc.palette, options.palette, name) } };
    }
    return { files: [{ name: `${base}.pixelator.json`, url: query('json'), detail: t('Projekt mit diesem Asset') }], summary: [
      [t('Größe'), `${doc.width} × ${doc.height} px`], [t('Ebenen'), String(doc.layers.length)], [t('Frames'), String(doc.frames.length)], [t('Tags'), String(doc.tags.length)],
      [t('Farben'), String(doc.palette.length - 1)], [t('Revisionen'), String(revisions)], ...(doc.tileset ? [[t('Kacheln'), `${doc.tileset.tileWidth} × ${doc.tileset.tileHeight}`] as [string, string]] : []),
    ] };
  }, [format, options, doc, frame.id, tag, frameIds, columns, revisions, base, name, t]);

  const download = async () => {
    setDownloading(true);
    // Browsers accept consecutive downloads from one click; a short pause keeps them in order.
    for (const file of plan.files) {
      const link = window.document.createElement('a'); link.href = file.url; link.download = file.name; window.document.body.append(link); link.click(); link.remove();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    setDownloading(false); onClose();
  };
  const outputPixels = plan.image ? plan.image.width * plan.image.height * (format === 'tileset' || format === 'unity' ? 1 : options.scale ** 2) : 0;
  const showText = !!plan.text && (view === 'file' || !plan.image);
  return <form className="export-dialog" onSubmit={event => { event.preventDefault(); if (!downloading && plan.files.length) void download(); }}>
    <div className="shortcuts-heading"><div><h2 id="export-title">{t('Exportieren')}</h2><p className="export-subtitle">{name}</p></div><IconButton type="button" icon="close" label={t('Export schließen')} onClick={onClose}/></div>
    <div className="export-layout">
      <nav className="export-formats" aria-label={t('Format')}>{FORMATS.map(item => {
        const enabled = available(item.id); const reason = item.id === 'tileset' ? t('Kein Kachelraster') : item.id === 'unity' ? t('Im Tileset-Export enthalten') : t('Nur für Animationen');
        return <button type="button" key={item.id} className={`export-format${format === item.id ? ' selected' : ''}`} aria-pressed={format === item.id} disabled={!enabled} title={enabled ? undefined : reason} onClick={() => { setFormat(item.id); setView('image'); }}>
          <Icon name={item.icon} size={18}/><span><strong>{t(item.title)}</strong><small>{enabled ? t(item.description) : reason}</small></span>
        </button>;
      })}</nav>
      <div className="export-main">
        <div className="export-options">
          {(format === 'png' || format === 'sheet' || format === 'gif') && <Field label={t('Größe')}><Segments value={options.scale} options={SCALES.map(value => ({ value, label: `${value}×` }))} onChange={scale => set({ scale })}/></Field>}
          {format === 'png' && animated && <Field label={t('Frame')}><Segments value={frame.id} options={doc.frames.map((item, i) => ({ value: item.id, label: String(i + 1) }))} onChange={id => set({ frameId: id })}/></Field>}
          {(format === 'sheet' || format === 'gif' || (format === 'unity' && animated)) && doc.tags.length > 0 && <Field label={t('Frames')}><Segments value={tag} options={[{ value: '', label: t('Alle') }, ...doc.tags.map(item => ({ value: item.name, label: item.name }))]} onChange={value => set({ tag: value })}/></Field>}
          {(format === 'sheet' || (format === 'unity' && animated)) && frameIds.length > 1 && <Field label={t('Spalten')}><input type="number" min="1" max={frameIds.length} value={columns} onChange={event => set({ columns: Math.max(1, Math.min(frameIds.length, Number(event.target.value) || 1)) })}/><span className="export-hint">{t(Math.ceil(frameIds.length / columns) === 1 ? '1 Zeile' : '{rows} Zeilen', { rows: Math.ceil(frameIds.length / columns) })}</span></Field>}
          {format === 'sheet' && <Field label={t('Dateien')}><label className="export-check"><input type="checkbox" checked={options.sheetJson} onChange={event => set({ sheetJson: event.target.checked })}/> {t('Aseprite-JSON mit Frames und Tags')}</label></Field>}
          {format === 'tileset' && <><Field label={t('Ziele')}>{TILE_TARGETS.map(target => <label key={target.id} className="export-check"><input type="checkbox" checked={options.targets.includes(target.id)} onChange={event => set({ targets: event.target.checked ? [...options.targets, target.id] : options.targets.filter(item => item !== target.id) })}/> {target.label}</label>)}</Field>
            <Field label={t('Kanten wiederholen')}><Segments value={options.extrude} options={[0, 1, 2].map(value => ({ value, label: `${value} px` }))} onChange={extrude => set({ extrude })}/></Field>
            <Field label={t('Abstand')}><Segments value={options.spacing} options={[0, 1, 2].map(value => ({ value, label: `${value} px` }))} onChange={spacing => set({ spacing })}/></Field></>}
          {format === 'palette' && <Field label={t('Format')}><Segments value={options.palette} options={(Object.keys(PALETTE_FORMATS) as PaletteFormat[]).map(value => ({ value, label: PALETTE_FORMATS[value].label }))} onChange={palette => set({ palette })}/></Field>}
          {format === 'unity' && <p className="export-hint">{animated ? t('Animationen werden als Sprite-Sheet mit einem Sprite pro Frame und einem Clip pro Tag beschrieben.') : t('Ein Sprite mit Point-Filter, ohne Kompression, mit Pivot.')}</p>}
          {format === 'tileset' && <p className="export-hint">{t('Bild und Beschreibung im selben Ordner ablegen; sie verweisen per Dateinamen aufeinander.')}</p>}
        </div>
        <div className="export-preview">
          <div className="export-preview-bar">
            {plan.image && plan.text ? <Segments value={view} options={[{ value: 'image' as const, label: t('Bild') }, { value: 'file' as const, label: plan.text.name }]} onChange={setView}/> : <span>{t('Vorschau')}</span>}
            {!showText && (plan.image || plan.animation) && <Segments value={options.background} options={[{ value: 'checker' as const, label: t('Schachbrett') }, { value: 'dark' as const, label: t('Dunkel') }, { value: 'light' as const, label: t('Hell') }]} onChange={background => set({ background })}/>}
          </div>
          {showText ? <pre className="export-text" aria-label={plan.text!.name}>{plan.text!.content}</pre>
            : plan.summary ? <dl className="export-summary">{plan.summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            : <PreviewCanvas doc={doc} image={plan.image} animation={plan.animation} background={options.background} label={t('Exportvorschau')}/>}
        </div>
      </div>
    </div>
    <div className="export-footer">
      <ul className="export-files" aria-label={t('Dateien')}>{plan.files.map(file => <li key={file.name}><Icon name="download" size={13}/><a href={file.url} download={file.name}>{file.name}</a>{file.detail && <span>{file.detail}</span>}</li>)}</ul>
      {outputPixels > 16_777_216 && <p className="form-hint">{t('Sehr große Ausgabe; der Export kann dauern.')}</p>}
      <div className="modal-actions"><button className="button" type="button" onClick={onClose}>{t('Abbrechen')}</button><button className="button primary" type="submit" autoFocus disabled={downloading || !plan.files.length}><Icon name="download" size={16}/>{downloading ? t('Wird exportiert …') : plan.files.length > 1 ? t('{count} Dateien exportieren', { count: plan.files.length }) : t('Exportieren')}</button></div>
    </div>
  </form>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="export-field"><span className="export-label">{label}</span><div className="export-control">{children}</div></div>;
}

function Segments<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div className="segmented" role="radiogroup">{options.map(option => <button type="button" key={String(option.value)} role="radio" aria-checked={value === option.value} className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

/** Draws the export at 1× and scales it to fit the box; integer factors stay crisp. GIFs play with their real durations. */
function PreviewCanvas({ doc, image, animation, background, label }: { doc: PixelDocument; image?: Image; animation?: string[]; background: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = boxRef.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const width = image?.width ?? doc.width, height = image?.height ?? doc.height;
  useEffect(() => {
    const canvas = canvasRef.current; const context = canvas?.getContext('2d'); if (!canvas || !context) return;
    canvas.width = width; canvas.height = height;
    const draw = (rgba: Uint8Array | Uint8ClampedArray) => context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    if (image) { draw(image.rgba); return; }
    if (!animation?.length) return;
    let index = 0; let timer = 0;
    const step = () => { const id = animation[index % animation.length]; draw(composite(doc, id)); timer = window.setTimeout(step, doc.frames.find(item => item.id === id)!.durationMs); index++; };
    step(); return () => window.clearTimeout(timer);
  }, [image, animation, doc, width, height]);
  const zoom = fitScale(width, height, box.width - 24, box.height - 24);
  return <div ref={boxRef} className={`export-canvas-box ${background === 'checker' ? 'checker' : `preview-${background}`}`}>
    <canvas ref={canvasRef} role="img" aria-label={label} style={{ width: width * zoom, height: height * zoom, imageRendering: zoom >= 1 ? 'pixelated' : 'auto' }}/>
    <span className="export-zoom">{Math.round(zoom * 100)} %</span>
  </div>;
}
