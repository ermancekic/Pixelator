import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { applyOperations, composite } from '../src/engine';
import { fitCanvas, MAX_ZOOM, MIN_ZOOM, panFromDrag, resolveShortcut, zoomAt } from './view-helpers';
import type { CanvasView, Point, Tool } from './view-helpers';
import type { ApplyResult, Asset, AssetDetail, AssetType, EditScope, McpStatus, Operation, PixelDocument, PixelStyle, Project, ProjectStyle, Rect, Revision } from '../src/types';

type Dialog = 'project' | 'asset' | 'variant' | 'shortcuts' | 'mcp' | null;
const typeLabels: Record<AssetType, string> = { character: 'Charakter', item: 'Item', prop: 'Prop', ui: 'UI-Icon' };
const tools: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'pencil', label: 'Stift', key: 'P', icon: 'pencil' }, { id: 'eraser', label: 'Radierer', key: 'E', icon: 'eraser' },
  { id: 'fill', label: 'Füllen', key: 'G', icon: 'fill' }, { id: 'eyedropper', label: 'Pipette', key: 'I', icon: 'dropper' },
  { id: 'line', label: 'Linie', key: 'L', icon: 'line' }, { id: 'rect', label: 'Rechteck', key: 'R', icon: 'rect' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse' }, { id: 'selection', label: 'Auswahl', key: 'V', icon: 'selection' },
  { id: 'move', label: 'Verschieben', key: 'M', icon: 'move' },
  { id: 'pan', label: 'Ansicht verschieben', key: 'H', icon: 'hand' },
];
const paths: Record<string, ReactNode> = {
  pencil: <><path d="m4 16-1 5 5-1L20 8l-4-4Z"/><path d="m14 6 4 4"/></>,
  eraser: <><path d="m4 13 9-9 7 7-9 9H7l-4-4Z"/><path d="m8 9 7 7M11 20h10"/></>,
  fill: <><path d="m5 5 11 11M7 3l11 11-7 7L1 11Z"/><path d="M20 13s-3 3-3 5a3 3 0 0 0 6 0c0-2-3-5-3-5Z"/></>,
  dropper: <><path d="m14 5 5 5M3 21l2-6L17 3l4 4L9 19Z"/><path d="m4 16 4 4"/></>,
  line: <><path d="m4 20 16-16"/><path d="M3 17v4h4M17 3h4v4"/></>,
  rect: <rect x="4" y="5" width="16" height="14" rx="1"/>,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="7"/>,
  selection: <rect x="4" y="4" width="16" height="16" strokeDasharray="3 3"/>,
  move: <><path d="M12 2v20M2 12h20m-13-7 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/></>,
  undo: <><path d="M8 4 3 9l5 5M3 9h11a7 7 0 0 1 0 14"/></>,
  redo: <><path d="m16 4 5 5-5 5m5-5H10a7 7 0 0 0 0 14"/></>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  hidden: <><path d="m3 3 18 18M9 5c7-2 13 7 13 7l-3 4M15 19C8 21 2 12 2 12l3-4"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7-3"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
  layers: <><path d="m12 2 10 6-10 6L2 8Zm-9 11 9 6 9-6M3 18l9 5 9-5"/></>,
  folder: <path d="M2 6h8l2 3h10v12H2Z"/>, search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
  spark: <><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/><path d="M21 2v4m-2-2h4"/></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  history: <><path d="M3 11a9 9 0 1 1 3 8M3 3v8h8"/><path d="M12 7v6l4 2"/></>,
  arrow: <path d="m7 14 5-5 5 5"/>, import: <><path d="M12 15V3m-5 5 5-5 5 5M4 14v7h16v-7"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  hand: <path d="M8 12V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-7a2 2 0 0 1 4 0v11c0 4-3 6-7 6h-1c-2 0-4-1-5-3l-4-5a2 2 0 0 1 3-3l2 3"/>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/></>,
  server: <><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/></>,
  play: <path d="m8 4 12 8-12 8Z"/>, stop: <rect x="5" y="5" width="14" height="14" rx="1"/>,
};
function Icon({ name, size = 18 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.rect}</svg>; }
function IconButton({ icon, label, active, children, className = '', ...props }: { icon: string; label: string; active?: boolean; children?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`icon-button${active ? ' active' : ''} ${className}`} aria-label={label} aria-pressed={active} title={label} {...props}><Icon name={icon}/>{children}</button>; }
async function api<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `Anfrage fehlgeschlagen (${response.status})`);
  return data as T;
}
const requestId = () => crypto.randomUUID();
const between = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 });
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
const fullScope = (doc: PixelDocument): EditScope => ({ layerIds: doc.layers.map(l => l.id), allowLayerChanges: true, allowPaletteChanges: true });
function paint(canvas: HTMLCanvasElement, doc: PixelDocument) {
  canvas.width = doc.width; canvas.height = doc.height;
  const context = canvas.getContext('2d');
  if (context) { const data = context.createImageData(doc.width, doc.height); data.data.set(composite(doc)); context.putImageData(data, 0, 0); }
}
function Miniature({ doc, className = '' }: { doc: PixelDocument; className?: string }) { const ref = useRef<HTMLCanvasElement>(null); useEffect(() => { if (ref.current) paint(ref.current, doc); }, [doc]); return <canvas ref={ref} className={`miniature ${className}`} aria-label="Asset-Vorschau"/>; }

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]); const [projectId, setProjectId] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]); const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [search, setSearch] = useState(''); const [typeFilter, setTypeFilter] = useState('');
  const [tool, setTool] = useState<Tool>('pencil'); const [colorIndex, setColor] = useState(1); const [layerId, setLayerId] = useState('');
  const [view, setView] = useState<CanvasView>({ zoom: 12, pan: { x: 0, y: 0 } }); const [grid, setGrid] = useState(true); const [filled, setFilled] = useState(false); const [copyMode, setCopyMode] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false); const [panning, setPanning] = useState(false); const zoom = view.zoom;
  const [selection, setSelection] = useState<Rect | null>(null); const [cursor, setCursor] = useState<Point | null>(null);
  const [preview, setPreview] = useState<PixelDocument | null>(null); const [revisions, setRevisions] = useState<Revision[]>([]);
  const [viewRevision, setViewRevision] = useState<Revision | null>(null); const [undoStack, setUndoStack] = useState<string[]>([]); const [redoStack, setRedoStack] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [connected, setConnected] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null); const [rightTab, setRightTab] = useState<'layers' | 'history'>('layers'); const [libraryOpen, setLibraryOpen] = useState(true);
  const [presets, setPresets] = useState<Record<PixelStyle, ProjectStyle> | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null); const [mcpBusy, setMcpBusy] = useState(false); const [mcpError, setMcpError] = useState(''); const [mcpNow, setMcpNow] = useState(Date.now);
  const [newName, setNewName] = useState(''); const [newType, setNewType] = useState<AssetType>('character'); const [newSize, setNewSize] = useState({ width: 32, height: 32 });
  const [newPreset, setNewPreset] = useState<PixelStyle>('16-bit'); const [prompt, setPrompt] = useState(''); const [paletteText, setPaletteText] = useState(''); const [colorDraft, setColorDraft] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null); const stageRef = useRef<HTMLDivElement>(null); const modalRef = useRef<HTMLElement>(null); const fileRef = useRef<HTMLInputElement>(null); const projectFileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false); const loadingRef = useRef(loading); const detailRef = useRef(detail); const projectIdRef = useRef(projectId); const assetLoadId = useRef(0); const assetListRequestId = useRef(0); const historyRequestId = useRef(0); const attemptedAutoOpen = useRef('');
  const stroke = useRef<{ pointerId: number; start: Point; last: Point; base: PixelDocument; points: [number, number, number][]; operations: Operation[]; scope: EditScope; tool: Tool; copy: boolean; previousSelection: Rect | null } | null>(null);
  const spaceHeldRef = useRef(false); const viewRef = useRef(view); const dialogRef = useRef(dialog); const modalTriggerRef = useRef<HTMLElement | null>(null);
  const panDrag = useRef<{ pointerId: number; start: Point; pan: Point } | null>(null);
  viewRef.current = view; dialogRef.current = dialog;
  detailRef.current = detail; busyRef.current = busy; loadingRef.current = loading; projectIdRef.current = projectId;
  const project = projects.find(p => p.id === projectId); const document = preview ?? viewRevision?.document ?? detail?.revision.document; const activeLayer = document?.layers.find(l => l.id === layerId);
  const color = Math.min(colorIndex, (document?.palette.length ?? 2) - 1);
  const validation = viewRevision?.validation ?? detail?.revision.validation;
  const viewingPast = !!viewRevision && viewRevision.id !== detail?.asset.headRevisionId;
  const editable = !!detail && !busy && !loading && !viewingPast; const canDraw = editable && !!activeLayer && activeLayer.visible && !activeLayer.locked;
  const mcpLabel = !connected ? 'Nicht verbunden' : !mcpStatus ? 'Status wird geladen' : !mcpStatus.running ? 'Gestoppt' : mcpStatus.activeRequests ? 'Aktiv' : 'Bereit';
  const mcpUptime = mcpStatus?.startedAt ? Math.max(0, Math.floor((mcpNow - Date.parse(mcpStatus.startedAt)) / 1000)) : 0;

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 4500); };
  const loadAssets = useCallback(async () => { const serial = ++assetListRequestId.current; if (!projectId) { setAssets([]); return; } try { const next = await api<Asset[]>(`/assets?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(search)}&type=${typeFilter}`); if (projectId === projectIdRef.current && serial === assetListRequestId.current) setAssets(next); } catch (e) { setError((e as Error).message); } }, [projectId, search, typeFilter]);
  const loadHistory = useCallback(async (id: string) => {
    const serial = ++historyRequestId.current; const assetLoad = assetLoadId.current;
    const relevant = () => serial === historyRequestId.current && assetLoad === assetLoadId.current && id === detailRef.current?.asset.id;
    try { const next = await api<Revision[]>(`/assets/${id}/revisions`); if (relevant()) setRevisions(next); }
    catch (e) { if (relevant()) setError((e as Error).message); }
  }, []);
  const installDetail = useCallback((next: AssetDetail, keepLayer = true) => { detailRef.current = next; setDetail(next); setPreview(null); setViewRevision(null); setLayerId(previous => keepLayer && next.revision.document.layers.some(l => l.id === previous) ? previous : next.revision.document.layers.at(-1)?.id ?? ''); setColor(previous => Math.min(previous, next.revision.document.palette.length - 1)); if (!keepLayer) { setSelection(null); setRevisions([]); if (stageRef.current) { const area = stageRef.current.getBoundingClientRect(); setView(fitCanvas(next.revision.document.width, next.revision.document.height, area.width, area.height)); } } }, []);
  const openAsset = useCallback(async (id: string) => {
    if (busyRef.current) return;
    const serial = ++assetLoadId.current; loadingRef.current = true; setLoading(true); setError(''); setSelection(null); setRevisions([]); setViewRevision(null); setUndoStack([]); setRedoStack([]);
    try { const next = await api<AssetDetail>(`/assets/${id}`); if (serial === assetLoadId.current && next.asset.projectId === projectIdRef.current) { installDetail(next, false); await loadHistory(id); } } catch (e) { if (serial === assetLoadId.current) setError((e as Error).message); } finally { if (serial === assetLoadId.current) { loadingRef.current = false; setLoading(false); } }
  }, [installDetail, loadHistory]);
  useEffect(() => { let cancelled = false; Promise.all([api<Project[]>('/projects'), api<Record<PixelStyle, ProjectStyle>>('/presets')]).then(([list, styles]) => { if (!cancelled) { const requestedProject = new URLSearchParams(window.location.search).get('project'); setProjects(list); setPresets(styles); setProjectId(list.find(p => p.id === requestedProject)?.id ?? list[0]?.id ?? ''); } }).catch(e => setError(e.message)).finally(() => setLoading(false)); return () => { cancelled = true; }; }, []);
  useEffect(() => { void loadAssets(); }, [loadAssets]);
  useEffect(() => { ++assetLoadId.current; attemptedAutoOpen.current = ''; setAssets([]); setDetail(null); setViewRevision(null); setSelection(null); setRevisions([]); setUndoStack([]); setRedoStack([]); setLoading(false); }, [projectId]);
  useEffect(() => { if (!detail && assets.length && assets[0].projectId === projectId && !loading && attemptedAutoOpen.current !== assets[0].id) { attemptedAutoOpen.current = assets[0].id; void openAsset(assets[0].id); } }, [assets, projectId, detail, loading, openAsset]);
  useEffect(() => { if (document && canvasRef.current) paint(canvasRef.current, document); }, [document]);
  useEffect(() => { if (document) setPaletteText(document.palette.slice(1).join(', ')); }, [document?.palette.join(',')]);
  useEffect(() => { setColorDraft(document?.palette[color] ?? ''); }, [document?.palette.join(','), color]);
  useEffect(() => {
    let disposed = false; let pending = false; let refreshing = false;
    const refresh = async () => {
      const current = detailRef.current;
      if (disposed || !pending || refreshing || !current || busyRef.current || loadingRef.current || stroke.current) return;
      pending = false; refreshing = true; const assetLoad = assetLoadId.current;
      try {
        const next = await api<AssetDetail>(`/assets/${current.asset.id}`);
        if (disposed || assetLoad !== assetLoadId.current || next.asset.id !== detailRef.current?.asset.id) return;
        if (busyRef.current || loadingRef.current || stroke.current || current.asset.headRevisionId !== detailRef.current?.asset.headRevisionId) { pending = true; return; }
        if (next.asset.headRevisionId !== current.asset.headRevisionId) { installDetail(next); setUndoStack([]); setRedoStack([]); setSelection(null); flash('Asset extern aktualisiert'); void loadHistory(next.asset.id); }
      } catch { /* Reconnection requests a fresh snapshot after a failed refresh. */ }
      finally { refreshing = false; }
    };
    const refreshProjects = () => void api<Project[]>('/projects').then(list => { if (!disposed) { setProjects(list); if (!projectIdRef.current && list.length) setProjectId(list[0].id); } }).catch(() => {});
    const events = new EventSource('/api/events');
    events.onopen = () => { setConnected(true); pending = true; refreshProjects(); void loadAssets(); void refresh(); };
    events.onerror = () => setConnected(false);
    events.onmessage = event => { try { const change = JSON.parse(event.data) as { assetId?: string; projectId?: string; type: string; status?: McpStatus }; if (change.type === 'mcp') { if (change.status) setMcpStatus(change.status); return; } if (change.type === 'project') refreshProjects(); if (change.projectId === projectId || !change.projectId) void loadAssets(); if (change.assetId === detailRef.current?.asset.id) { pending = true; void refresh(); } } catch { /* Ignore malformed events. */ } };
    // Deferred events survive a stroke or save; no requests are made while idle.
    const deferred = window.setInterval(() => void refresh(), 500);
    return () => { disposed = true; window.clearInterval(deferred); events.close(); };
  }, [projectId, loadAssets, installDetail, loadHistory]);
  useEffect(() => {
    if (dialog !== 'mcp') return;
    setMcpNow(Date.now());
    const timer = window.setInterval(() => setMcpNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [dialog]);
  const controlMcp = async (action: 'start' | 'stop') => {
    if (mcpBusy || !connected) return;
    setMcpBusy(true); setMcpError('');
    try { await api<McpStatus>(`/mcp/${action}`, undefined, 'POST'); }
    catch (e) { setMcpError((e as Error).message); }
    finally { setMcpBusy(false); }
  };

  const apply = async (operations: Operation[], label: string, editScope?: EditScope) => {
    if (!detail || busyRef.current || loadingRef.current || viewingPast || !operations.length) return;
    const before = detail; setBusy(true); busyRef.current = true; setError('');
    try {
      const result = await api<ApplyResult>(`/assets/${before.asset.id}/operations`, { expectedRevision: before.asset.headRevisionId, requestId: requestId(), actor: 'human', label, editScope: editScope ?? fullScope(before.revision.document), operations });
      setUndoStack(stack => [...stack, before.asset.headRevisionId]); setRedoStack([]); installDetail(result); void loadAssets(); void loadHistory(before.asset.id);
    } catch (e) { setPreview(null); setError((e as Error).message); try { const current = await api<AssetDetail>(`/assets/${before.asset.id}`); if (current.asset.headRevisionId !== before.asset.headRevisionId) { installDetail(current); setUndoStack([]); setRedoStack([]); setError('Das Asset wurde während der Anfrage geändert. Der aktuelle Stand ist geladen. Prüfe den letzten Zeichenstrich, bevor du ihn wiederholst.'); void loadHistory(before.asset.id); } } catch { /* Preserve the last saved document if the service is offline. */ } }
    finally { setBusy(false); busyRef.current = false; }
  };
  const restore = async (revisionId: string, direction?: 'undo' | 'redo') => {
    if (!detail || busyRef.current || loadingRef.current) return; setBusy(true); busyRef.current = true; const oldId = detail.asset.headRevisionId;
    try { const next = await api<AssetDetail>(`/assets/${detail.asset.id}/restore`, { revisionId, expectedRevision: oldId, requestId: requestId(), label: direction === 'undo' ? 'Rückgängig' : direction === 'redo' ? 'Wiederholen' : 'Version wiederhergestellt' });
      if (direction === 'undo') { setUndoStack(s => s.slice(0, -1)); setRedoStack(s => [...s, oldId]); } else if (direction === 'redo') { setRedoStack(s => s.slice(0, -1)); setUndoStack(s => [...s, oldId]); } else { setUndoStack(s => [...s, oldId]); setRedoStack([]); }
      installDetail(next); setSelection(null); void loadAssets(); void loadHistory(next.asset.id);
    } catch (e) { setError((e as Error).message); try { const current = await api<AssetDetail>(`/assets/${detail.asset.id}`); if (current.asset.headRevisionId !== oldId) { installDetail(current); setUndoStack([]); setRedoStack([]); setError('Das Asset wurde während der Anfrage geändert. Der aktuelle Stand ist geladen. Prüfe diese Version vor einer erneuten Wiederherstellung.'); void loadHistory(current.asset.id); } } catch { /* Keep the saved state available while offline. */ } } finally { setBusy(false); busyRef.current = false; }
  };
  const undo = () => { if (viewingPast || stroke.current || panDrag.current) return; const id = undoStack.at(-1); if (id) void restore(id, 'undo'); };
  const redo = () => { if (viewingPast || stroke.current || panDrag.current) return; const id = redoStack.at(-1); if (id) void restore(id, 'redo'); };
  const clearSelection = () => { if (!detail || !selection || !canDraw) return; void apply([{ op: 'patch', layerId, ...selection, pixels: Array(selection.width * selection.height).fill(0) }], 'Auswahl gelöscht', { layerIds: [layerId], rect: selection }); };
  const cancelInteraction = () => {
    const draw = stroke.current; stroke.current = null;
    if (draw) { setPreview(null); if (draw.tool === 'selection') setSelection(draw.previousSelection); if (canvasRef.current?.hasPointerCapture(draw.pointerId)) canvasRef.current.releasePointerCapture(draw.pointerId); }
    const pan = panDrag.current; panDrag.current = null;
    if (pan) { setPanning(false); if (stageRef.current?.hasPointerCapture(pan.pointerId)) stageRef.current.releasePointerCapture(pan.pointerId); }
  };
  const changeZoom = (delta: number) => { if (!document || stroke.current || panDrag.current) return; setView(current => zoomAt(current, current.zoom + delta)); };
  const fitView = () => { if (!document || !stageRef.current || stroke.current || panDrag.current) return; const area = stageRef.current.getBoundingClientRect(); setView(fitCanvas(document.width, document.height, area.width, area.height)); };
  const showDialog = (kind: Exclude<Dialog, null>) => {
    if (kind !== 'shortcuts' && kind !== 'mcp' && (busyRef.current || loadingRef.current)) return;
    if (!dialogRef.current) { const active = window.document.activeElement; modalTriggerRef.current = active instanceof HTMLElement && active !== window.document.body && active !== window.document.documentElement ? active : stageRef.current; }
    setDialog(kind);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && !!event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      const action = resolveShortcut(event, typing || !!dialog);
      if (!action) return;
      if (action === 'pan-start') { if (document) { const nativeControl = event.target instanceof HTMLElement && !!event.target.closest('button, a, summary, [role="button"]'); if (!nativeControl) event.preventDefault(); if (stroke.current) cancelInteraction(); spaceHeldRef.current = true; setSpaceHeld(true); } return; }
      if (action === 'cancel') { event.preventDefault(); cancelInteraction(); setSelection(null); setViewRevision(null); return; }
      if (stroke.current || panDrag.current) return;
      event.preventDefault();
      switch (action) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'export': if (detail) window.location.assign(`/api/assets/${detail.asset.id}/export?format=png`); break;
        case 'zoom-in': changeZoom(1); break;
        case 'zoom-out': changeZoom(-1); break;
        case 'fit': fitView(); break;
        case 'actual-size': if (document) setView({ zoom: 1, pan: { x: 0, y: 0 } }); break;
        case 'grid': setGrid(value => !value); break;
        case 'help': showDialog('shortcuts'); break;
        case 'delete': clearSelection(); break;
        default: setTool(action);
      }
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space' || event.key === ' ') { spaceHeldRef.current = false; setSpaceHeld(false); } };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); };
  });
  useEffect(() => {
    const reset = () => { spaceHeldRef.current = false; setSpaceHeld(false); cancelInteraction(); };
    const visibility = () => { if (window.document.hidden) reset(); };
    window.addEventListener('blur', reset); window.document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', reset); window.document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    const stage = stageRef.current; if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (!document || dialog || loading || event.deltaY === 0) return;
      event.preventDefault(); if (stroke.current || panDrag.current) return;
      const area = stage.getBoundingClientRect(); const anchor = { x: event.clientX - area.left - area.width / 2, y: event.clientY - area.top - area.height / 2 };
      setView(current => zoomAt(current, current.zoom + (event.deltaY < 0 ? 1 : -1), anchor));
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => stage.removeEventListener('wheel', wheel);
  }, [document?.width, document?.height, dialog, loading]);
  useEffect(() => {
    if (!dialog) return;
    spaceHeldRef.current = false; setSpaceHeld(false); cancelInteraction();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (dialog === 'shortcuts' || dialog === 'mcp' || !busyRef.current)) { event.preventDefault(); setDialog(null); }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const fields = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
      if (!fields.includes(window.document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? fields.at(-1) : fields[0])?.focus(); }
      else if (event.shiftKey && window.document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
    };
    window.addEventListener('keydown', keydown); return () => {
      window.removeEventListener('keydown', keydown);
      if (!dialogRef.current) { const trigger = modalTriggerRef.current; (trigger?.isConnected ? trigger : stageRef.current)?.focus({ preventScroll: true }); modalTriggerRef.current = null; }
    };
  }, [dialog]);
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!document || loading || dialog || panDrag.current || !event.isPrimary || !(event.button === 1 || (event.button === 0 && (spaceHeldRef.current || tool === 'pan')))) return;
    event.preventDefault(); event.stopPropagation(); cancelInteraction();
    panDrag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan: viewRef.current.pan };
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus({ preventScroll: true }); setPanning(true); setCursor(null);
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDrag.current; if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); setView(current => ({ ...current, pan: panFromDrag(drag.pan, drag.start, { x: event.clientX, y: event.clientY }) }));
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (panDrag.current?.pointerId === event.pointerId) cancelInteraction(); };
  const position = (event: ReactPointerEvent<HTMLCanvasElement>): Point => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(document!.width - 1, Math.floor((event.clientX - rect.left) / rect.width * document!.width))), y: Math.max(0, Math.min(document!.height - 1, Math.floor((event.clientY - rect.top) / rect.height * document!.height))) }; };
  const previewStroke = (end: Point) => {
    const current = stroke.current; if (!current) return;
    if (current.tool === 'selection') { setSelection(between(current.start, end)); current.last = end; return; }
    let operations: Operation[] = [];
    if (current.tool === 'pencil' || current.tool === 'eraser') {
      const colorIndex = current.tool === 'eraser' ? 0 : color;
      try { const segment = applyOperations(current.base, [{ op: 'line', layerId, x1: current.last.x, y1: current.last.y, x2: end.x, y2: end.y, color: colorIndex }], { layerIds: [layerId] }).document.layers.find(l => l.id === layerId)!;
        for (let i = 0; i < segment.pixels.length; i++) { const p = { x: i % current.base.width, y: Math.floor(i / current.base.width) }; if (segment.pixels[i] !== current.base.layers.find(l => l.id === layerId)!.pixels[i] && (!selection || contains(selection, p))) current.points.push([p.x, p.y, colorIndex]); }
        if (!selection || contains(selection, end)) current.points.push([end.x, end.y, colorIndex]);
      } catch { return; }
      current.points = [...new Map(current.points.map(point => [point[1] * current.base.width + point[0], point])).values()];
      if (!current.points.length) { current.operations = []; return; }
      operations = [{ op: 'pixels', layerId, points: current.points }];
    } else if (current.tool === 'line') operations = [{ op: 'line', layerId, x1: current.start.x, y1: current.start.y, x2: end.x, y2: end.y, color }];
    else if (current.tool === 'rect' || current.tool === 'ellipse') operations = [{ op: current.tool, layerId, ...between(current.start, end), color, filled }];
    else if (current.tool === 'move') {
      const rect = selection ?? { x: 0, y: 0, width: current.base.width, height: current.base.height }; let dx = end.x - current.start.x, dy = end.y - current.start.y;
      if (selection) { dx = Math.max(-rect.x, Math.min(current.base.width - rect.x - rect.width, dx)); dy = Math.max(-rect.y, Math.min(current.base.height - rect.y - rect.height, dy)); end = { x: current.start.x + dx, y: current.start.y + dy }; }
      operations = [{ op: current.copy ? 'copy' : 'move', layerId, dx, dy, rect }];
      current.scope = { layerIds: [layerId], ...(selection ? { rect: { x: Math.min(rect.x, rect.x + dx), y: Math.min(rect.y, rect.y + dy), width: rect.width + Math.abs(dx), height: rect.height + Math.abs(dy) } } : {}) };
    }
    try {
      if (selection && !['pencil', 'eraser', 'move'].includes(current.tool)) { const simulated = applyOperations(current.base, operations, { layerIds: [layerId] }).document.layers.find(l => l.id === layerId)!; const pixels: number[] = []; for (let y = selection.y; y < selection.y + selection.height; y++) for (let x = selection.x; x < selection.x + selection.width; x++) pixels.push(simulated.pixels[y * current.base.width + x]); operations = [{ op: 'patch', layerId, ...selection, pixels }]; }
      setPreview(applyOperations(current.base, operations, current.scope).document); current.operations = operations; current.last = end;
    } catch (e) { current.operations = []; setPreview(null); setNotice((e as Error).message); }
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!document || !detail || event.button !== 0 || !event.isPrimary || !editable || spaceHeldRef.current || tool === 'pan' || panDrag.current || stroke.current) return; event.preventDefault(); stageRef.current?.focus({ preventScroll: true }); if (busyRef.current) return; const p = position(event); setCursor(p);
    if (tool === 'eyedropper') { const rgba = composite(document); const index = (p.y * document.width + p.x) * 4; const hex = rgba[index + 3] === 0 ? '#00000000' : '#' + Array.from(rgba.slice(index, index + 3), c => c.toString(16).padStart(2, '0')).join(''); const next = document.palette.findIndex(c => c.toLowerCase() === hex); if (next >= 0) setColor(next); return; }
    if (tool !== 'selection' && !canDraw) { flash('Wähle eine sichtbare, entsperrte Ebene.'); return; }
    if (tool === 'fill') {
      if (selection && !contains(selection, p)) return;
      const operation: Operation = { op: 'fill', layerId, x: p.x, y: p.y, color };
      void apply([operation], 'Fläche gefüllt', { layerIds: [layerId], ...(selection ? { rect: selection } : {}) }); return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    stroke.current = { pointerId: event.pointerId, start: p, last: p, base: detail.revision.document, points: [], operations: [], scope: { layerIds: [layerId], ...(selection && tool !== 'selection' ? { rect: selection } : {}) }, tool, copy: tool === 'move' && (copyMode || event.altKey), previousSelection: selection };
    previewStroke(p);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => { if (!document || panDrag.current) return; const p = position(event); setCursor(p); if (stroke.current?.pointerId === event.pointerId) previewStroke(p); };
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = stroke.current; if (!current || current.pointerId !== event.pointerId) return; previewStroke(position(event)); const completed = stroke.current!; stroke.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.tool !== 'selection' && completed.operations.length) { if (current.tool === 'move' && selection) setSelection({ ...selection, x: selection.x + completed.last.x - current.start.x, y: selection.y + completed.last.y - current.start.y }); void apply(completed.operations, current.copy ? 'Auswahl kopiert' : tools.find(t => t.id === current.tool)?.label ?? 'Zeichnen', completed.scope); } else setPreview(null);
  };
  const transform = (op: Operation, label: string) => { if (!canDraw) return; void apply([op], label, { layerIds: [layerId], ...(selection ? { rect: selection } : {}) }); };
  const saveColor = () => { if (!document || !color || !editable || document.paletteLocked || colorDraft.toUpperCase() === document.palette[color].toUpperCase()) return; if (!/^#[0-9a-f]{6}$/i.test(colorDraft)) { setError('Verwende eine Hexfarbe im Format #RRGGBB.'); return; } const palette = [...document.palette]; palette[color] = colorDraft; void apply([{ op: 'palette', colors: palette }], 'Palettenfarbe geändert'); };
  const openDialog = (kind: Exclude<Dialog, null>) => { setError(''); setNewName(kind === 'project' ? '' : kind === 'variant' ? `${detail?.asset.name ?? 'Asset'} · Variante` : ''); setNewSize({ width: project?.style.width ?? 32, height: project?.style.height ?? 32 }); showDialog(kind); };
  const submitDialog = async (event: FormEvent) => {
    event.preventDefault(); if (dialog === 'shortcuts' || dialog === 'mcp' || !newName.trim() || busyRef.current || loadingRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try {
      if (dialog === 'project') { const next = await api<Project>('/projects', { name: newName.trim(), preset: newPreset }); setProjects(list => [...list.filter(p => p.id !== next.id), next]); setProjectId(next.id); }
      else { const next = dialog === 'variant' && detail ? await api<AssetDetail>(`/assets/${detail.asset.id}/variant`, { name: newName.trim() }) : await api<AssetDetail>('/assets', { projectId, name: newName.trim(), type: newType, width: newSize.width, height: newSize.height }); installDetail(next, false); setUndoStack([]); setRedoStack([]); setSelection(null); void loadAssets(); void loadHistory(next.asset.id); }
      setDialog(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const importPng = async (file?: File) => {
    if (!file || !projectId || busyRef.current || loadingRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try { const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.')); reader.readAsDataURL(file); }); const next = await api<AssetDetail>('/import', { projectId, name: file.name.replace(/\.png$/i, ''), type: 'prop', pngBase64: encoded }); installDetail(next, false); setUndoStack([]); setRedoStack([]); void loadAssets(); void loadHistory(next.asset.id); flash('PNG verlustfrei importiert'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const importProject = async (file?: File) => {
    if (!file || busyRef.current || loadingRef.current) return; busyRef.current = true; setBusy(true); setError(''); try { const next = await api<Project>('/projects/import', { project: JSON.parse(await file.text()) }); setProjects(list => [...list.filter(p => p.id !== next.id), next]); setProjectId(next.id); flash('Projekt importiert'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (projectFileRef.current) projectFileRef.current.value = ''; }
  };
  const updateStyle = async (style: ProjectStyle) => { if (!project) return; setBusy(true); try { const next = await api<Project>(`/projects/${project.id}`, { style }, 'PATCH'); setProjects(list => list.map(p => p.id === next.id ? next : p)); flash('Projektstil gespeichert · gilt für neue Assets'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const copyOrder = async () => { if (!detail) return; const text = `Bearbeite das Pixelator-Asset „${detail.asset.name}“.\nProjekt: ${projectId}\nAsset: ${detail.asset.id}\nAusgangsrevision: ${detail.asset.headRevisionId}\n\nAuftrag: ${prompt.trim() || 'Verbessere die Lesbarkeit und das Shading; bewahre Motiv, Palette und Stil.'}\n\nVerwende die Pixelator-MCP-Werkzeuge. Rufe zuerst get_workflow auf und wende dessen Artist Guide sowie den gespeicherten Asset-Stil verbindlich an. Die Ressource pixelator://artist-guide enthält dieselben Regeln. Lies anschließend das Asset und seinen gespeicherten Stil; aktuelle Projektvorgaben gelten für neue Assets. Plane semantische Ebenen. Inspiziere echte PNG-Renderings, bearbeite in kleinen Batches und prüfe jede Änderung visuell. Verwende expectedRevision und lokale editScope-Grenzen. Erhalte Pixel außerhalb des gewünschten Bereichs. Dokumentiere dein Review der Endrevision. MCP: ${import.meta.env.DEV ? 'http://127.0.0.1:4317' : window.location.origin}/mcp`; try { await navigator.clipboard.writeText(text); flash('Auftrag kopiert'); } catch { setError('Die Zwischenablage ist nicht verfügbar. Erlaube dem Browser Zugriff auf die Zwischenablage.'); } };

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setLibraryOpen(v => !v)} title="Bibliothek ein-/ausblenden"><span className="brand-mark"><i/><i/><i/><i/><i/><i/><i/></span><span>pixelator<span className="brand-dot">.</span></span></button>
      <div className="top-actions"><button className={`connection mcp-trigger${connected && mcpStatus?.running ? '' : ' offline'}`} onClick={() => showDialog('mcp')} aria-haspopup="dialog" aria-expanded={dialog === 'mcp'} aria-label="MCP-Server öffnen" title="MCP-Server verwalten"><Icon name="server" size={15}/><span>MCP</span><i/><span>{mcpLabel}</span><Icon name="arrow" size={13}/></button></div>
    </header>
    <main className={`workspace${!libraryOpen ? ' library-collapsed' : ''}`}>
      <aside className="library" aria-label="Assetbibliothek">
        <div className="library-top">
          <div className="project-picker"><Icon name="folder"/><select aria-label="Projekt wählen" value={projectId} onChange={e => { if (!busy) setProjectId(e.target.value); }} disabled={busy || !projects.length}>{!projects.length && <option value="">Noch kein Projekt</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><IconButton icon="plus" label="Projekt erstellen" onClick={() => openDialog('project')} disabled={busy}/></div>
          <div className="library-title"><h2>Assets</h2><span className="count">{assets.length}</span></div>
          <label className="search-field"><Icon name="search" size={16}/><input placeholder="Assets durchsuchen …" aria-label="Assets durchsuchen" value={search} onChange={e => setSearch(e.target.value)}/></label>
          <div className="filter-tabs" aria-label="Assettyp filtern">{[['', 'Alle'], ['character', 'Charaktere'], ['item', 'Items'], ['prop', 'Props'], ['ui', 'UI']].map(([value, label]) => <button key={value} className={typeFilter === value ? 'selected' : ''} onClick={() => setTypeFilter(value)}>{label}</button>)}</div>
        </div>
        <div className="asset-list">
          {!assets.length && <div className="library-empty"><Icon name="layers" size={30}/><p>{search || typeFilter ? 'Keine passenden Assets' : 'Noch keine Assets'}</p></div>}
          {assets.map(a => <button key={a.id} className={`asset-card${detail?.asset.id === a.id ? ' selected' : ''}`} onClick={() => !busy && void openAsset(a.id)} disabled={busy}><span className="asset-thumb checker"><img src={`/api/assets/${a.id}/png?scale=2&revisionId=${a.headRevisionId}`} alt=""/></span><span className="asset-description"><strong>{a.name}</strong><span>{typeLabels[a.type]} <i/> {a.style.width} × {a.style.height}</span></span><span className="asset-active-dot"/></button>)}
        </div>
        <div className="library-bottom"><button className="button primary wide" onClick={() => openDialog(project ? 'asset' : 'project')} disabled={busy}><Icon name="plus"/>{project ? 'Neues Asset' : 'Projekt erstellen'}</button><div className="split-actions"><button onClick={() => fileRef.current?.click()} disabled={!project || busy}><Icon name="import" size={15}/> PNG importieren</button><button onClick={() => projectFileRef.current?.click()} disabled={busy} title="Pixelator-Projekt importieren"><Icon name="folder" size={15}/></button></div></div>
      </aside>
      <section className="editor" aria-label="Pixeleditor">
        <div className="editor-heading"><div className="asset-heading"><span className="document-icon"><Icon name="rect"/></span><div><h1>{detail?.asset.name ?? 'Pixeleditor'}</h1>{detail && <span>{typeLabels[detail.asset.type]} <span className="sub-dot">·</span> {document?.width} × {document?.height} px <span className="sub-dot">·</span> {detail.asset.style.preset}</span>}</div></div><div className="heading-actions"><IconButton icon="copy" label="Variante erstellen" disabled={!detail || busy || loading} onClick={() => openDialog('variant')}/><a className={`button export-button${!detail ? ' disabled' : ''}`} href={detail ? `/api/assets/${detail.asset.id}/export?format=png` : undefined} aria-disabled={!detail}><Icon name="download" size={16}/> PNG exportieren</a></div></div>
        <div className="editor-toolbar"><div className="toolbar-history"><IconButton icon="undo" label="Rückgängig (Strg+Z)" onClick={undo} disabled={!undoStack.length || busy || loading || viewingPast}/><IconButton icon="redo" label="Wiederholen (Strg+Umschalt+Z)" onClick={redo} disabled={!redoStack.length || busy || loading || viewingPast}/></div><span className="toolbar-divider"/><span className="tool-name">{tools.find(t => t.id === tool)?.label}</span>{(tool === 'rect' || tool === 'ellipse') && <label className="inline-check"><input type="checkbox" checked={filled} onChange={e => setFilled(e.target.checked)}/> Gefüllt</label>}{tool === 'move' && <label className="inline-check" title="Alternativ Alt beim Ziehen halten"><input type="checkbox" checked={copyMode} onChange={e => setCopyMode(e.target.checked)}/> Kopieren <span className="tool-option-hint">(Alt + Ziehen)</span></label>}{selection && <button className="selection-chip" onClick={() => setSelection(null)}>{selection.width} × {selection.height} Auswahl <span>×</span></button>}<div className="toolbar-spacer"/><IconButton icon="grid" label="Pixelraster ein-/ausblenden (Umschalt+G)" active={grid} onClick={() => setGrid(g => !g)}/><span className="toolbar-divider"/><button className="zoom-button" onClick={() => changeZoom(-1)} disabled={!document || zoom === MIN_ZOOM} aria-label="Verkleinern (−)">−</button><button className="zoom-value" aria-label="Ansicht einpassen (F oder 0)" title="Einpassen (F oder 0) · Originalgröße: 1" onClick={fitView} disabled={!document}>{zoom * 100}%</button><button className="zoom-button" onClick={() => changeZoom(1)} disabled={!document || zoom === MAX_ZOOM} aria-label="Vergrößern (+)">+</button><span className="toolbar-divider"/><IconButton icon="keyboard" label="Tastenkürzel (?)" onClick={() => showDialog('shortcuts')}/></div>
        {error && <div className="alert error" role="alert"><span>{error}</span><button aria-label="Fehlermeldung schließen" onClick={() => setError('')}>×</button></div>}
        {viewingPast && <div className="alert past"><span>Versionsvorschau · {viewRevision.label}</span><button onClick={() => setViewRevision(null)}>Zur aktuellen Version</button><button onClick={() => void restore(viewRevision.id)} disabled={busy || loading}>Wiederherstellen</button></div>}
        <div className="canvas-workspace"><div className="tool-rail" role="toolbar" aria-label="Zeichenwerkzeuge">{tools.map(t => <IconButton key={t.id} icon={t.icon} label={`${t.label} (${t.key})`} active={tool === t.id} onClick={() => setTool(t.id)} disabled={!detail}><span className="tool-key">{t.key}</span></IconButton>)}<span className="rail-divider"/><div className={`current-color${color === 0 ? ' checker' : ''}`} style={{ '--swatch': document?.palette[color] ?? '#abc887' } as CSSProperties} title={`Aktive Farbe ${color}`}/></div>
          <div ref={stageRef} className={`canvas-stage tool-${tool}${spaceHeld || tool === 'pan' ? ' pan-ready' : ''}${panning ? ' is-panning' : ''}`} tabIndex={0} role="region" aria-label="Zeichenfläche" onPointerDownCapture={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}>
            {document ? <><div className={`canvas-artboard checker${grid && zoom >= 4 ? ' show-grid' : ''}`} style={{ width: document.width * zoom, height: document.height * zoom, transform: `translate(calc(-50% + ${view.pan.x}px), calc(-50% + ${view.pan.y}px))`, '--pixel-size': `${zoom}px` } as CSSProperties}>
              <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event => { if (stroke.current?.pointerId === event.pointerId) cancelInteraction(); }} onLostPointerCapture={event => { if (stroke.current?.pointerId === event.pointerId) cancelInteraction(); }} onPointerLeave={() => !stroke.current && setCursor(null)} aria-label={`${detail?.asset.name ?? 'Asset'}, ${document.width} mal ${document.height} Pixel. ${tools.find(t => t.id === tool)?.label} aktiv.`}/>
              {selection && <div className="selection-overlay" style={{ left: selection.x * zoom, top: selection.y * zoom, width: selection.width * zoom, height: selection.height * zoom }}/>}</div><div className="canvas-hint"><kbd>Leertaste</kbd> + Ziehen <span>·</span> Mausrad: Zoom {selection && <><span>·</span><kbd>Esc</kbd> Auswahl aufheben</>}</div></> : <div className="studio-empty"><span className="empty-canvas"><i/><i/><i/><i/><Icon name="spark" size={36}/></span><h2>Kein Asset ausgewählt</h2><button className="button primary" onClick={() => openDialog(project ? 'asset' : 'project')}><Icon name="plus"/> {project ? 'Asset erstellen' : 'Projekt erstellen'}</button></div>}
            {loading && <div className="loading-overlay" role="status"><span className="spinner"/> Laden …</div>}
          </div>
        </div>
        <div className="canvas-status"><span><span className={`status-dot${busy ? ' saving' : ''}`}/>{busy ? 'Wird gespeichert …' : preview ? 'Zeichnen …' : detail ? 'Gespeichert' : 'Bereit'}</span><span>{cursor ? `X ${cursor.x} · Y ${cursor.y}` : 'X — · Y —'}<i/>{document?.layers.length ?? 0} Ebenen<i/>{validation?.colorCount ?? 0} Farben</span></div>
        <section className="agent-panel" aria-label="KI-Agenten-Auftrag"><div className="agent-panel-content"><div><h2>Agenten-Auftrag</h2></div><p>Auftrag kopieren und in Codex oder Claude einfügen.</p><div className="agent-input"><input aria-label="Auftrag für deinen KI-Agenten" placeholder="z. B. Schwert um 3 Pixel verlängern" value={prompt} onChange={e => setPrompt(e.target.value)} disabled={!detail}/><button onClick={() => void copyOrder()} disabled={!detail}><Icon name="copy" size={15}/> Auftrag kopieren</button></div></div></section>
      </section>
      <aside className="inspector" aria-label="Eigenschaften">
        <section className="inspector-section preview-section"><div className="section-heading"><span>VORSCHAU</span><span className="muted">1:1</span></div><div className="preview-background checker">{document ? <Miniature doc={document}/> : <Icon name="rect" size={30}/>}</div></section>
        <section className="inspector-section palette-section"><div className="section-heading"><span>PALETTE</span><span className="muted">{document ? document.palette.length - 1 : 0} FARBEN</span></div><div className="palette-swatches">{document?.palette.map((c, i) => <button key={i} className={`swatch${i === color ? ' selected' : ''}${i === 0 ? ' checker' : ''}`} style={{ backgroundColor: i ? c : undefined }} aria-label={i ? `Farbe ${i}: ${c}` : 'Transparent'} aria-pressed={i === color} title={i ? `${i} · ${c}` : 'Transparent'} onClick={() => setColor(i)}>{i === 0 && <span>╱</span>}</button>)}</div>{document && <div className="palette-current"><span className={`color-chip${color === 0 ? ' checker' : ''}`} style={{ backgroundColor: color ? document.palette[color] : undefined }}/>{color ? <input className="hex-input" aria-label="Hexfarbe" value={colorDraft.toUpperCase()} onChange={e => setColorDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveColor(); }} maxLength={7} disabled={!editable || document.paletteLocked}/> : <span>TRANSPARENT</span>}<span className="muted">#{color}</span>{color > 0 && <><input type="color" aria-label="Gewählte Palettenfarbe bearbeiten" value={/^#[0-9a-f]{6}$/i.test(colorDraft) ? colorDraft : document.palette[color]} disabled={!editable || document.paletteLocked} onChange={e => setColorDraft(e.target.value)}/><IconButton icon="check" label="Palettenfarbe speichern" disabled={!editable || document.paletteLocked || colorDraft.toUpperCase() === document.palette[color].toUpperCase()} onClick={saveColor}/></>}</div>}
          {document && <details className="compact-details"><summary>Palette bearbeiten {document.paletteLocked && <Icon name="lock" size={12}/>}</summary><textarea aria-label="Palettenfarben als Hexwerte" value={paletteText} onChange={e => setPaletteText(e.target.value)} rows={3} disabled={!editable || document.paletteLocked}/><button className="button small" disabled={!editable || document.paletteLocked} onClick={() => void apply([{ op: 'palette', colors: ['#00000000', ...paletteText.split(/[\s,;]+/).filter(Boolean)] }], 'Palette geändert')}>Palette übernehmen</button><p>Globale Änderung · betrifft alle Pixel mit diesem Farbindex.</p></details>}</section>
        <section className="inspector-section layers-section"><div className="inspector-tabs"><button className={rightTab === 'layers' ? 'selected' : ''} onClick={() => setRightTab('layers')}><Icon name="layers" size={14}/> Ebenen</button><button className={rightTab === 'history' ? 'selected' : ''} onClick={() => setRightTab('history')}><Icon name="history" size={14}/> Verlauf</button>{rightTab === 'layers' && <IconButton icon="plus" label="Ebene hinzufügen" disabled={!editable} onClick={() => { const id = requestId(); void apply([{ op: 'add_layer', id, name: `Ebene ${(document?.layers.length ?? 0) + 1}` }], 'Ebene hinzugefügt'); setLayerId(id); }}/>}</div>
          {rightTab === 'layers' ? <><div className="layer-list">{document?.layers.slice().reverse().map(layer => <div key={layer.id} className={`layer-row${layer.id === layerId ? ' selected' : ''}`}><IconButton icon={layer.visible ? 'eye' : 'hidden'} label={`${layer.name} ${layer.visible ? 'ausblenden' : 'einblenden'}`} disabled={!editable} onClick={() => void apply([{ op: 'update_layer', layerId: layer.id, visible: !layer.visible }], 'Ebenensichtbarkeit geändert')}/><button className="layer-select" onClick={() => setLayerId(layer.id)} aria-label={`Ebene ${layer.name} wählen`}><span className="layer-mini checker"><Miniature doc={{ ...document, layers: [{ ...layer, visible: true }] }}/></span><span>{layer.name}</span></button><IconButton icon={layer.locked ? 'lock' : 'unlock'} label={`${layer.name} ${layer.locked ? 'entsperren' : 'sperren'}`} disabled={!editable} onClick={() => void apply([{ op: 'update_layer', layerId: layer.id, locked: !layer.locked }], 'Ebenensperre geändert')}/></div>)}</div>{activeLayer && <div className="layer-properties"><input key={`${activeLayer.id}-${activeLayer.name}`} aria-label="Ebenenname" defaultValue={activeLayer.name} disabled={!editable} onBlur={e => { if (e.target.value.trim() && e.target.value !== activeLayer.name) void apply([{ op: 'update_layer', layerId, name: e.target.value.trim() }], 'Ebene umbenannt'); }}/><div><IconButton icon="arrow" label="Ebene nach oben" disabled={!editable || document?.layers.at(-1)?.id === layerId} onClick={() => { if (!document) return; const ids = document.layers.map(l => l.id), i = ids.indexOf(layerId); [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]; void apply([{ op: 'reorder_layers', layerIds: ids }], 'Ebene verschoben'); }}/><IconButton icon="arrow" className="rotate-icon" label="Ebene nach unten" disabled={!editable || document?.layers[0]?.id === layerId} onClick={() => { if (!document) return; const ids = document.layers.map(l => l.id), i = ids.indexOf(layerId); [ids[i], ids[i - 1]] = [ids[i - 1], ids[i]]; void apply([{ op: 'reorder_layers', layerIds: ids }], 'Ebene verschoben'); }}/><span/><IconButton icon="trash" label="Ebene löschen" disabled={!editable || document?.layers.length === 1 || activeLayer.locked} onClick={() => { if (window.confirm(`Ebene „${activeLayer.name}“ löschen? Du kannst die Änderung rückgängig machen.`)) void apply([{ op: 'remove_layer', layerId }], 'Ebene gelöscht'); }}/></div></div>}{document && <div className="transform-tools"><button disabled={!canDraw} onClick={() => transform({ op: 'flip', layerId, axis: 'x', ...(selection ? { rect: selection } : {}) }, 'Horizontal gespiegelt')} title="Horizontal spiegeln">↔ Spiegeln</button><button disabled={!canDraw} onClick={() => transform({ op: 'flip', layerId, axis: 'y', ...(selection ? { rect: selection } : {}) }, 'Vertikal gespiegelt')} title="Vertikal spiegeln">↕</button><button disabled={!canDraw} onClick={() => transform({ op: 'rotate', layerId, turns: 1, ...(selection ? { rect: selection } : {}) }, '90° gedreht')} title="90 Grad drehen">↻ 90°</button></div>}</> : <div className="revision-list">{revisions.length ? [...revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => <button key={r.id} className={`revision-row${(viewRevision?.id ?? detail?.asset.headRevisionId) === r.id ? ' selected' : ''}`} disabled={busy || loading} onClick={() => { if (busyRef.current || loadingRef.current || stroke.current) return; setViewRevision(r.id === detail?.asset.headRevisionId ? null : r); setSelection(null); }}><span className="revision-dot"/><span><strong>{r.label}</strong><small>{r.actor === 'agent' ? 'Agent' : r.actor === 'import' ? 'Import' : 'Du'} · {new Date(r.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</small></span>{r.id === detail?.asset.headRevisionId && <span className="head-badge">AKTUELL</span>}</button>) : <p className="empty-small">Hier entsteht deine Asset-Historie.</p>}</div>}</section>
        {detail && document && <section className="inspector-section asset-details"><div className="section-heading"><span>ASSET-DETAILS</span></div><dl><div><dt>Auflösung</dt><dd>{document.width} × {document.height}</dd></div><div><dt>Farben verwendet</dt><dd>{validation?.colorCount ?? 0} / {document.maxColors}</dd></div><div><dt>Perspektive</dt><dd>{detail.asset.style.perspective === 'side' ? 'Seitenansicht' : 'Frontansicht'}</dd></div><div><dt>Licht</dt><dd>{detail.asset.style.lighting === 'upper-left' ? 'Links oben' : detail.asset.style.lighting}</dd></div></dl><div className="pivot-fields"><span>Pivot (px)</span><input type="number" aria-label="Pivot X" min="0" max={document.width} step="0.5" key={`x-${document.pivot.x}`} defaultValue={document.pivot.x} disabled={!editable} onBlur={e => { const x = Number(e.target.value); if (x !== document.pivot.x) void apply([{ op: 'pivot', x, y: document.pivot.y }], 'Pivot geändert'); }}/><input type="number" aria-label="Pivot Y" min="0" max={document.height} step="0.5" key={`y-${document.pivot.y}`} defaultValue={document.pivot.y} disabled={!editable} onBlur={e => { const y = Number(e.target.value); if (y !== document.pivot.y) void apply([{ op: 'pivot', x: document.pivot.x, y }], 'Pivot geändert'); }}/></div>{(validation?.issues.length ?? 0) > 0 && <details className="validation-details"><summary>{(validation?.issues.length ?? 0)} Prüfhinweis{(validation?.issues.length ?? 0) > 1 ? 'e' : ''}</summary>{validation?.issues.map((issue, i) => <p key={i} className={issue.severity}>{issue.message}</p>)}</details>}<div className="export-links"><a href={`/api/assets/${detail.asset.id}/export?format=json`}><Icon name="download" size={13}/> Asset-JSON</a><a href={`/api/assets/${detail.asset.id}/export?format=unity`}><Icon name="download" size={13}/> Unity</a></div></section>}
        {project && <section className="inspector-section project-style"><details className="compact-details"><summary>Projektstil <span className="preset-badge">{project.style.preset}</span></summary><p>Vorgabe für neue Assets. Bestehende Assets behalten ihren Stil.</p><label>Stilprofil<select aria-label="Projekt-Stilprofil" value={project.style.preset} disabled={busy} onChange={e => { const preset = e.target.value as PixelStyle; if (presets) void updateStyle({ ...presets[preset], width: project.style.width, height: project.style.height }); }}>{['1-bit', 'game-boy', '8-bit', '16-bit'].map(p => <option key={p}>{p}</option>)}</select></label><label>Perspektive<select value={project.style.perspective} disabled={busy} onChange={e => void updateStyle({ ...project.style, perspective: e.target.value as 'side' | 'front' })}><option value="side">Seitenansicht</option><option value="front">Frontansicht</option></select></label><label>Palette sperren<input type="checkbox" checked={project.style.paletteLocked} disabled={busy} onChange={e => void updateStyle({ ...project.style, paletteLocked: e.target.checked })}/></label><a className="button small" href={`/api/projects/${project.id}/export`}><Icon name="download" size={13}/> Projekt exportieren</a></details></section>}
      </aside>
    </main>
    {notice && <div className="toast" role="status">{notice}</div>}
    <input ref={fileRef} type="file" accept="image/png,.png" hidden onChange={e => void importPng(e.target.files?.[0])}/><input ref={projectFileRef} type="file" accept="application/json,.json" hidden onChange={e => void importProject(e.target.files?.[0])}/>
    {dialog === 'shortcuts' && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section ref={modalRef} className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"><div className="shortcuts-heading"><h2 id="shortcuts-title">Tastenkürzel</h2><IconButton icon="close" label="Tastenkürzel schließen" autoFocus onClick={() => setDialog(null)}/></div><div className="shortcut-groups"><section><h3>Werkzeuge</h3><dl>{tools.map(t => <div key={t.id}><dt>{t.label}</dt><dd><kbd>{t.key}</kbd></dd></div>)}</dl></section><section><h3>Ansicht & Bearbeitung</h3><dl><div><dt>Ansicht verschieben</dt><dd><kbd>Leertaste</kbd> + Ziehen</dd></div><div><dt>Ansicht verschieben</dt><dd>Mittlere Maustaste</dd></div><div><dt>Zoom am Mauszeiger</dt><dd>Mausrad</dd></div><div><dt>Vergrößern / verkleinern</dt><dd><kbd>+</kbd> / <kbd>−</kbd></dd></div><div><dt>Einpassen & zentrieren</dt><dd><kbd>F</kbd> / <kbd>0</kbd></dd></div><div><dt>Originalgröße (100 %)</dt><dd><kbd>1</kbd></dd></div><div><dt>Raster ein-/ausblenden</dt><dd><kbd>Umschalt G</kbd></dd></div><div><dt>Rückgängig</dt><dd><kbd>Strg Z</kbd></dd></div><div><dt>Wiederholen</dt><dd><kbd>Strg Umschalt Z</kbd></dd></div><div><dt>PNG exportieren</dt><dd><kbd>Strg S</kbd></dd></div><div><dt>Auswahl löschen</dt><dd><kbd>Entf</kbd></dd></div><div><dt>Auswahl / Aktion abbrechen</dt><dd><kbd>Esc</kbd></dd></div><div><dt>Pixel kopieren</dt><dd><kbd>M</kbd>, dann <kbd>Alt</kbd> + Ziehen</dd></div><div><dt>Diese Übersicht</dt><dd><kbd>?</kbd></dd></div></dl></section></div><p>Beim Schreiben und in Dialogen bleiben die Kürzel inaktiv. Das Pixelraster erscheint ab 400 % Zoom. Auf dem Mac ersetzt ⌘ die Strg-Taste.</p></section></div>}
    {dialog && dialog !== 'shortcuts' && dialog !== 'mcp' && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !busy && setDialog(null)}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-heading"><span className="document-icon"><Icon name={dialog === 'project' ? 'folder' : 'rect'} size={22}/></span><IconButton icon="close" label="Dialog schließen" disabled={busy} onClick={() => setDialog(null)}/></div><h2 id="dialog-title">{dialog === 'project' ? 'Projekt erstellen' : dialog === 'variant' ? 'Variante erstellen' : 'Asset erstellen'}</h2>{dialog === 'variant' && <p>Erstellt eine Kopie des aktuellen Assets.</p>}<form onSubmit={e => void submitDialog(e)}><label>{dialog === 'project' ? 'Projektname' : 'Assetname'}<input autoFocus value={newName} onChange={e => setNewName(e.target.value)} maxLength={120} required disabled={busy}/></label>{dialog === 'project' && <label>Stilprofil<select value={newPreset} onChange={e => setNewPreset(e.target.value as PixelStyle)}>{['1-bit', 'game-boy', '8-bit', '16-bit'].map(p => <option key={p} value={p}>{p}</option>)}</select></label>}{dialog === 'asset' && <><label>Assettyp<select value={newType} onChange={e => setNewType(e.target.value as AssetType)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="size-presets">{[8, 16, 32, 48, 64].map(size => <button type="button" className={newSize.width === size && newSize.height === size ? 'selected' : ''} key={size} onClick={() => setNewSize({ width: size, height: size })}>{size}×{size}</button>)}</div><div className="form-row"><label>Breite<input type="number" min="1" max="64" value={newSize.width} onChange={e => setNewSize(s => ({ ...s, width: Number(e.target.value) }))} required/></label><span>×</span><label>Höhe<input type="number" min="1" max="64" value={newSize.height} onChange={e => setNewSize(s => ({ ...s, height: Number(e.target.value) }))} required/></label></div></>}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" type="button" onClick={() => setDialog(null)} disabled={busy}>Abbrechen</button><button className="button primary" disabled={busy || !newName.trim()} type="submit"><Icon name="plus" size={17}/>{busy ? 'Wird erstellt …' : dialog === 'project' ? 'Projekt erstellen' : dialog === 'variant' ? 'Variante erstellen' : 'Asset erstellen'}</button></div></form></section></div>}
    {dialog === 'mcp' && <div className="modal-backdrop mcp-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}>
      <section ref={modalRef} className="modal mcp-modal" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
        <div className="mcp-heading"><span className="document-icon"><Icon name="server" size={22}/></span><div><h2 id="mcp-title">MCP-Server</h2><p>Deine Verbindung zum Pixel Artist</p></div><IconButton icon="close" label="MCP-Fenster schließen" autoFocus onClick={() => setDialog(null)}/></div>
        <div className="mcp-connection"><span>Serverstatus</span><span className={`connection${connected && mcpStatus?.running ? '' : ' offline'}`} role="status"><i/>{mcpLabel}</span></div>
        <div className="mcp-connection"><span>Editor-Verbindung</span><span className={`connection${connected ? '' : ' offline'}`}><i/>{connected ? 'Verbunden' : 'Unterbrochen'}</span></div>
        <div className="mcp-stats">
          <div><span>Laufzeit</span><strong>{connected && mcpStatus?.running ? `${Math.floor(mcpUptime / 3600)}:${String(Math.floor(mcpUptime / 60) % 60).padStart(2, '0')}:${String(mcpUptime % 60).padStart(2, '0')}` : '—'}</strong></div>
          <div><span>Aktive Anfragen</span><strong>{connected ? mcpStatus?.activeRequests ?? '—' : '—'}</strong></div>
          <div><span>Anfragen gesamt</span><strong>{mcpStatus?.requests ?? '—'}</strong></div>
          <div><span>Tool-Anfragen</span><strong>{mcpStatus?.toolCalls ?? '—'}</strong></div>
        </div>
        <label className="mcp-endpoint">MCP-Endpunkt<input aria-label="MCP-Endpunkt" readOnly value={mcpStatus?.endpoint ?? ''} placeholder="Wird geladen …"/></label>
        <p className="mcp-last-request">Letzte Anfrage <span>{mcpStatus?.lastRequestAt ? new Date(mcpStatus.lastRequestAt).toLocaleString('de-DE') : 'Noch keine'}</span></p>
        {mcpError && <p className="form-error" role="alert">{mcpError}</p>}
        <div className="mcp-actions"><button className="button primary" disabled={!connected || !mcpStatus || mcpStatus.running || mcpBusy} onClick={() => void controlMcp('start')}><Icon name="play" size={15}/>Start</button><button className="button mcp-stop" disabled={!connected || !mcpStatus?.running || mcpBusy} onClick={() => void controlMcp('stop')}><Icon name="stop" size={14}/>Stopp</button>{mcpBusy && <span role="status">Wird umgeschaltet …</span>}</div>
        <p className="mcp-note">Stopp pausiert neue MCP-Anfragen. Laufende Anfragen werden abgeschlossen. Statistiken zählen seit App-Start.</p>
      </section>
    </div>}
  </div>;
}
