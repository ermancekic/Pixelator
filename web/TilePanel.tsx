import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { readIndices } from '../src/engine';
import { activeSlots, blobMasks, CENTER, cornerMasks, edgeMasks, KEY_TILES, MAX_TERRAINS, missingCombinations, PREVIEW_SHAPE, renderTerrainMap, TEMPLATE_COLUMNS, templateRows, TERRAIN_COLORS, terrainMap, tileGrid } from '../src/tiles';
import type { AutotileTemplate } from '../src/tiles';
import type { Operation, PixelDocument, Rect, TerrainMode, TerrainType, TileInfo } from '../src/types';
import { msg, useT } from './i18n';
import { Icon } from './icons';

export type TemplateHint = { template: AutotileTemplate; x: number; y: number };
export const KEY_LABELS: Record<string, string> = { single: msg('Einzeln'), horizontal: msg('Waagerecht'), vertical: msg('Senkrecht'), cross: msg('Kreuzung'), fill: msg('Fläche') };
const MODES: { id: TerrainMode; label: string; short: string }[] = [{ id: 'mixed', label: msg('Ecken und Kanten (Blob)'), short: 'Blob' }, { id: 'edge', label: msg('Kanten'), short: msg('Kanten') }, { id: 'corner', label: msg('Ecken'), short: msg('Ecken') }];
const TEMPLATES: { id: AutotileTemplate; label: string }[] = [{ id: 'blob', label: msg('Blob · 47 Kacheln') }, { id: 'edge', label: msg('Kanten · 16 Kacheln') }, { id: 'corner', label: msg('Ecken · 15 Kacheln') }];
// Terrain widget cells in screen order, as Wang slots: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right.
const WIDGET = [7, 0, 1, 6, CENTER, 2, 5, 4, 3];
const SLOT_LABELS = [msg('oben'), msg('oben rechts'), msg('rechts'), msg('unten rechts'), msg('unten'), msg('unten links'), msg('links'), msg('oben links'), msg('Mitte')];
type Collision = 'none' | 'full' | 'top' | 'bottom' | 'left' | 'right' | 'custom';
const COLLISIONS: { id: Collision; label: string }[] = [{ id: 'none', label: msg('Keine') }, { id: 'full', label: msg('Voll') }, { id: 'top', label: msg('Obere Hälfte') }, { id: 'bottom', label: msg('Untere Hälfte') }, { id: 'left', label: msg('Linke Hälfte') }, { id: 'right', label: msg('Rechte Hälfte') }, { id: 'custom', label: msg('Eigenes Rechteck') }];
const presetRect = (preset: Collision, w: number, h: number): Rect | null => ({
  none: null, custom: null, full: { x: 0, y: 0, width: w, height: h }, top: { x: 0, y: 0, width: w, height: Math.ceil(h / 2) }, bottom: { x: 0, y: Math.floor(h / 2), width: w, height: h - Math.floor(h / 2) },
  left: { x: 0, y: 0, width: Math.ceil(w / 2), height: h }, right: { x: Math.floor(w / 2), y: 0, width: w - Math.floor(w / 2), height: h },
})[preset];
const presetOf = (collision: Rect[] | undefined, w: number, h: number): Collision => {
  if (!collision?.length) return 'none';
  if (collision.length > 1) return 'custom';
  return (['full', 'top', 'bottom', 'left', 'right'] as const).find(preset => JSON.stringify(presetRect(preset, w, h)) === JSON.stringify(collision[0])) ?? 'custom';
};
// Edited test maps survive switching assets during the session.
const shapes = new Map<string, string[]>();

export function TilePanel({ assetId, doc, frameId, layerId, editable, canDraw, tile, onApply, onHint, onSelectTile, onExport }: {
  assetId: string; doc: PixelDocument; frameId: string; layerId: string; editable: boolean; canDraw: boolean; tile: number | null;
  onApply: (operations: Operation[], label: string) => Promise<unknown>; onHint: (hint: TemplateHint | null) => void; onSelectTile: (id: number) => void; onExport: () => void;
}) {
  const t = useT(); const tileset = doc.tileset;
  const [size, setSize] = useState({ width: tileset?.tileWidth ?? 16, height: tileset?.tileHeight ?? 16 });
  const [mode, setMode] = useState<TerrainMode>(tileset?.terrainMode ?? 'mixed'); const [terrains, setTerrains] = useState<TerrainType[]>(tileset?.terrains ?? []);
  const [template, setTemplate] = useState<AutotileTemplate>('blob'); const [origin, setOrigin] = useState({ x: 0, y: 0 }); const [terrain, setTerrain] = useState(1); const [showKeys, setShowKeys] = useState(false);
  const [previewTerrain, setPreviewTerrain] = useState(1);
  const [shape, setShape] = useState<string[]>(() => shapes.get(assetId) ?? PREVIEW_SHAPE);
  useEffect(() => { setSize({ width: tileset?.tileWidth ?? 16, height: tileset?.tileHeight ?? 16 }); setMode(tileset?.terrainMode ?? 'mixed'); setTerrains(tileset?.terrains ?? []); }, [tileset?.tileWidth, tileset?.tileHeight, tileset?.terrainMode, JSON.stringify(tileset?.terrains)]);
  useEffect(() => { setShape(shapes.get(assetId) ?? PREVIEW_SHAPE); }, [assetId]);
  useEffect(() => { onHint(showKeys && tileset ? { template, ...origin } : null); }, [showKeys, template, origin.x, origin.y, !!tileset]);
  useEffect(() => () => onHint(null), []);

  if (!tileset) return <section className="inspector-section tile-section"><div className="section-heading"><span>{t('KACHELN')}</span></div>
    <p className="tile-hint">{t('Ein Kachelraster macht aus dem Asset ein Tileset: Kacheleigenschaften, Autotiles, Terrain-Testkarte und Export für Tiled, Godot und Unity.')}</p>
    <div className="tile-size-row"><label>{t('Breite')}<input type="number" min="1" value={size.width} onChange={event => setSize(current => ({ ...current, width: Number(event.target.value) }))}/></label><span>×</span><label>{t('Höhe')}<input type="number" min="1" value={size.height} onChange={event => setSize(current => ({ ...current, height: Number(event.target.value) }))}/></label>
      <button className="button small" disabled={!editable || doc.width % size.width !== 0 || doc.height % size.height !== 0} title={doc.width % size.width || doc.height % size.height ? t('Die Leinwand {width} × {height} muss ein Vielfaches der Kachelgröße sein.', { width: doc.width, height: doc.height }) : t('Kachelraster anlegen')} onClick={() => void onApply([{ op: 'tileset', tileWidth: size.width, tileHeight: size.height }], t('Kachelraster angelegt'))}>{t('Raster anlegen')}</button></div>
  </section>;

  const grid = tileGrid(tileset, doc.width, doc.height); const info: TileInfo | undefined = tile === null ? undefined : tileset.tiles.find(item => item.id === tile);
  const rows = templateRows(template); const fits = origin.x + TEMPLATE_COLUMNS <= grid.columns && origin.y + rows <= grid.rows;
  const grow: Operation[] = fits ? [] : [{ op: 'resize_canvas', width: Math.max(grid.columns, origin.x + TEMPLATE_COLUMNS) * tileset.tileWidth, height: Math.max(grid.rows, origin.y + rows) * tileset.tileHeight }];
  const terrainsChanged = mode !== tileset.terrainMode || JSON.stringify(terrains) !== JSON.stringify(tileset.terrains);
  return <section className="inspector-section tile-section">
    <div className="section-heading"><span>{t('KACHELN')}</span><span className="muted">{tileset.tileWidth} × {tileset.tileHeight} · {grid.columns} × {grid.rows}</span></div>
    {tile !== null && tile < grid.count ? <TileEditor key={`${tile}-${JSON.stringify(info)}`} id={tile} columns={grid.columns} info={info} doc={doc} editable={editable} onApply={onApply}/> : <p className="tile-hint">{t('Mit dem Kachel-Werkzeug eine Kachel wählen, um Name, Klasse, Kollision und Terrain festzulegen.')} <kbd>T</kbd></p>}
    <details className="compact-details"><summary>{t('Terrains')} <span className="preset-badge">{t(MODES.find(item => item.id === tileset.terrainMode)!.short)}</span></summary>
      <label>{t('Modus')}<select value={mode} onChange={event => setMode(event.target.value as TerrainMode)} disabled={!editable}>{MODES.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label>
      {terrains.map((item, i) => <div className="terrain-row" key={i}><input type="color" aria-label={t('Farbe von Terrain {number}', { number: i + 1 })} value={item.color} disabled={!editable} onChange={event => setTerrains(list => list.map((entry, j) => j === i ? { ...entry, color: event.target.value.toUpperCase() } : entry))}/><input aria-label={t('Name von Terrain {number}', { number: i + 1 })} value={item.name} maxLength={160} disabled={!editable} onChange={event => setTerrains(list => list.map((entry, j) => j === i ? { ...entry, name: event.target.value } : entry))}/><button className="icon-button" aria-label={t('Terrain {number} entfernen', { number: i + 1 })} title={t('Entfernen')} disabled={!editable} onClick={() => setTerrains(list => list.filter((_, j) => j !== i))}><Icon name="close" size={14}/></button></div>)}
      <div className="palette-actions"><button className="button small" disabled={!editable || terrains.length >= MAX_TERRAINS} onClick={() => setTerrains(list => [...list, { name: `Terrain ${list.length + 1}`, color: TERRAIN_COLORS[list.length] }])}>{t('Terrain hinzufügen')}</button><button className="button small" disabled={!editable || !terrainsChanged || terrains.some(item => !item.name.trim())} onClick={() => void onApply([{ op: 'tileset', terrainMode: mode, terrains: terrains.map(item => ({ ...item, name: item.name.trim() })) }], t('Terrains geändert'))}>{t('Übernehmen')}</button></div>
      <p>{t('Entfernte Terrains und Positionen, die der Modus nicht liest, werden aus den Kacheln gelöscht.')}</p>
    </details>
    <details className="compact-details" onToggle={event => setShowKeys((event.target as HTMLDetailsElement).open)}><summary>{t('Autotile-Vorlage')}</summary>
      <label>{t('Vorlage')}<select value={template} onChange={event => setTemplate(event.target.value as AutotileTemplate)}>{TEMPLATES.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label>
      <label>{t('Start (Spalte, Zeile)')}<span className="tile-origin"><input type="number" min="0" aria-label={t('Startspalte der Vorlage')} value={origin.x} onChange={event => setOrigin(current => ({ ...current, x: Math.max(0, Number(event.target.value)) }))}/><input type="number" min="0" aria-label={t('Startzeile der Vorlage')} value={origin.y} onChange={event => setOrigin(current => ({ ...current, y: Math.max(0, Number(event.target.value)) }))}/></span></label>
      <label>{t('Terrain')}<select value={terrain} onChange={event => setTerrain(Number(event.target.value))}>{Array.from({ length: Math.max(1, tileset.terrains.length) }, (_, i) => <option key={i} value={i + 1}>{tileset.terrains[i]?.name ?? t('Terrain 1 (neu)')}</option>)}</select></label>
      <p>{t(template === 'edge' ? 'Zeichne in der ersten Vorlagenreihe die vier markierten Schlüsselkacheln: {keys}. Alle übrigen Kacheln entstehen aus ihren Vierteln und erhalten Terrain-Labels.' : 'Zeichne in der ersten Vorlagenreihe die fünf markierten Schlüsselkacheln: {keys}. Alle übrigen Kacheln entstehen aus ihren Vierteln und erhalten Terrain-Labels.', { keys: KEY_TILES.slice(0, template === 'edge' ? 4 : 5).map(key => t(KEY_LABELS[key.kind])).join(', ') })}{!fits && ` ${t('Die Leinwand wird dafür vergrößert.')}`}</p>
      <button className="button small" disabled={!canDraw || tileset.tileWidth % 2 !== 0 || tileset.tileHeight % 2 !== 0} title={tileset.tileWidth % 2 || tileset.tileHeight % 2 ? t('Autotiles brauchen eine gerade Kachelbreite und -höhe.') : t('Fehlende Kacheln aus den Schlüsselkacheln erzeugen')} onClick={() => void onApply([...grow, { op: 'autotile', layerId, frameId, template, x: origin.x, y: origin.y, terrain }], t('Autotiles erzeugt'))}>{t('Vorlage vervollständigen')}</button>
    </details>
    {tileset.terrains.length > 0 && <TerrainPreview doc={doc} frameId={frameId} terrain={Math.min(previewTerrain, tileset.terrains.length)} shape={shape} onTerrain={setPreviewTerrain} onShape={next => { shapes.set(assetId, next); setShape(next); }} onSelectTile={onSelectTile}/>}
    <button className="button small wide tile-export" onClick={onExport}><Icon name="export" size={13}/> {t('Tileset exportieren …')}</button>
    <details className="compact-details"><summary>{t('Raster ändern')}</summary>
      <div className="tile-size-row"><label>{t('Breite')}<input type="number" min="1" value={size.width} onChange={event => setSize(current => ({ ...current, width: Number(event.target.value) }))}/></label><span>×</span><label>{t('Höhe')}<input type="number" min="1" value={size.height} onChange={event => setSize(current => ({ ...current, height: Number(event.target.value) }))}/></label></div>
      <div className="palette-actions"><button className="button small" disabled={!editable || (size.width === tileset.tileWidth && size.height === tileset.tileHeight) || doc.width % size.width !== 0 || doc.height % size.height !== 0} onClick={() => void onApply([{ op: 'tileset', tileWidth: size.width, tileHeight: size.height }], t('Kachelgröße geändert'))}>{t('Größe übernehmen')}</button><button className="button small" disabled={!editable} onClick={() => { if (window.confirm(t('Kachelraster samt Kachel-Metadaten entfernen? Die Pixel bleiben erhalten.'))) void onApply([{ op: 'remove_tileset' }], t('Kachelraster entfernt')); }}>{t('Raster entfernen')}</button></div>
      <p>{t('Eine neue Kachelgröße setzt die Kachel-Metadaten zurück, weil sich die Nummerierung ändert.')}</p>
    </details>
  </section>;
}

function TileEditor({ id, columns, info, doc, editable, onApply }: { id: number; columns: number; info: TileInfo | undefined; doc: PixelDocument; editable: boolean; onApply: (operations: Operation[], label: string) => Promise<unknown> }) {
  const t = useT();
  const tileset = doc.tileset!; const { tileWidth: w, tileHeight: h } = tileset;
  const [name, setName] = useState(info?.name ?? ''); const [type, setType] = useState(info?.type ?? ''); const [probability, setProbability] = useState(String(info?.probability ?? 1));
  const [collision, setCollision] = useState<Collision>(presetOf(info?.collision, w, h)); const [custom, setCustom] = useState<Rect>(info?.collision?.[0] ?? { x: 0, y: 0, width: w, height: h });
  const [terrain, setTerrain] = useState<number[]>(info?.terrain ?? new Array(9).fill(0));
  const slots = activeSlots(tileset.terrainMode); const count = tileset.terrains.length;
  const cycle = (slot: number, step: number) => setTerrain(current => current.map((value, i) => i === slot ? (value + step + count + 1) % (count + 1) : value));
  const rect = collision === 'custom' ? custom : presetRect(collision, w, h);
  const customValid = collision !== 'custom' || (custom.width >= 1 && custom.height >= 1 && custom.x >= 0 && custom.y >= 0 && custom.x + custom.width <= w && custom.y + custom.height <= h);
  const save = () => void onApply([{ op: 'tile_properties', tiles: [{
    id, name: name.trim() || null, type: type.trim() || null, probability: Number(probability) === 1 ? null : Number(probability),
    collision: rect ? [rect] : null, terrain: terrain.some(Boolean) ? terrain : null,
  }] }], t('Kachel {id} geändert', { id }));
  return <div className="tile-editor">
    <div className="tile-editor-heading"><strong>{t('Kachel {id}', { id })}</strong><span className="muted">{t('Spalte {column} · Zeile {row}', { column: id % columns, row: Math.floor(id / columns) })}</span></div>
    <label>{t('Name')}<input value={name} maxLength={80} placeholder={t('z. B. Gras')} disabled={!editable} onChange={event => setName(event.target.value)}/></label>
    <label title={t('Klasse bzw. Typ, den Engines auswerten (Tiled: type)')}>{t('Klasse')}<input value={type} maxLength={80} placeholder={t('z. B. ground')} disabled={!editable} onChange={event => setType(event.target.value)}/></label>
    <label title={t('Gewichtung, wenn mehrere Kacheln dasselbe Terrain-Muster haben')}>{t('Häufigkeit')}<input type="number" min="0" max="1000" step="0.1" value={probability} disabled={!editable} onChange={event => setProbability(event.target.value)}/></label>
    <label>{t('Kollision')}<select value={collision} disabled={!editable} onChange={event => setCollision(event.target.value as Collision)}>{COLLISIONS.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label>
    {collision === 'custom' && <div className="collision-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <input key={key} type="number" min={key === 'x' || key === 'y' ? 0 : 1} aria-label={t('Kollision {field}', { field: key })} title={key} value={custom[key]} disabled={!editable} onChange={event => setCustom(current => ({ ...current, [key]: Number(event.target.value) }))}/>)}</div>}
    <div className="terrain-field"><span>{t('Terrain')}{!count && <small> {t('(zuerst Terrains anlegen)')}</small>}</span>
      <div className="terrain-widget" role="group" aria-label={t('Terrain-Labels der Kachel')}>{WIDGET.map(slot => {
        const value = terrain[slot]; const active = !!count && (slot === CENTER || slots.includes(slot));
        return <button key={slot} className={`terrain-cell${slot === CENTER ? ' center' : ''}`} disabled={!editable || !active} style={{ '--terrain': value ? tileset.terrains[value - 1]?.color : 'transparent' } as CSSProperties}
          title={`${t(SLOT_LABELS[slot])}: ${value ? tileset.terrains[value - 1]?.name : t('leer')} · ${t('Klick: nächstes, Rechtsklick: vorheriges Terrain')}`} aria-label={t('Terrain {slot}: {name}', { slot: t(SLOT_LABELS[slot]), name: value ? tileset.terrains[value - 1]?.name ?? '' : t('leer') })}
          onClick={() => cycle(slot, 1)} onContextMenu={event => { event.preventDefault(); cycle(slot, -1); }}>{value || ''}</button>;
      })}</div></div>
    <button className="button small" disabled={!editable || !customValid || !(Number(probability) >= 0)} onClick={save}>{t('Kachel übernehmen')}</button>
  </div>;
}

/** A small editable map painted with the labeled tiles; clicking toggles terrain on a cell (or a vertex for corner sets). */
function TerrainPreview({ doc, frameId, terrain, shape, onTerrain, onShape, onSelectTile }: { doc: PixelDocument; frameId: string; terrain: number; shape: string[]; onTerrain: (terrain: number) => void; onShape: (shape: string[]) => void; onSelectTile: (id: number) => void }) {
  const t = useT();
  const tileset = doc.tileset!; const canvasRef = useRef<HTMLCanvasElement>(null);
  const map = useMemo(() => terrainMap(tileset, terrain, shape), [tileset, terrain, shape]);
  // The heading counts every combination the mode needs, not only those the sample shape happens to contain.
  const missing = useMemo(() => missingCombinations(tileset, terrain).length, [tileset, terrain]);
  const expected = (tileset.terrainMode === 'corner' ? cornerMasks() : tileset.terrainMode === 'edge' ? edgeMasks() : blobMasks()).length;
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const image = renderTerrainMap(map, tileset, readIndices(doc, undefined, frameId), doc.palette, doc.width);
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(image.rgba as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  }, [map, doc, frameId]);
  const corner = tileset.terrainMode === 'corner';
  const click = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width * map.columns, fy = (event.clientY - box.top) / box.height * map.rows;
    const x = corner ? Math.round(fx) : Math.floor(fx), y = corner ? Math.round(fy) : Math.floor(fy);
    if (event.altKey) { const id = map.tiles[Math.floor(fy) * map.columns + Math.floor(fx)]; if (id !== null && id >= 0) onSelectTile(id); return; }
    if (y < 0 || y >= shape.length || x < 0 || x >= shape[y].length) return;
    onShape(shape.map((row, ry) => ry !== y ? row : row.slice(0, x) + (row[x] === '#' ? '.' : '#') + row.slice(x + 1)));
  };
  return <div className="terrain-preview">
    <div className="terrain-preview-heading"><span>{t('Testkarte')}</span>{tileset.terrains.length > 1 && <select aria-label={t('Terrain der Testkarte')} value={terrain} onChange={event => onTerrain(Number(event.target.value))}>{tileset.terrains.map((item, i) => <option key={i} value={i + 1}>{item.name}</option>)}</select>}<span className={missing ? 'terrain-missing' : 'muted'} title={map.missing ? t('{count} Zellen dieser Karte ohne Kachel', { count: map.missing }) : undefined}>{missing ? t('{missing} von {count} Kombinationen fehlen', { missing, count: expected }) : t('alle {count} Kombinationen', { count: expected })}</span></div>
    <canvas ref={canvasRef} className="terrain-canvas checker" onClick={click} title={corner ? t('Klick schaltet Terrain an einer Ecke um · Alt+Klick wählt die Kachel') : t('Klick schaltet Terrain in einer Zelle um · Alt+Klick wählt die Kachel')} aria-label={t('Terrain-Testkarte')}/>
    <p>{t('Magenta: Kombination ohne Kachel. Die Karte nutzt dieselbe Auswahl wie die Prüfung per MCP.')}</p>
  </div>;
}

