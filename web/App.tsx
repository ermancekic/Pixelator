import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { getFrame, previewOperations, readIndices } from '../src/engine';
import { readPalette } from '../src/palette-formats';
import { AssetPreview, Miniature, paint, paintOnion } from './AssetPreview';
import { nextFrameId, nextPlayback, playbackRange, totalDuration } from './animation-helpers';
import type { LoopMode, OnionSettings, Playback } from './animation-helpers';
import { TagEditor, Timeline } from './Timeline';
import { ResizablePanel } from './ResizablePanel';
import { Icon, IconButton } from './icons';
import { appendStroke, brushOffsets, mirroredShapes, NO_WRAP, paintedRegion, PATTERNS, patternPoints, shadePoints, shadeRamp, strokePixels, wrappedRegion } from './drawing-helpers';
import type { BrushShape, Pattern, ShadeRamp, ShapeOperation, Wrap } from './drawing-helpers';
import { KEY_LABELS, TilePanel } from './TilePanel';
import type { TemplateHint } from './TilePanel';
import { autotileLayout, tileAt, tileGrid, tileRect } from '../src/tiles';
import { combineSelections, polygonSelection, rectSelection, selectionContains, selectionOutline, selectionScope, transformSelection, unionRect, wandSelection } from './selection-helpers';
import type { Selection, SelectionMode } from './selection-helpers';
import { clipPng, copyPixels, imageClip, mapClipColors, pasteOperation, pastePosition, sameClip } from './clipboard';
import type { ClipImage } from './clipboard';
import { CanvasSizeDialog } from './CanvasSizeDialog';
import { ReferenceOverlay, ReferencePanel, useReferenceImage } from './ReferenceImage';
import { ProjectBrowser } from './ProjectBrowser';
import { ExportDialog } from './ExportDialog';
import type { ExportFormat } from './ExportDialog';
import { MenuBar } from './MenuBar';
import type { Menu } from './MenuBar';
import { SettingsDialog } from './SettingsDialog';
import { I18nContext, localeOf, msg, serverMessage, setActiveLanguage, t } from './i18n';
import { loadSettings, resetPanelSizes, saveSettings } from './settings';
import type { Settings } from './settings';
import { createPanPreview, fitCanvas, MAX_ZOOM, MIN_ZOOM, panFromDrag, panTransform, resolveShortcut, zoomAt } from './view-helpers';
import type { CanvasView, Point, Tool } from './view-helpers';
import type { AnimationTagInput, ApplyResult, Asset, AssetDetail, AssetType, EditScope, McpStatus, Operation, Perspective, PixelDocument, PixelStyle, Project, ProjectStyle, Rect, Revision, RevisionSummary } from '../src/types';

type Dialog = 'projects' | 'project' | 'asset' | 'variant' | 'delete-asset' | 'delete-project' | 'shortcuts' | 'mcp' | 'tags' | 'canvas' | 'export' | 'settings' | 'about' | null;
/** Dialogs that only show or change interface state, so they stay available while a request runs. */
const PASSIVE_DIALOGS: Dialog[] = ['shortcuts', 'mcp', 'projects', 'settings', 'about'];
const typeLabels: Record<AssetType, string> = { character: msg('Charakter'), item: 'Item', prop: 'Prop', ui: msg('UI-Icon'), tileset: 'Tileset' };
const tools: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'pencil', label: msg('Stift'), key: 'P', icon: 'pencil' }, { id: 'eraser', label: msg('Radierer'), key: 'E', icon: 'eraser' },
  { id: 'shade', label: msg('Schattieren'), key: 'S', icon: 'shade' },
  { id: 'fill', label: msg('Füllen'), key: 'G', icon: 'fill' }, { id: 'eyedropper', label: msg('Pipette'), key: 'I', icon: 'dropper' },
  { id: 'line', label: msg('Linie'), key: 'L', icon: 'line' }, { id: 'rect', label: msg('Rechteck'), key: 'R', icon: 'rect' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse' }, { id: 'polygon', label: 'Polygon', key: 'U', icon: 'polygon' },
  { id: 'selection', label: msg('Auswahl'), key: 'V', icon: 'selection' }, { id: 'lasso', label: 'Lasso', key: 'Q', icon: 'lasso' },
  { id: 'wand', label: msg('Zauberstab'), key: 'W', icon: 'wand' }, { id: 'tile', label: msg('Kachel wählen'), key: 'T', icon: 'tile' },
  { id: 'move', label: msg('Verschieben'), key: 'M', icon: 'move' },
  { id: 'pan', label: msg('Ansicht verschieben'), key: 'H', icon: 'hand' },
];
async function api<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message ? serverMessage(data.error.message) : t('Anfrage fehlgeschlagen ({status})', { status: response.status })), { status: response.status });
  return data as T;
}
const requestId = () => crypto.randomUUID();
/** A PNG strip of square cells along its longer side, as Pixelator's own sheet export writes it. */
function stripFrames(base64: string): { count: number; size: number } | null {
  const header = atob(base64.slice(0, 44)); const read = (at: number) => ((header.charCodeAt(at) << 24) | (header.charCodeAt(at + 1) << 16) | (header.charCodeAt(at + 2) << 8) | header.charCodeAt(at + 3)) >>> 0;
  const width = read(16); const height = read(20); const size = Math.min(width, height); const count = Math.max(width, height) / size;
  return size > 0 && Number.isInteger(count) && count >= 2 && count <= 64 ? { count, size } : null;
}
const between = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 });
const fullScope = (doc: PixelDocument): EditScope => ({ layerIds: doc.layers.map(l => l.id), allowLayerChanges: true, allowPaletteChanges: true, allowFrameChanges: true });
const BRUSH_TOOLS: Tool[] = ['pencil', 'eraser', 'shade']; const PATTERN_TOOLS: Tool[] = ['pencil', 'line', 'rect', 'ellipse', 'polygon', 'fill'];
const MIRROR_TOOLS: Tool[] = ['pencil', 'eraser', 'shade', 'line', 'rect', 'ellipse', 'polygon']; const SELECT_TOOLS: Tool[] = ['selection', 'lasso', 'wand'];
const MAX_BRUSH = 16;
/** Tools whose pointer positions may leave the canvas in seamless mode; their strokes and shapes wrap to the other side. */
const WRAP_TOOLS: Tool[] = ['pencil', 'eraser', 'shade', 'line', 'rect', 'ellipse', 'polygon'];
type WrapMode = 'off' | 'x' | 'y' | 'both';
const GHOSTS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
/** Settings captured when a stroke or polygon starts, so later option changes do not alter it. */
type DrawContext = { base: PixelDocument; layerId: string; frameId: string; selection: Selection | null; color: number; secondary: number | null; filled: boolean; mirrorX: boolean; mirrorY: boolean; pixelPerfect: boolean; brush: [number, number][]; pattern: Pattern; shade: { ramp: number[]; direction: 1 | -1 }; wrap: Wrap };
type Stroke = DrawContext & { pointerId: number; start: Point; last: Point; points: Point[]; operations: Operation[]; scope: EditScope; tool: Tool; copy: boolean; selectMode: SelectionMode };
const allowed = (selection: Selection | null) => selection ? (x: number, y: number) => selectionContains(selection, x, y) : undefined;
const pixelsOperation = (layerId: string, frameId: string, points: [number, number, number][]): Operation[] => points.length ? [{ op: 'pixels', layerId, frameId, points }] : [];

/** Final operations for shapes: dithered cells, cells confined to a shaped selection, or the shapes themselves. */
function shapeOperations(shapes: ShapeOperation[], context: DrawContext): Operation[] {
  const { base, layerId, frameId, selection } = context;
  // Seamless mode folds shapes that cross an edge back onto the canvas.
  if (context.wrap.x || context.wrap.y) return pixelsOperation(layerId, frameId, patternPoints(wrappedRegion(base.width, base.height, shapes, context.wrap, allowed(selection)), context.pattern, context.color, context.pattern === 'solid' ? null : context.secondary));
  if (context.pattern !== 'solid') return pixelsOperation(layerId, frameId, patternPoints(paintedRegion(base, shapes, layerId, frameId, allowed(selection)), context.pattern, context.color, context.secondary));
  if (!selection) return shapes;
  const simulated = getFrame(previewOperations(base, shapes, { layerIds: [layerId], frameIds: [frameId] }), frameId).cels[layerId];
  const original = getFrame(base, frameId).cels[layerId]; const { rect } = selection; const pixels: number[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) pixels.push((selectionContains(selection, x, y) ? simulated : original)[y * base.width + x]);
  return [{ op: 'patch', layerId, frameId, ...rect, pixels }];
}

/** Pencil, eraser and shading cells of a brush stroke, mirrored and confined to the selection. */
function strokeOperations(tool: Tool, context: DrawContext, points: Point[]): Operation[] {
  const { base, layerId, frameId } = context;
  const region = strokePixels(points, base.width, base.height, 0, context.mirrorX, context.mirrorY, null, { brush: context.brush, allow: allowed(context.selection), wrap: context.wrap }).map(([x, y]) => [x, y] as [number, number]);
  if (tool === 'shade') return pixelsOperation(layerId, frameId, shadePoints(region, getFrame(base, frameId).cels[layerId], base.width, context.shade.ramp, context.shade.direction));
  return pixelsOperation(layerId, frameId, patternPoints(region, context.pattern, tool === 'eraser' ? 0 : context.color, context.secondary));
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings); setActiveLanguage(settings.language);
  const toggleSetting = (key: 'showLibrary' | 'showInspector' | 'showTimeline' | 'showGrid' | 'showTileGrid') => setSettings(current => ({ ...current, [key]: !current[key] }));
  const [projects, setProjects] = useState<Project[]>([]); const [projectId, setProjectId] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]); const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [search, setSearch] = useState(''); const [typeFilter, setTypeFilter] = useState('');
  const [tool, setTool] = useState<Tool>('pencil'); const [colorIndex, setColor] = useState(1); const [layerId, setLayerId] = useState(''); const [selectedFrameId, setSelectedFrameId] = useState('');
  const [playback, setPlayback] = useState<Playback | null>(null); const [loopMode, setLoopMode] = useState<LoopMode>('cycle'); const [onlyTag, setOnlyTag] = useState(false); const [onion, setOnion] = useState<OnionSettings>({ before: 0, after: 0 });
  const [fillReference, setFillReference] = useState<'layer' | 'composite'>('layer'); const [fillContiguous, setFillContiguous] = useState(true);
  const [mirrorX, setMirrorX] = useState(false); const [mirrorY, setMirrorY] = useState(false); const [pixelPerfect, setPixelPerfect] = useState(false);
  const [view, setView] = useState<CanvasView>({ zoom: 12, pan: { x: 0, y: 0 } }); const grid = settings.showGrid; const [filled, setFilled] = useState(false); const [copyMode, setCopyMode] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false); const [panning, setPanning] = useState(false); const zoom = view.zoom;
  const [selection, setSelection] = useState<Selection | null>(null); const [cursor, setCursor] = useState<Point | null>(null);
  const [secondaryIndex, setSecondary] = useState(0); const [brushSize, setBrushSize] = useState(1); const [brushShape, setBrushShape] = useState<BrushShape>('square');
  const [pattern, setPattern] = useState<Pattern>('solid'); const [patternSecondary, setPatternSecondary] = useState(false); const [shadeDirection, setShadeDirection] = useState<1 | -1>(1); const [shadeRampMode, setShadeRampMode] = useState<ShadeRamp>('palette');
  const [outlineCorners, setOutlineCorners] = useState(true); const [outlineReference, setOutlineReference] = useState<'layer' | 'composite'>('layer');
  const [replaceTarget, setReplaceTarget] = useState(1); const [replaceAllLayers, setReplaceAllLayers] = useState(false); const [replaceAllFrames, setReplaceAllFrames] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat | undefined>();
  const [lassoPath, setLassoPath] = useState<Point[] | null>(null); const [polygonPoints, setPolygonPoints] = useState<Point[] | null>(null);
  const [selectedTile, setSelectedTile] = useState<number | null>(null); const [templateHint, setTemplateHint] = useState<TemplateHint | null>(null); const [wrapMode, setWrapMode] = useState<WrapMode>('off');
  const [newTile, setNewTile] = useState({ size: 16, columns: 8, rows: 6 });
  const [preview, setPreview] = useState<PixelDocument | null>(null); const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [viewRevision, setViewRevision] = useState<Revision | null>(null); const [undoStack, setUndoStack] = useState<string[]>([]); const [redoStack, setRedoStack] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [connected, setConnected] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null); const [rightTab, setRightTab] = useState<'layers' | 'history'>('layers');
  const [presets, setPresets] = useState<Record<PixelStyle, ProjectStyle> | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null); const [mcpBusy, setMcpBusy] = useState(false); const [mcpError, setMcpError] = useState(''); const [mcpNow, setMcpNow] = useState(Date.now);
  const [newName, setNewName] = useState(''); const [newType, setNewType] = useState<AssetType>('character'); const [newSize, setNewSize] = useState({ width: 32, height: 32 });
  const [newPreset, setNewPreset] = useState<PixelStyle>('16-bit'); const [paletteText, setPaletteText] = useState(''); const [colorDraft, setColorDraft] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null); const onionRef = useRef<HTMLCanvasElement>(null); const fitPending = useRef(false); const artboardRef = useRef<HTMLDivElement>(null); const stageRef = useRef<HTMLDivElement>(null); const modalRef = useRef<HTMLElement>(null); const fileRef = useRef<HTMLInputElement>(null); const projectFileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false); const loadingRef = useRef(loading); const detailRef = useRef(detail); const projectIdRef = useRef(projectId); const assetLoadId = useRef(0); const assetListRequestId = useRef(0); const historyRequestId = useRef(0); const attemptedAutoOpen = useRef('');
  const stroke = useRef<Stroke | null>(null); const polygonDraft = useRef<(DrawContext & { points: Point[] }) | null>(null);
  const clipboardRef = useRef<ClipImage | null>(null); const pasteAsLayer = useRef(false); const paletteFileRef = useRef<HTMLInputElement>(null); const paletteDetailsRef = useRef<HTMLDetailsElement>(null);
  const spaceHeldRef = useRef(false); const viewRef = useRef(view); const dialogRef = useRef(dialog); const modalTriggerRef = useRef<HTMLElement | null>(null);
  const panDrag = useRef<{ pointerId: number; start: Point; pan: Point; preview: ReturnType<typeof createPanPreview> } | null>(null);
  const previewFrame = useRef<number | null>(null); const previewPoint = useRef<Point | null>(null);
  const openingAssetId = useRef('');
  viewRef.current = view; dialogRef.current = dialog;
  detailRef.current = detail; busyRef.current = busy; loadingRef.current = loading; projectIdRef.current = projectId;
  const project = projects.find(p => p.id === projectId); const document = preview ?? viewRevision?.document ?? detail?.revision.document; const activeLayer = document?.layers.find(l => l.id === layerId);
  const playingFrameId = playback && document ? document.frames[playback.index]?.id ?? null : null;
  const activeFrame = document ? document.frames.find(f => f.id === (playingFrameId ?? selectedFrameId)) ?? document.frames[0] : undefined; const frameId = activeFrame?.id ?? '';
  const frameIndex = document && activeFrame ? document.frames.indexOf(activeFrame) : 0; const animated = (document?.frames.length ?? 0) > 1; const onionVisible = animated && (onion.before > 0 || onion.after > 0);
  const color = Math.min(colorIndex, (document?.palette.length ?? 2) - 1); const secondary = Math.min(secondaryIndex, (document?.palette.length ?? 2) - 1);
  const wrap: Wrap = { x: wrapMode === 'x' || wrapMode === 'both', y: wrapMode === 'y' || wrapMode === 'both' };
  const tileset = document?.tileset; const ghostRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const reference = useReferenceImage(detail?.asset.id); const selectionPath = useMemo(() => selection?.mask ? selectionOutline(selection) : '', [selection]);
  const validation = viewRevision?.validation ?? detail?.revision.validation;
  const viewingPast = !!viewRevision && viewRevision.id !== detail?.asset.headRevisionId;
  const editable = !!detail && !busy && !loading && !viewingPast; const canDraw = editable && !!activeLayer && activeLayer.visible && !activeLayer.locked;
  const layerBelow = document && activeLayer ? document.layers[document.layers.indexOf(activeLayer) - 1] : undefined; const visibleLayers = document?.layers.filter(layer => layer.visible) ?? [];
  const canMergeDown = !!activeLayer && !!layerBelow && activeLayer.visible && layerBelow.visible && !activeLayer.locked && !layerBelow.locked; const canFlatten = visibleLayers.length > 1 && visibleLayers.every(layer => !layer.locked);
  const mcpLabel = !connected ? t('Nicht verbunden') : !mcpStatus ? t('Status wird geladen') : !mcpStatus.running ? t('Gestoppt') : mcpStatus.activeRequests ? t('Aktiv') : t('Bereit');
  const mcpUptime = mcpStatus?.startedAt ? Math.max(0, Math.floor((mcpNow - Date.parse(mcpStatus.startedAt)) / 1000)) : 0;

  const locale = localeOf(settings.language);
  /** Revision labels come from this editor in either language, from the server in English, or from agents as written. */
  const historyLabel = (label: string) => serverMessage(t(label));
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 4500); };
  const cancelPreviewFrame = () => { if (previewFrame.current !== null) window.cancelAnimationFrame(previewFrame.current); previewFrame.current = null; previewPoint.current = null; };
  const cancelInteraction = useCallback(() => {
    cancelPreviewFrame();
    const draw = stroke.current; stroke.current = null;
    if (draw) { setPreview(null); if (draw.tool === 'selection' || draw.tool === 'lasso') { setSelection(draw.selection); setLassoPath(null); } if (canvasRef.current?.hasPointerCapture(draw.pointerId)) canvasRef.current.releasePointerCapture(draw.pointerId); }
    if (polygonDraft.current) { polygonDraft.current = null; setPolygonPoints(null); setPreview(null); }
    const pan = panDrag.current; panDrag.current = null;
    if (pan) { const position = pan.preview.finish(); setView(current => ({ ...current, pan: position })); setPanning(false); if (stageRef.current?.hasPointerCapture(pan.pointerId)) stageRef.current.releasePointerCapture(pan.pointerId); }
  }, []);
  const clearEditor = useCallback(() => {
    cancelInteraction(); ++assetLoadId.current; ++historyRequestId.current;
    detailRef.current = null; loadingRef.current = false; openingAssetId.current = '';
    setDetail(null); setPreview(null); setViewRevision(null); setSelection(null); setSelectedTile(null); setCursor(null); setRevisions([]); setUndoStack([]); setRedoStack([]); setLayerId(''); setSelectedFrameId(''); setPlayback(null); setLoading(false);
    setDialog(current => current === 'delete-asset' || current === 'delete-project' ? null : current);
  }, [cancelInteraction]);
  const loadAssets = useCallback(async () => { const serial = ++assetListRequestId.current; if (!projectId) { setAssets([]); return; } try { const next = await api<Asset[]>(`/assets?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(search)}&type=${typeFilter}`); if (projectId === projectIdRef.current && serial === assetListRequestId.current) setAssets(next); } catch (e) { if (projectId === projectIdRef.current && serial === assetListRequestId.current) setError((e as Error).message); } }, [projectId, search, typeFilter]);
  const loadHistory = useCallback(async (id: string) => {
    const serial = ++historyRequestId.current; const assetLoad = assetLoadId.current;
    const relevant = () => serial === historyRequestId.current && assetLoad === assetLoadId.current && id === detailRef.current?.asset.id;
    try { const next = await api<RevisionSummary[]>(`/assets/${id}/revisions?summary=true`); if (relevant()) setRevisions(next); }
    catch (e) { if (relevant()) setError((e as Error).message); }
  }, []);
  const openRevision = async (revisionId: string) => {
    const current = detailRef.current; if (!current || busyRef.current || loadingRef.current || stroke.current) return;
    if (revisionId === current.asset.headRevisionId) { setViewRevision(null); setSelection(null); return; }
    const serial = ++assetLoadId.current; loadingRef.current = true; setLoading(true); setError('');
    try {
      const revision = await api<Revision>(`/assets/${current.asset.id}/revisions/${revisionId}`);
      if (serial === assetLoadId.current && current.asset.id === detailRef.current?.asset.id) { setViewRevision(revision); setSelection(null); }
    } catch (e) { if (serial === assetLoadId.current) setError((e as Error).message); }
    finally { if (serial === assetLoadId.current) { loadingRef.current = false; setLoading(false); } }
  };
  const installDetail = useCallback((next: AssetDetail, keepLayer = true) => { detailRef.current = next; setDetail(next); setPreview(null); setViewRevision(null); setLayerId(previous => keepLayer && next.revision.document.layers.some(l => l.id === previous) ? previous : next.revision.document.layers.at(-1)?.id ?? ''); setColor(previous => Math.min(previous, next.revision.document.palette.length - 1)); if (!keepLayer) { setSelection(null); setRevisions([]); fitPending.current = true; } }, []);
  const openAsset = useCallback(async (id: string) => {
    if (busyRef.current) return;
    const serial = ++assetLoadId.current; openingAssetId.current = id; loadingRef.current = true; setLoading(true); setError(''); setSelection(null); setSelectedTile(null); setRevisions([]); setViewRevision(null); setUndoStack([]); setRedoStack([]); setSelectedFrameId(''); setPlayback(null);
    try { const next = await api<AssetDetail>(`/assets/${id}`); if (serial === assetLoadId.current && next.asset.projectId === projectIdRef.current) { installDetail(next, false); await loadHistory(id); } } catch (e) { if (serial === assetLoadId.current) setError((e as Error).message); } finally { if (serial === assetLoadId.current) { openingAssetId.current = ''; loadingRef.current = false; setLoading(false); } }
  }, [installDetail, loadHistory]);
  useEffect(() => { let cancelled = false; Promise.all([api<Project[]>('/projects'), api<Record<PixelStyle, ProjectStyle>>('/presets')]).then(([list, styles]) => { if (!cancelled) { const requestedProject = new URLSearchParams(window.location.search).get('project'); setProjects(list); setPresets(styles); setProjectId(list.find(p => p.id === requestedProject)?.id ?? list[0]?.id ?? ''); } }).catch(e => setError(e.message)).finally(() => setLoading(false)); return () => { cancelled = true; }; }, []);
  useEffect(() => { void loadAssets(); }, [loadAssets]);
  useEffect(() => { attemptedAutoOpen.current = ''; setAssets([]); clearEditor(); }, [projectId, clearEditor]);
  useEffect(() => { if (!detail && assets.length && assets[0].projectId === projectId && !loading && !busy && attemptedAutoOpen.current !== assets[0].id) { attemptedAutoOpen.current = assets[0].id; void openAsset(assets[0].id); } }, [assets, projectId, detail, loading, busy, openAsset]);
  useEffect(() => { if (document && canvasRef.current) paint(canvasRef.current, document, { frameId }); }, [document, frameId]);
  useEffect(() => { if (document && wrapMode !== 'off') for (const ghost of ghostRefs.current) if (ghost) paint(ghost, document, { frameId }); }, [document, frameId, wrapMode]);
  useEffect(() => { if (selectedTile !== null && (!tileset || selectedTile >= tileGrid(tileset, document!.width, document!.height).count)) setSelectedTile(null); }, [tileset, document?.width, document?.height, selectedTile]);
  // Fit a newly opened asset after layout, once the timeline below the stage has taken its height.
  useLayoutEffect(() => { if (fitPending.current && document && stageRef.current) { fitPending.current = false; const area = stageRef.current.getBoundingClientRect(); setView(fitCanvas(document.width, document.height, area.width, area.height)); } }, [document]);
  useEffect(() => { if (document && onionRef.current && onionVisible) paintOnion(onionRef.current, document, frameId, onion); }, [document, frameId, onionVisible, onion.before, onion.after]);
  useEffect(() => {
    if (!playback || !document) return;
    const frame = document.frames[playback.index];
    if (!frame) { setPlayback(null); return; }
    // Each frame stays visible for its own duration, like Pixelorama's one-shot animation timer.
    const timer = window.setTimeout(() => {
      const next = nextPlayback(playback, playbackRange(document.frames.length, document.tags, playback.index, onlyTag), loopMode);
      setSelectedFrameId(document.frames[next.index]?.id ?? '');
      setPlayback(next.playing ? next : null);
    }, frame.durationMs);
    return () => window.clearTimeout(timer);
  }, [playback, document, loopMode, onlyTag]);
  useEffect(() => { if (document) setPaletteText(document.palette.slice(1).join(', ')); }, [document?.palette.join(',')]);
  useEffect(() => { setColorDraft(document?.palette[color] ?? ''); }, [document?.palette.join(','), color]);
  useEffect(() => {
    let disposed = false; let pending = false; let refreshing = false;
    const refresh = async () => {
      const current = detailRef.current;
      if (disposed || !pending || refreshing || !current || busyRef.current || loadingRef.current || stroke.current || polygonDraft.current) return;
      pending = false; refreshing = true; const assetLoad = assetLoadId.current;
      try {
        const next = await api<AssetDetail>(`/assets/${current.asset.id}`);
        if (disposed || assetLoad !== assetLoadId.current || next.asset.id !== detailRef.current?.asset.id) return;
        if (busyRef.current || loadingRef.current || stroke.current || polygonDraft.current || current.asset.headRevisionId !== detailRef.current?.asset.headRevisionId) { pending = true; return; }
        if (next.asset.headRevisionId !== current.asset.headRevisionId) { installDetail(next); setUndoStack([]); setRedoStack([]); setSelection(null); flash(t('Asset extern aktualisiert')); void loadHistory(next.asset.id); }
      } catch (e) { if ((e as { status?: number }).status === 404 && assetLoad === assetLoadId.current && current.asset.id === detailRef.current?.asset.id) { clearEditor(); void loadAssets(); } }
      finally { refreshing = false; }
    };
    const refreshProjects = () => void api<Project[]>('/projects').then(list => { if (!disposed) { setProjects(list); if (!list.some(item => item.id === projectIdRef.current)) setProjectId(list[0]?.id ?? ''); } }).catch(() => {});
    const events = new EventSource('/api/events');
    events.onopen = () => { setConnected(true); pending = true; refreshProjects(); void loadAssets(); void refresh(); };
    events.onerror = () => setConnected(false);
    events.onmessage = event => { try {
      const change = JSON.parse(event.data) as { assetId?: string; projectId?: string; type: string; status?: McpStatus };
      if (change.type === 'mcp') { if (change.status) setMcpStatus(change.status); return; }
      if (change.type === 'project-deleted') {
        refreshProjects();
        if (change.projectId === projectIdRef.current) { pending = false; ++assetListRequestId.current; setAssets([]); clearEditor(); }
        return;
      }
      if (change.type === 'asset-deleted') {
        if (change.assetId === detailRef.current?.asset.id || change.assetId === openingAssetId.current) { pending = false; clearEditor(); }
        if (change.projectId === projectIdRef.current) { ++assetListRequestId.current; setAssets(list => list.filter(item => item.id !== change.assetId)); void loadAssets(); }
        return;
      }
      if (change.type === 'project') refreshProjects();
      if (change.projectId === projectId || !change.projectId) void loadAssets();
      if (change.assetId === detailRef.current?.asset.id) { pending = true; void refresh(); }
    } catch { /* Ignore malformed events. */ } };
    // Deferred events survive a stroke or save; no requests are made while idle.
    const deferred = window.setInterval(() => void refresh(), 500);
    return () => { disposed = true; window.clearInterval(deferred); events.close(); };
  }, [projectId, loadAssets, installDetail, loadHistory, clearEditor]);
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
    const before = detail; const assetLoad = assetLoadId.current; setBusy(true); busyRef.current = true; setError('');
    try {
      const result = await api<ApplyResult>(`/assets/${before.asset.id}/operations`, { expectedRevision: before.asset.headRevisionId, requestId: requestId(), actor: 'human', label, editScope: editScope ?? fullScope(before.revision.document), operations });
      if (assetLoad !== assetLoadId.current) return;
      setUndoStack(stack => [...stack, before.asset.headRevisionId]); setRedoStack([]); installDetail(result); void loadAssets(); void loadHistory(before.asset.id);
      return result;
    } catch (e) { if (assetLoad !== assetLoadId.current) return; setPreview(null); setError((e as Error).message); try { const current = await api<AssetDetail>(`/assets/${before.asset.id}`); if (assetLoad !== assetLoadId.current) return; if (current.asset.headRevisionId !== before.asset.headRevisionId) { installDetail(current); setUndoStack([]); setRedoStack([]); setError(t('Das Asset wurde während der Anfrage geändert. Der aktuelle Stand ist geladen. Prüfe den letzten Zeichenstrich, bevor du ihn wiederholst.')); void loadHistory(before.asset.id); } } catch { /* Preserve the last saved document if the service is offline. */ } }
    finally { setBusy(false); busyRef.current = false; }
  };
  const restore = async (revisionId: string, direction?: 'undo' | 'redo') => {
    if (!detail || busyRef.current || loadingRef.current) return; const assetLoad = assetLoadId.current; setBusy(true); busyRef.current = true; const oldId = detail.asset.headRevisionId;
    try { const next = await api<AssetDetail>(`/assets/${detail.asset.id}/restore`, { revisionId, expectedRevision: oldId, requestId: requestId(), label: direction === 'undo' ? t('Rückgängig') : direction === 'redo' ? t('Wiederholen') : t('Version wiederhergestellt') });
      if (assetLoad !== assetLoadId.current) return;
      if (direction === 'undo') { setUndoStack(s => s.slice(0, -1)); setRedoStack(s => [...s, oldId]); } else if (direction === 'redo') { setRedoStack(s => s.slice(0, -1)); setUndoStack(s => [...s, oldId]); } else { setUndoStack(s => [...s, oldId]); setRedoStack([]); }
      installDetail(next); setSelection(null); void loadAssets(); void loadHistory(next.asset.id);
    } catch (e) { if (assetLoad !== assetLoadId.current) return; setError((e as Error).message); try { const current = await api<AssetDetail>(`/assets/${detail.asset.id}`); if (assetLoad !== assetLoadId.current) return; if (current.asset.headRevisionId !== oldId) { installDetail(current); setUndoStack([]); setRedoStack([]); setError(t('Das Asset wurde während der Anfrage geändert. Der aktuelle Stand ist geladen. Prüfe diese Version vor einer erneuten Wiederherstellung.')); void loadHistory(current.asset.id); } } catch { /* Keep the saved state available while offline. */ } } finally { setBusy(false); busyRef.current = false; }
  };
  const undo = () => { if (viewingPast || stroke.current || panDrag.current) return; const id = undoStack.at(-1); if (id) void restore(id, 'undo'); };
  const redo = () => { if (viewingPast || stroke.current || panDrag.current) return; const id = redoStack.at(-1); if (id) void restore(id, 'redo'); };
  const clearPixels = (area: Selection, label = t('Auswahl gelöscht')) => {
    if (!detail || !canDraw) return; const base = detail.revision.document; const raster = getFrame(base, frameId).cels[layerId]; const points: [number, number, number][] = []; const { rect } = area;
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) if (raster[y * base.width + x] && selectionContains(area, x, y)) points.push([x, y, 0]);
    if (points.length) return apply(pixelsOperation(layerId, frameId, points), label, { layerIds: [layerId], frameIds: [frameId], ...selectionScope(area) });
  };
  const clearSelection = () => { if (selection) void clearPixels(selection); };
  const swapColors = () => { setColor(secondary); setSecondary(color); };
  const drawContext = (base: PixelDocument): DrawContext => {
    const patterned = PATTERN_TOOLS.includes(tool) ? pattern : 'solid';
    return { base, layerId, frameId, selection, color, secondary: patterned !== 'solid' && patternSecondary ? secondary : null, filled, mirrorX, mirrorY, pixelPerfect, brush: brushOffsets(brushSize, brushShape), pattern: patterned, shade: { ramp: shadeRamp(base.palette, shadeRampMode), direction: shadeDirection }, wrap: WRAP_TOOLS.includes(tool) ? wrap : NO_WRAP };
  };
  const copySelection = async (merged: boolean, cut = false) => {
    if (!document || (!merged && !activeLayer)) return;
    const area = selection ?? rectSelection({ x: 0, y: 0, width: document.width, height: document.height });
    const clip = copyPixels(merged ? readIndices(document, undefined, frameId) : getFrame(document, frameId).cels[layerId], document.palette, document.width, area);
    if (clip.colors.every(value => value === null)) { flash(t('Keine sichtbaren Pixel zum Kopieren.')); return; }
    clipboardRef.current = clip;
    // The system clipboard receives a PNG for other programs; the editor keeps its own copy when that is unavailable.
    try { const blob = await clipPng(clip); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* Internal clipboard only. */ }
    if (cut) { if (!canDraw) { flash(t('Kopiert. Zum Ausschneiden eine sichtbare, entsperrte Ebene wählen.')); return; } await clearPixels(area, t('Ausgeschnitten')); }
    flash(cut ? t('Ausgeschnitten') : merged ? t('Sichtbare Ebenen kopiert') : t('Kopiert'));
  };
  const pasteClip = async (clip: ClipImage, asLayer: boolean) => {
    const current = detailRef.current; if (!current || !editable) return;
    const doc = current.revision.document;
    if (!asLayer && !canDraw) { flash(t('Wähle eine sichtbare, entsperrte Ebene oder füge als neue Ebene ein (Strg+Umschalt+V).')); return; }
    if (asLayer && doc.layers.length >= 32) { setError(t('Höchstens 32 Ebenen.')); return; }
    const mapped = mapClipColors(clip, doc.palette, doc.maxColors, !doc.paletteLocked);
    const { x, y } = pastePosition(clip, doc.width, doc.height, selection);
    const target = asLayer ? requestId() : layerId;
    const placed = pasteOperation(mapped.indices, clip, x, y, doc.width, doc.height, target, frameId);
    if (!placed) { flash(t('Nichts einzufügen.')); return; }
    const operations: Operation[] = [...(mapped.added ? [{ op: 'palette', colors: mapped.palette } as Operation] : []), ...(asLayer ? [{ op: 'add_layer', id: target, name: t('Eingefügt') } as Operation] : []), placed.operation];
    const result = await apply(operations, asLayer ? t('Als Ebene eingefügt') : t('Eingefügt'), mapped.added || asLayer ? fullScope(doc) : { layerIds: [layerId], frameIds: [frameId], rect: placed.rect });
    if (!result) return;
    if (asLayer) setLayerId(target);
    setSelection(placed.selection); setTool('move');
    flash([asLayer ? t('Als neue Ebene eingefügt') : t('Eingefügt'), mapped.added ? (mapped.added > 1 ? t('{count} Farben zur Palette hinzugefügt', { count: mapped.added }) : t('1 Farbe zur Palette hinzugefügt')) : '', mapped.approximated ? (mapped.approximated > 1 ? t('{count} Farben angenähert', { count: mapped.approximated }) : t('1 Farbe angenähert')) : '', placed.cropped ? t('auf die Leinwand zugeschnitten') : ''].filter(Boolean).join(' · '));
  };
  const pasteFromClipboard = async (asLayer: boolean) => {
    let clip = clipboardRef.current;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(value => value.startsWith('image/'));
        if (type) { const read = await imageClip(await item.getType(type)); clip = clipboardRef.current && sameClip(read, clipboardRef.current) ? clipboardRef.current : read; break; }
      }
    } catch { /* Reading may be denied; fall back to the editor's own copy. */ }
    if (clip) await pasteClip(clip, asLayer); else flash(t('Die Zwischenablage enthält kein Bild. Strg+V fügt Bilder aus anderen Programmen ein.'));
  };
  const changeZoom = (delta: number) => { if (!document || stroke.current || panDrag.current) return; setView(current => zoomAt(current, current.zoom + delta)); };
  const openExport = (format?: ExportFormat) => { if (!detailRef.current) return; setExportFormat(format); showDialog('export'); };
  const fitView = () => { if (!document || !stageRef.current || stroke.current || panDrag.current) return; const area = stageRef.current.getBoundingClientRect(); setView(fitCanvas(document.width, document.height, area.width, area.height)); };
  const showDialog = (kind: Exclude<Dialog, null>) => {
    if (!PASSIVE_DIALOGS.includes(kind) && (busyRef.current || loadingRef.current)) return;
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
      // The browser's paste event that follows carries the clipboard image; see the paste listener below.
      if (action === 'paste' || action === 'paste-layer') { pasteAsLayer.current = action === 'paste-layer'; return; }
      if (action === 'commit') { if (polygonDraft.current) { event.preventDefault(); commitPolygon(); } return; }
      // Selected page text keeps the browser's own copy.
      if ((action === 'copy' || action === 'copy-merged' || action === 'cut') && window.getSelection()?.toString()) return;
      if (stroke.current || panDrag.current) return;
      event.preventDefault();
      switch (action) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'export': openExport(); break;
        case 'settings': showDialog('settings'); break;
        case 'toggle-library': toggleSetting('showLibrary'); break;
        case 'toggle-timeline': toggleSetting('showTimeline'); break;
        case 'zoom-in': changeZoom(1); break;
        case 'zoom-out': changeZoom(-1); break;
        case 'fit': fitView(); break;
        case 'actual-size': if (document) setView({ zoom: 1, pan: { x: 0, y: 0 } }); break;
        case 'grid': toggleSetting('showGrid'); break;
        case 'help': showDialog('shortcuts'); break;
        case 'previous-frame': case 'next-frame': stepFrame(action === 'next-frame' ? 1 : -1); break;
        case 'play': togglePlay(); break;
        case 'onion': toggleOnion(); break;
        case 'delete': clearSelection(); break;
        case 'select-all': if (document) setSelection(rectSelection({ x: 0, y: 0, width: document.width, height: document.height })); break;
        case 'deselect': setSelection(null); break;
        case 'copy': case 'copy-merged': void copySelection(action === 'copy-merged'); break;
        case 'cut': void copySelection(false, true); break;
        case 'swap-colors': swapColors(); break;
        case 'brush-smaller': setBrushSize(size => Math.max(1, size - 1)); break;
        case 'brush-larger': setBrushSize(size => Math.min(MAX_BRUSH, size + 1)); break;
        default: setTool(action);
      }
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space' || event.key === ' ') { spaceHeldRef.current = false; setSpaceHeld(false); } };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); };
  });
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const asLayer = pasteAsLayer.current; pasteAsLayer.current = false;
      if (dialogRef.current || !detailRef.current || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      const file = [...(event.clipboardData?.items ?? [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
      if (!file && !clipboardRef.current) return;
      event.preventDefault();
      void (async () => {
        try {
          let clip = clipboardRef.current!;
          // A PNG this editor just copied comes back unchanged; keep the internal copy and its original position.
          if (file) { const read = await imageClip(file); clip = clipboardRef.current && sameClip(read, clipboardRef.current) ? clipboardRef.current : read; }
          await pasteClip(clip, asLayer);
        } catch (e) { setError((e as Error).message); }
      })();
    };
    window.document.addEventListener('paste', paste);
    return () => window.document.removeEventListener('paste', paste);
  });
  useEffect(() => { if (tool !== 'polygon' && polygonDraft.current) cancelInteraction(); }, [tool, cancelInteraction]);
  useEffect(() => { saveSettings(settings); window.document.documentElement.lang = settings.language; }, [settings]);
  useEffect(() => {
    const reset = () => { spaceHeldRef.current = false; setSpaceHeld(false); cancelInteraction(); };
    const visibility = () => { if (window.document.hidden) reset(); };
    window.addEventListener('blur', reset); window.document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', reset); window.document.removeEventListener('visibilitychange', visibility); cancelInteraction(); };
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
      if (event.key === 'Escape' && (PASSIVE_DIALOGS.includes(dialog) || !busyRef.current)) { event.preventDefault(); setDialog(null); }
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
    if (!document || !artboardRef.current || loading || dialog || panDrag.current || !event.isPrimary || !(event.button === 1 || (event.button === 0 && (spaceHeldRef.current || tool === 'pan')))) return;
    event.preventDefault(); event.stopPropagation(); cancelInteraction();
    panDrag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan: viewRef.current.pan, preview: createPanPreview(artboardRef.current, viewRef.current.pan) };
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus({ preventScroll: true }); setPanning(true); setCursor(null);
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDrag.current; if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); drag.preview.move(panFromDrag(drag.pan, drag.start, { x: event.clientX, y: event.clientY }));
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => { if (panDrag.current?.pointerId === event.pointerId) { if (event.type === 'pointerup') movePan(event); cancelInteraction(); } };
  /** Canvas pixel under the pointer, measured on the main canvas so seamless-mode ghost copies map to it as well. */
  const position = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect(); const free = WRAP_TOOLS.includes(tool);
    const axis = (value: number, size: number, wraps: boolean) => !wraps ? Math.max(0, Math.min(size - 1, value)) : free ? Math.max(-size, Math.min(2 * size - 1, value)) : ((value % size) + size) % size;
    return { x: axis(Math.floor((event.clientX - rect.left) / rect.width * document!.width), document!.width, wrap.x), y: axis(Math.floor((event.clientY - rect.top) / rect.height * document!.height), document!.height, wrap.y) };
  };
  const previewStroke = (end: Point) => {
    const current = stroke.current; if (!current) return;
    const { base } = current;
    if (current.tool === 'selection') { setSelection(combineSelections(current.selection, rectSelection(between(current.start, end)), current.selectMode, base.width, base.height)); current.last = end; return; }
    if (current.tool === 'lasso') { const last = current.points.at(-1); if (!last || last.x !== end.x || last.y !== end.y) current.points.push(end); current.last = end; setLassoPath([...current.points]); return; }
    const { layerId, frameId, color, filled, mirrorX, mirrorY, selection } = current;
    let operations: Operation[] = [];
    try {
      if (current.tool === 'pencil' || current.tool === 'eraser' || current.tool === 'shade') {
        appendStroke(current.points, current.last, end, current.tool === 'pencil' && current.pixelPerfect && current.brush.length === 1);
        operations = strokeOperations(current.tool, current, current.points);
      } else if (current.tool === 'line') operations = shapeOperations(mirroredShapes({ op: 'line', layerId, frameId, x1: current.start.x, y1: current.start.y, x2: end.x, y2: end.y, color }, base.width, base.height, mirrorX, mirrorY), current);
      else if (current.tool === 'rect' || current.tool === 'ellipse') operations = shapeOperations(mirroredShapes({ op: current.tool, layerId, frameId, ...between(current.start, end), color, filled }, base.width, base.height, mirrorX, mirrorY), current);
      else if (current.tool === 'move') {
        const rect = selection?.rect ?? { x: 0, y: 0, width: base.width, height: base.height }; let dx = end.x - current.start.x, dy = end.y - current.start.y;
        if (selection) { dx = Math.max(-rect.x, Math.min(base.width - rect.x - rect.width, dx)); dy = Math.max(-rect.y, Math.min(base.height - rect.y - rect.height, dy)); end = { x: current.start.x + dx, y: current.start.y + dy }; }
        operations = selection?.mask ? pixelsOperation(layerId, frameId, transformSelection(getFrame(base, frameId).cels[layerId], base.width, base.height, selection, { dx, dy }, current.copy).points) : [{ op: current.copy ? 'copy' : 'move', layerId, frameId, dx, dy, rect }];
        current.scope = { layerIds: [layerId], frameIds: [frameId], ...(selection ? { rect: unionRect(rect, { ...rect, x: rect.x + dx, y: rect.y + dy }) } : {}) };
      }
      current.last = end;
      if (!operations.length) { current.operations = []; setPreview(null); return; }
      setPreview(previewOperations(base, operations, current.scope)); current.operations = operations;
    } catch (e) { current.last = end; current.operations = []; setPreview(null); setNotice((e as Error).message); }
  };
  const polygonScope = (draft: DrawContext): EditScope => ({ layerIds: [draft.layerId], frameIds: [draft.frameId], ...(draft.selection ? selectionScope(draft.selection) : {}) });
  const polygonOperations = (draft: DrawContext, points: Point[]): Operation[] => {
    const unique = points.filter((point, i) => !i || point.x !== points[i - 1].x || point.y !== points[i - 1].y);
    const { layerId, frameId, color, filled, base } = draft;
    const shape: ShapeOperation | null = unique.length >= 3 ? { op: 'polygon', layerId, frameId, points: unique.map(point => [point.x, point.y] as [number, number]), color, filled }
      : unique.length === 2 ? { op: 'line', layerId, frameId, x1: unique[0].x, y1: unique[0].y, x2: unique[1].x, y2: unique[1].y, color } : null;
    return shape ? shapeOperations(mirroredShapes(shape, base.width, base.height, draft.mirrorX, draft.mirrorY), draft) : [];
  };
  const previewPolygon = (cursorPoint: Point) => {
    const draft = polygonDraft.current; if (!draft) return;
    try { const operations = polygonOperations(draft, [...draft.points, cursorPoint]); setPreview(operations.length ? previewOperations(draft.base, operations, polygonScope(draft)) : null); }
    catch (e) { setPreview(null); setNotice((e as Error).message); }
  };
  const commitPolygon = () => {
    const draft = polygonDraft.current; if (!draft) return;
    cancelPreviewFrame(); polygonDraft.current = null; setPolygonPoints(null);
    try { const operations = polygonOperations(draft, draft.points); if (operations.length) void apply(operations, 'Polygon', polygonScope(draft)); else setPreview(null); }
    catch (e) { setPreview(null); setError((e as Error).message); }
  };
  const addPolygonPoint = (base: PixelDocument, p: Point) => {
    const draft = polygonDraft.current;
    if (!draft) { polygonDraft.current = { ...drawContext(base), points: [p] }; setPolygonPoints([p]); previewPolygon(p); return; }
    const first = draft.points[0], last = draft.points.at(-1)!;
    if (draft.points.length >= 3 && p.x === first.x && p.y === first.y) { commitPolygon(); return; }
    if (p.x === last.x && p.y === last.y) return;
    if (draft.points.length >= 128) { flash(t('Ein Polygon hat höchstens 128 Ecken. Enter schließt es.')); return; }
    draft.points.push(p); setPolygonPoints([...draft.points]); previewPolygon(p);
  };
  const fillAt = (base: PixelDocument, p: Point) => {
    if (selection && !selectionContains(selection, p.x, p.y)) return;
    const scope: EditScope = { layerIds: [layerId], frameIds: [frameId], ...(selection ? selectionScope(selection) : {}) }; const context = drawContext(base);
    if (context.pattern === 'solid') { void apply([{ op: 'fill', layerId, frameId, x: p.x, y: p.y, color, reference: fillReference, contiguous: fillContiguous }], t('Fläche gefüllt'), scope); return; }
    // A dithered fill colors the region the bucket would fill, found like the magic wand does.
    const region = wandSelection(fillReference === 'composite' ? readIndices(base, undefined, frameId) : getFrame(base, frameId).cels[layerId], base.width, base.height, p.x, p.y, fillContiguous);
    const cells: [number, number][] = [];
    if (region) for (let y = region.rect.y; y < region.rect.y + region.rect.height; y++) for (let x = region.rect.x; x < region.rect.x + region.rect.width; x++) if (selectionContains(region, x, y) && (!selection || selectionContains(selection, x, y))) cells.push([x, y]);
    const operations = pixelsOperation(layerId, frameId, patternPoints(cells, context.pattern, color, context.secondary));
    if (operations.length) void apply(operations, t('Fläche mit Muster gefüllt'), scope);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!document || !detail || event.button !== 0 || !event.isPrimary || !editable || spaceHeldRef.current || tool === 'pan' || panDrag.current || stroke.current) return; event.preventDefault(); stageRef.current?.focus({ preventScroll: true }); if (busyRef.current) return; if (playback) setPlayback(null); const p = position(event); setCursor(p);
    const base = detail.revision.document; const mode: SelectionMode = event.shiftKey ? 'add' : event.altKey ? 'subtract' : 'replace';
    if (tool === 'eyedropper') { const index = p.y * document.width + p.x; let next = 0; const cels = getFrame(document, frameId).cels; for (let i = document.layers.length - 1; i >= 0; i--) { const layer = document.layers[i]; if (layer.visible && cels[layer.id][index]) { next = cels[layer.id][index]; break; } } if (event.altKey) setSecondary(next); else setColor(next); return; }
    if (tool === 'tile') { if (!base.tileset) { flash(t('Dieses Asset hat kein Kachelraster. Lege es im Bereich Kacheln an.')); return; } selectTile(tileAt(base.tileset, base.width, p.x, p.y)); return; }
    if (tool === 'wand') { const indices = fillReference === 'composite' ? readIndices(base, undefined, frameId) : getFrame(base, frameId).cels[layerId]; if (!indices) return; setSelection(combineSelections(selection, wandSelection(indices, base.width, base.height, p.x, p.y, fillContiguous), mode, base.width, base.height)); return; }
    const selecting = tool === 'selection' || tool === 'lasso';
    if (!selecting && !canDraw) { flash(t('Wähle eine sichtbare, entsperrte Ebene.')); return; }
    if (tool === 'fill') { fillAt(base, p); return; }
    if (tool === 'polygon') { addPolygonPoint(base, p); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    stroke.current = { ...drawContext(base), pointerId: event.pointerId, start: p, last: p, points: tool === 'lasso' ? [p] : [], operations: [], scope: { layerIds: [layerId], frameIds: [frameId], ...(selection && !selecting ? selectionScope(selection) : {}) }, tool, copy: tool === 'move' && (copyMode || event.altKey), selectMode: mode };
    previewStroke(p);
  };
  const schedulePreview = (p: Point, render: (end: Point) => void) => {
    previewPoint.current = p;
    if (previewFrame.current === null) previewFrame.current = window.requestAnimationFrame(() => { previewFrame.current = null; const end = previewPoint.current; previewPoint.current = null; if (end) render(end); });
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!document || panDrag.current) return; const p = position(event);
    setCursor(previous => previous?.x === p.x && previous.y === p.y ? previous : p);
    if (polygonDraft.current) { schedulePreview(p, end => { if (polygonDraft.current) previewPolygon(end); }); return; }
    const current = stroke.current; if (!current || current.pointerId !== event.pointerId) return;
    const previous = previewPoint.current ?? current.last; if (previous.x === p.x && previous.y === p.y) return;
    if (current.tool === 'pencil' || current.tool === 'eraser' || current.tool === 'shade') { appendStroke(current.points, current.last, p, current.tool === 'pencil' && current.pixelPerfect && current.brush.length === 1); current.last = p; }
    if (current.tool === 'lasso') { const last = current.points.at(-1); if (!last || last.x !== p.x || last.y !== p.y) current.points.push(p); }
    schedulePreview(p, end => { if (stroke.current) previewStroke(end); });
  };
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = stroke.current; if (!current || current.pointerId !== event.pointerId) return; cancelPreviewFrame(); previewStroke(position(event)); const completed = stroke.current!; stroke.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const { width, height } = current.base;
    if (current.tool === 'lasso') { setLassoPath(null); const shape = completed.points.length >= 3 ? polygonSelection(completed.points, width, height) : null; setSelection(shape ? combineSelections(completed.selection, shape, completed.selectMode, width, height) : completed.selectMode === 'replace' ? null : completed.selection); return; }
    if (current.tool === 'selection') return;
    if (completed.operations.length) {
      if (current.tool === 'move' && current.selection) setSelection({ rect: { ...current.selection.rect, x: current.selection.rect.x + completed.last.x - current.start.x, y: current.selection.rect.y + completed.last.y - current.start.y }, mask: current.selection.mask });
      void apply(completed.operations, current.copy ? t('Auswahl kopiert') : t(tools.find(item => item.id === current.tool)?.label ?? 'Zeichnen'), completed.scope);
    } else setPreview(null);
  };
  const selectTile = (id: number) => { const current = detailRef.current?.revision.document; if (!current?.tileset) return; setSelectedTile(id); setSelection(rectSelection(tileRect(current.tileset, current.width, id))); };
  const shiftHalf = () => {
    if (!canDraw || !document) return; const area = selection?.rect ?? { x: 0, y: 0, width: document.width, height: document.height };
    void apply([{ op: 'shift', layerId, frameId, dx: Math.floor(area.width / 2), dy: Math.floor(area.height / 2), ...(selection ? { rect: area } : {}) }], t('Um halbe Größe versetzt'), { layerIds: [layerId], frameIds: [frameId], ...(selection ? { rect: area } : {}) });
  };
  const selectFrame = (id: string) => { setPlayback(null); setSelectedFrameId(id); };
  const stepFrame = (delta: 1 | -1) => { if (!document) return; const count = document.frames.length; selectFrame(document.frames[(frameIndex + delta + count) % count].id); };
  const toggleOnion = () => setOnion(current => current.before || current.after ? { before: 0, after: 0 } : { before: 1, after: 0 });
  const togglePlay = () => { if (playback) setPlayback(null); else if (document && animated) setPlayback({ index: frameIndex, direction: 1, playing: true }); };
  const frameCommand = async (operations: Operation[], label: string, select?: string) => { setPlayback(null); const result = await apply(operations, label); if (result && select) setSelectedFrameId(select); return result; };
  const addFrame = () => { if (!document || !activeFrame) return; const id = nextFrameId(document.frames); void frameCommand([{ op: 'add_frame', id, index: frameIndex + 1, durationMs: activeFrame.durationMs }], t('Frame eingefügt'), id); };
  const duplicateFrame = () => { if (!document) return; const id = nextFrameId(document.frames); void frameCommand([{ op: 'duplicate_frame', frameId, id }], t('Frame dupliziert'), id); };
  const removeFrame = () => { if (!document || !animated || !window.confirm(t('Frame {number} löschen? Du kannst die Änderung rückgängig machen.', { number: frameIndex + 1 }))) return; void frameCommand([{ op: 'remove_frame', frameId }], t('Frame gelöscht'), document.frames[frameIndex + 1]?.id ?? document.frames[frameIndex - 1]?.id); };
  const moveFrame = (delta: -1 | 1) => { if (!document) return; const ids = document.frames.map(frame => frame.id); const target = frameIndex + delta; if (target < 0 || target >= ids.length) return; [ids[frameIndex], ids[target]] = [ids[target], ids[frameIndex]]; void frameCommand([{ op: 'reorder_frames', frameIds: ids }], t('Frame verschoben')); };
  const saveTags = async (tags: AnimationTagInput[]) => { if (await apply([{ op: 'set_tags', tags }], t('Tags geändert'))) setDialog(null); };
  const transform = (op: Extract<Operation, { op: 'flip' | 'rotate' }>, label: string) => {
    if (!canDraw || !detail) return; const scope = { layerIds: [layerId], frameIds: [frameId] };
    // Shaped selections, and rotations that swap a selection's width and height, are lifted and dropped in the editor.
    if (selection && (selection.mask || op.op === 'rotate')) {
      const base = detail.revision.document;
      try {
        const result = transformSelection(getFrame(base, frameId).cels[layerId], base.width, base.height, selection, op.op === 'flip' ? { axis: op.axis } : { turns: 1 });
        if (result.points.length) void apply(pixelsOperation(layerId, frameId, result.points), label, { ...scope, rect: unionRect(selection.rect, result.selection.rect) }).then(done => { if (done) setSelection(result.selection); });
      } catch (e) { setError((e as Error).message); }
      return;
    }
    void apply([{ ...op, ...(selection ? { rect: selection.rect } : {}) }], label, { ...scope, ...(selection ? { rect: selection.rect } : {}) });
  };
  const mergeDown = async () => {
    if (!document || !activeLayer) return; const below = document.layers[document.layers.indexOf(activeLayer) - 1]; if (!below) return;
    if (await apply([{ op: 'merge_layers', layerIds: [below.id, activeLayer.id] }], t('Ebenen zusammengeführt'))) setLayerId(below.id);
  };
  const flattenVisible = async () => {
    if (!document) return; const visible = document.layers.filter(layer => layer.visible);
    if (visible.length > 1 && await apply([{ op: 'merge_layers', layerIds: visible.map(layer => layer.id) }], t('Sichtbare Ebenen zusammengeführt'))) setLayerId(visible[0].id);
  };
  const drawOutline = () => { if (!canDraw || !color) return; void apply([{ op: 'outline', layerId, frameId, color, corners: outlineCorners, reference: outlineReference, ...(selection ? { rect: selection.rect } : {}) }], t('Kontur gezeichnet'), { layerIds: [layerId], frameIds: [frameId], ...(selection ? selectionScope(selection) : {}) }); };
  const replaceColor = () => {
    if (!detail || !editable || !activeLayer) return; const base = detail.revision.document; const target = Math.min(replaceTarget, base.palette.length - 1);
    const layers = (replaceAllLayers ? base.layers : [activeLayer]).filter(layer => !layer.locked); const frames = replaceAllFrames ? base.frames : base.frames.filter(frame => frame.id === frameId);
    const area = selection?.rect ?? { x: 0, y: 0, width: base.width, height: base.height }; const operations: Operation[] = [];
    for (const frame of frames) for (const layer of layers) {
      const pixels = frame.cels[layer.id]; let found = false;
      for (let y = area.y; y < area.y + area.height && !found; y++) for (let x = area.x; x < area.x + area.width; x++) if (pixels[y * base.width + x] === color && (!selection || selectionContains(selection, x, y))) { found = true; break; }
      if (found) operations.push({ op: 'replace', layerId: layer.id, frameId: frame.id, from: color, to: target, ...(selection ? { rect: selection.rect } : {}) });
    }
    if (!operations.length) { flash(layers.length ? t('Die aktive Farbe kommt im gewählten Bereich nicht vor.') : t('Alle gewählten Ebenen sind gesperrt.')); return; }
    if (operations.length > 512) { setError(t('Zu viele Ebenen und Frames auf einmal. Bitte weniger Frames oder Ebenen wählen.')); return; }
    void apply(operations, t('Farbe ersetzt'), { layerIds: layers.map(layer => layer.id), ...(replaceAllFrames ? {} : { frameIds: [frameId] }), ...(selection ? selectionScope(selection) : {}) });
  };
  const resizeCanvas = async (operation: Operation, label: string) => {
    fitPending.current = true;
    if (await apply([operation], label)) { setSelection(null); setDialog(null); } else fitPending.current = false;
  };
  const importPalette = async (file?: File) => {
    if (!file || !document) return;
    try {
      const colors = readPalette(await file.text());
      if (!colors.length) throw new Error(t('Die Datei enthält keine Farben.'));
      if (colors.length > document.maxColors) throw new Error(t('Die Palette hat {count} Farben; dieses Asset erlaubt höchstens {max}.', { count: colors.length, max: document.maxColors }));
      setPaletteText(colors.join(', ')); if (paletteDetailsRef.current) paletteDetailsRef.current.open = true;
      flash(t('{count} Farben geladen. Jetzt übernehmen oder Pixel zuordnen.', { count: colors.length }));
    } catch (e) { setError((e as Error).message.replace(/^[A-Z_]+: /, '')); }
    finally { if (paletteFileRef.current) paletteFileRef.current.value = ''; }
  };
  const applyPalette = (remap: 'index' | 'nearest') => void apply([{ op: 'palette', colors: ['#00000000', ...paletteText.split(/[\s,;]+/).filter(Boolean)], ...(remap === 'nearest' ? { remap } : {}) }], remap === 'nearest' ? t('Palette zugeordnet') : t('Palette geändert'));
  const duplicateLayer = async () => {
    if (!document || !activeLayer || !editable || document.layers.length >= 32) return;
    const id = requestId();
    const result = await apply([{ op: 'duplicate_layer', layerId: activeLayer.id, id, name: t('{name} Kopie', { name: activeLayer.name.slice(0, 150) }) }], t('Ebene dupliziert'));
    if (result) setLayerId(id);
  };
  const addLayer = async () => { if (!document || !editable || document.layers.length >= 32) return; const id = requestId(); const result = await apply([{ op: 'add_layer', id, name: t('Ebene {number}', { number: document.layers.length + 1 }) }], t('Ebene hinzugefügt')); if (result) setLayerId(id); };
  const removeLayer = () => { if (!document || !activeLayer || !editable || document.layers.length === 1 || activeLayer.locked) return; if (window.confirm(t('Ebene „{name}“ löschen? Du kannst die Änderung rückgängig machen.', { name: activeLayer.name }))) void apply([{ op: 'remove_layer', layerId }], t('Ebene gelöscht')); };
  const saveColor = () => { if (!document || !color || !editable || document.paletteLocked || colorDraft.toUpperCase() === document.palette[color].toUpperCase()) return; if (!/^#[0-9a-f]{6}$/i.test(colorDraft)) { setError(t('Verwende eine Hexfarbe im Format #RRGGBB.')); return; } const palette = [...document.palette]; palette[color] = colorDraft; void apply([{ op: 'palette', colors: palette }], t('Palettenfarbe geändert')); };
  const openDialog = (kind: Exclude<Dialog, null>) => { setError(''); setNewName(kind === 'project' ? '' : kind === 'variant' ? t('{name} · Variante', { name: detail?.asset.name ?? 'Asset' }) : ''); setNewSize({ width: project?.style.width ?? 32, height: project?.style.height ?? 32 }); showDialog(kind); };
  const deleteCurrent = async () => {
    if (busyRef.current || loadingRef.current) return;
    const asset = detailRef.current?.asset; const deletingProject = dialog === 'delete-project';
    if (deletingProject ? !project : !asset) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (deletingProject) {
        await api(`/projects/${project!.id}`, undefined, 'DELETE');
        ++assetListRequestId.current; setAssets([]); clearEditor();
        setProjects(list => list.filter(item => item.id !== project!.id));
        setProjectId(projects.find(item => item.id !== project!.id)?.id ?? '');
        flash(t('Projekt gelöscht'));
      } else {
        await api(`/assets/${asset!.id}`, undefined, 'DELETE');
        if (detailRef.current?.asset.id === asset!.id) clearEditor();
        setAssets(list => list.filter(item => item.id !== asset!.id));
        void loadAssets(); flash(t('Asset gelöscht'));
      }
      setDialog(null);
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const submitDialog = async (event: FormEvent) => {
    event.preventDefault(); if (dialog === 'shortcuts' || dialog === 'mcp' || !newName.trim() || busyRef.current || loadingRef.current) return; const assetLoad = assetLoadId.current; busyRef.current = true; setBusy(true); setError('');
    try {
      if (dialog === 'project') { const next = await api<Project>('/projects', { name: newName.trim(), preset: newPreset }); setProjects(list => [...list.filter(p => p.id !== next.id), next]); setProjectId(next.id); }
      else { const next = dialog === 'variant' && detail ? await api<AssetDetail>(`/assets/${detail.asset.id}/variant`, { name: newName.trim() }) : await api<AssetDetail>('/assets', { projectId, name: newName.trim(), type: newType, ...(newType === 'tileset' ? { width: newTile.columns * newTile.size, height: newTile.rows * newTile.size, tileWidth: newTile.size, tileHeight: newTile.size } : { width: newSize.width, height: newSize.height }) }); if (assetLoad !== assetLoadId.current || next.asset.projectId !== projectIdRef.current) return; installDetail(next, false); setUndoStack([]); setRedoStack([]); setSelection(null); void loadAssets(); void loadHistory(next.asset.id); }
      setDialog(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const importPng = async (file?: File) => {
    if (!file || !projectId || busyRef.current || loadingRef.current) return; const assetLoad = assetLoadId.current; busyRef.current = true; setBusy(true); setError('');
    try { const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error(t('Die Datei konnte nicht gelesen werden.'))); reader.readAsDataURL(file); }); const name = file.name.replace(/\.png$/i, ''); const strip = stripFrames(encoded); const sheet = strip && window.confirm(t('„{name}“ als Animation mit {count} Frames à {size} × {size} px importieren? Abbrechen importiert ein Einzelbild.', { name, count: strip.count, size: strip.size })) ? { frameWidth: strip.size, frameHeight: strip.size } : {}; const next = await api<AssetDetail>('/import', { projectId, name, type: 'prop', pngBase64: encoded, ...sheet }); if (assetLoad !== assetLoadId.current || next.asset.projectId !== projectIdRef.current) return; installDetail(next, false); setUndoStack([]); setRedoStack([]); void loadAssets(); void loadHistory(next.asset.id); flash(t('PNG verlustfrei importiert')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const importProject = async (file?: File) => {
    if (!file || busyRef.current || loadingRef.current) return; busyRef.current = true; setBusy(true); setError(''); try { const next = await api<Project>('/projects/import', { project: JSON.parse(await file.text()) }); setProjects(list => [...list.filter(p => p.id !== next.id), next]); setProjectId(next.id); flash(t('Projekt importiert')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (projectFileRef.current) projectFileRef.current.value = ''; }
  };
  const updateStyle = async (style: ProjectStyle) => { if (!project) return; setBusy(true); try { const next = await api<Project>(`/projects/${project.id}`, { style }, 'PATCH'); setProjects(list => list.map(p => p.id === next.id ? next : p)); flash(t('Projektstil gespeichert · gilt für neue Assets')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

  // The menu bar names the commands of the toolbars, panels and shortcuts in one place, like a desktop editor.
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const keys = (key: string, shift = false) => mac ? `${shift ? '⇧' : ''}⌘${key}` : `${t('Strg')}+${shift ? `${t('Umschalt')}+` : ''}${key}`;
  const shifted = (key: string) => mac ? `⇧${key}` : `${t('Umschalt')}+${key}`;
  const menus: Menu[] = [
    { id: 'file', label: t('Datei'), items: [
      { label: t('Neues Asset …'), disabled: !project || busy, action: () => openDialog('asset') },
      { label: t('Neues Projekt …'), disabled: busy, action: () => openDialog('project') },
      { label: t('Projekte …'), action: () => showDialog('projects') },
      'separator',
      { label: t('PNG importieren …'), disabled: !project || busy, action: () => fileRef.current?.click() },
      { label: t('Projekt importieren …'), disabled: busy, action: () => projectFileRef.current?.click() },
      'separator',
      { label: t('Exportieren …'), shortcut: keys('S'), disabled: !detail, action: () => openExport() },
      { label: t('Projekt exportieren'), disabled: !project, action: () => { if (project) window.location.assign(`/api/projects/${project.id}/export`); } },
      'separator',
      { label: t('Einstellungen …'), shortcut: keys(','), action: () => showDialog('settings') },
    ] },
    { id: 'edit', label: t('Bearbeiten'), items: [
      { label: t('Rückgängig'), shortcut: keys('Z'), disabled: !undoStack.length || busy || loading || viewingPast, action: undo },
      { label: t('Wiederholen'), shortcut: keys('Z', true), disabled: !redoStack.length || busy || loading || viewingPast, action: redo },
      'separator',
      { label: t('Ausschneiden'), shortcut: keys('X'), disabled: !canDraw, action: () => void copySelection(false, true) },
      { label: t('Kopieren'), shortcut: keys('C'), disabled: !document || !activeLayer, action: () => void copySelection(false) },
      { label: t('Sichtbare Ebenen kopieren'), shortcut: keys('C', true), disabled: !document, action: () => void copySelection(true) },
      { label: t('Einfügen'), shortcut: keys('V'), disabled: !editable, action: () => void pasteFromClipboard(false) },
      { label: t('Als neue Ebene einfügen'), shortcut: keys('V', true), disabled: !editable, action: () => void pasteFromClipboard(true) },
      'separator',
      { label: t('Alles auswählen'), shortcut: keys('A'), disabled: !document, action: () => { if (document) setSelection(rectSelection({ x: 0, y: 0, width: document.width, height: document.height })); } },
      { label: t('Auswahl aufheben'), shortcut: keys('D'), disabled: !selection, action: () => setSelection(null) },
      { label: t('Auswahl löschen'), shortcut: t('Entf'), disabled: !selection || !canDraw, action: clearSelection },
    ] },
    { id: 'view', label: t('Ansicht'), items: [
      { label: t('Vergrößern'), shortcut: '+', disabled: !document || zoom === MAX_ZOOM, action: () => changeZoom(1) },
      { label: t('Verkleinern'), shortcut: '−', disabled: !document || zoom === MIN_ZOOM, action: () => changeZoom(-1) },
      { label: t('Einpassen'), shortcut: 'F', disabled: !document, action: fitView },
      { label: t('Originalgröße'), shortcut: '1', disabled: !document, action: () => setView({ zoom: 1, pan: { x: 0, y: 0 } }) },
      'separator',
      { label: t('Pixelraster'), shortcut: shifted('G'), checked: settings.showGrid, action: () => toggleSetting('showGrid') },
      { label: t('Kachelraster'), checked: settings.showTileGrid, action: () => toggleSetting('showTileGrid') },
      { label: t('Zwiebelhaut'), shortcut: shifted('O'), checked: onionVisible, disabled: !animated, action: toggleOnion },
      'separator',
      { label: t('Assetbibliothek'), shortcut: keys('B'), checked: settings.showLibrary, action: () => toggleSetting('showLibrary') },
      { label: t('Eigenschaften'), checked: settings.showInspector, action: () => toggleSetting('showInspector') },
      { label: t('Animationsleiste'), shortcut: keys('J'), checked: settings.showTimeline, action: () => toggleSetting('showTimeline') },
      'separator',
      { label: t('Fensteraufteilung zurücksetzen'), action: resetPanelSizes },
    ] },
    { id: 'image', label: t('Bild'), items: [
      { label: t('Leinwandgröße …'), disabled: !editable, action: () => { setError(''); showDialog('canvas'); } },
      'separator',
      { label: t('Horizontal spiegeln'), disabled: !canDraw, action: () => transform({ op: 'flip', layerId, frameId, axis: 'x' }, t('Horizontal gespiegelt')) },
      { label: t('Vertikal spiegeln'), disabled: !canDraw, action: () => transform({ op: 'flip', layerId, frameId, axis: 'y' }, t('Vertikal gespiegelt')) },
      { label: t('90 Grad drehen'), disabled: !canDraw, action: () => transform({ op: 'rotate', layerId, frameId, turns: 1 }, t('90° gedreht')) },
      { label: t('Um halbe Größe versetzen'), disabled: !canDraw || !!selection?.mask, action: shiftHalf },
      { label: t('Kontur zeichnen'), disabled: !canDraw || !color, action: drawOutline },
      'separator',
      { label: t('Variante erstellen …'), disabled: !detail || busy || loading, action: () => openDialog('variant') },
      { label: t('Asset löschen …'), disabled: !detail || busy || loading, action: () => showDialog('delete-asset') },
    ] },
    { id: 'layer', label: t('Ebene'), items: [
      { label: t('Neue Ebene'), disabled: !editable || (document?.layers.length ?? 0) >= 32, action: () => void addLayer() },
      { label: t('Ebene duplizieren'), disabled: !editable || !activeLayer || (document?.layers.length ?? 0) >= 32, action: () => void duplicateLayer() },
      { label: t('Mit Ebene darunter zusammenführen'), disabled: !editable || !canMergeDown, action: () => void mergeDown() },
      { label: t('Sichtbare Ebenen zusammenführen'), disabled: !editable || !canFlatten, action: () => void flattenVisible() },
      'separator',
      { label: t('Ebene löschen'), disabled: !editable || !activeLayer || document?.layers.length === 1 || !!activeLayer?.locked, action: removeLayer },
    ] },
    { id: 'animation', label: t('Animation'), items: [
      { label: playback ? t('Anhalten') : t('Abspielen'), shortcut: 'K', disabled: !animated, action: togglePlay },
      { label: t('Vorheriger Frame'), shortcut: ',', disabled: !animated, action: () => stepFrame(-1) },
      { label: t('Nächster Frame'), shortcut: '.', disabled: !animated, action: () => stepFrame(1) },
      'separator',
      { label: t('Leeren Frame einfügen'), disabled: !editable || (document?.frames.length ?? 64) >= 64, action: addFrame },
      { label: t('Frame duplizieren'), disabled: !editable || (document?.frames.length ?? 64) >= 64, action: duplicateFrame },
      { label: t('Frame löschen'), disabled: !editable || !animated, action: removeFrame },
      'separator',
      { label: t('Tags bearbeiten …'), disabled: !editable, action: () => showDialog('tags') },
    ] },
    { id: 'help', label: t('Hilfe'), items: [
      { label: t('Tastenkürzel'), shortcut: '?', action: () => showDialog('shortcuts') },
      { label: t('MCP-Server …'), action: () => showDialog('mcp') },
      'separator',
      { label: t('Dokumentation'), action: () => window.open('https://github.com/ermancekic/Pixelator/tree/main/docs', '_blank', 'noopener') },
      { label: t('Über Pixelator'), action: () => showDialog('about') },
    ] },
  ];

  return <I18nContext.Provider value={settings.language}><div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => toggleSetting('showLibrary')} title={t('Bibliothek ein-/ausblenden')}><span className="brand-mark"><i/><i/><i/><i/><i/><i/><i/></span><span>pixelator<span className="brand-dot">.</span></span></button>
      <MenuBar menus={menus} label={t('Anwendungsmenü')}/>
      <div className="top-actions"><button className={`connection mcp-trigger${connected && mcpStatus?.running ? '' : ' offline'}`} onClick={() => showDialog('mcp')} aria-haspopup="dialog" aria-expanded={dialog === 'mcp'} aria-label={t('MCP-Server öffnen')} title={t('MCP-Server verwalten')}><Icon name="server" size={15}/><span>MCP</span><i/><span>{mcpLabel}</span><Icon name="arrow" size={13}/></button><IconButton icon="settings" label={t('Einstellungen (Strg+,)')} onClick={() => showDialog('settings')}/></div>
    </header>
    <main className={`workspace${!settings.showLibrary ? ' library-collapsed' : ''}`}>
      {settings.showLibrary && <ResizablePanel as="aside" id="library" label={t('Assetbibliothek')} className="library" edge="right" minSize={190} flexiblePanel=".editor">
        <div className="library-top">
          <div className="project-picker"><button className="project-switch" onClick={() => showDialog('projects')} aria-haspopup="dialog" aria-expanded={dialog === 'projects'} title={t('Projekt wechseln')}><Icon name="folder"/><span>{project?.name ?? t('Noch kein Projekt')}</span><Icon name="selector" size={15}/></button><IconButton icon="plus" label={t('Projekt erstellen')} onClick={() => openDialog('project')} disabled={busy}/><IconButton icon="trash" label={t('Projekt löschen')} onClick={() => showDialog('delete-project')} disabled={busy || loading || !project}/></div>
          <div className="library-title"><h2>Assets</h2><span className="count">{assets.length}</span></div>
          <label className="search-field"><Icon name="search" size={16}/><input placeholder={t('Assets durchsuchen …')} aria-label={t('Assets durchsuchen')} value={search} onChange={e => setSearch(e.target.value)}/></label>
          <div className="filter-tabs" aria-label={t('Assettyp filtern')}>{[['', msg('Alle')], ['character', msg('Charaktere')], ['item', 'Items'], ['prop', 'Props'], ['ui', 'UI'], ['tileset', 'Tiles']].map(([value, label]) => <button key={value} className={typeFilter === value ? 'selected' : ''} onClick={() => setTypeFilter(value)}>{t(label)}</button>)}</div>
        </div>
        <div className="asset-list">
          {!assets.length && <div className="library-empty"><Icon name="layers" size={30}/><p>{search || typeFilter ? t('Keine passenden Assets') : t('Noch keine Assets')}</p></div>}
          {assets.map(a => <button key={a.id} className={`asset-card${detail?.asset.id === a.id ? ' selected' : ''}`} onClick={() => !busy && void openAsset(a.id)} disabled={busy}><span className="asset-thumb checker"><img src={`/api/assets/${a.id}/thumbnail?revisionId=${a.headRevisionId}`} alt="" loading="lazy" decoding="async"/></span><span className="asset-description"><strong>{a.name}</strong><span>{t(typeLabels[a.type])} <i/> {a.style.width} × {a.style.height}</span></span><span className="asset-active-dot"/></button>)}
        </div>
        <div className="library-bottom"><button className="button primary wide" onClick={() => openDialog(project ? 'asset' : 'project')} disabled={busy}><Icon name="plus"/>{project ? t('Neues Asset') : t('Projekt erstellen')}</button><div className="split-actions"><button onClick={() => fileRef.current?.click()} disabled={!project || busy}><Icon name="import" size={15}/> {t('PNG importieren')}</button><button onClick={() => projectFileRef.current?.click()} disabled={busy} title={t('Pixelator-Projekt importieren')}><Icon name="folder" size={15}/></button></div></div>
      </ResizablePanel>}
      <section className="editor" aria-label={t('Pixeleditor')}>
        <div className="editor-heading"><div className="asset-heading"><span className="document-icon"><Icon name="rect"/></span><div><h1>{detail?.asset.name ?? t('Pixeleditor')}</h1>{detail && <span>{t(typeLabels[detail.asset.type])} <span className="sub-dot">·</span> {document?.width} × {document?.height} px <span className="sub-dot">·</span> {detail.asset.style.preset}</span>}</div></div><div className="heading-actions"><IconButton icon="crop" label={t('Leinwandgröße ändern oder zuschneiden')} disabled={!editable} onClick={() => { setError(''); showDialog('canvas'); }}/><IconButton icon="trash" label={t('Asset löschen')} disabled={!detail || busy || loading} onClick={() => showDialog('delete-asset')}/><IconButton icon="copy" label={t('Variante erstellen')} disabled={!detail || busy || loading} onClick={() => openDialog('variant')}/><button className="button export-button" disabled={!detail} onClick={() => openExport()} aria-haspopup="dialog" title={t('Bild, Sprite-Sheet, GIF, Tileset und mehr (Strg+S)')}><Icon name="export" size={16}/> {t('Exportieren')}</button></div></div>
        <div className="editor-toolbar"><div className="toolbar-history"><IconButton icon="undo" label={t('Rückgängig (Strg+Z)')} onClick={undo} disabled={!undoStack.length || busy || loading || viewingPast}/><IconButton icon="redo" label={t('Wiederholen (Strg+Umschalt+Z)')} onClick={redo} disabled={!redoStack.length || busy || loading || viewingPast}/><IconButton icon="copy" label={t('Kopieren (Strg+C)')} onClick={() => void copySelection(false)} disabled={!document || !activeLayer}/><IconButton icon="paste" label={t('Einfügen (Strg+V, als neue Ebene: Strg+Umschalt+V)')} onClick={() => void pasteFromClipboard(false)} disabled={!editable}/></div><span className="toolbar-divider"/><span className="tool-name">{t(tools.find(item => item.id === tool)!.label)}</span>
          {BRUSH_TOOLS.includes(tool) && <><label className="inline-check" title={t('Pinselgröße (< und >)')}>{t('Größe')} <select aria-label={t('Pinselgröße')} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))}>{Array.from({ length: MAX_BRUSH }, (_, i) => i + 1).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>{brushSize > 1 && <label className="inline-check">{t('Form')} <select aria-label={t('Pinselform')} value={brushShape} onChange={e => setBrushShape(e.target.value as BrushShape)}><option value="square">{t('Quadrat')}</option><option value="circle">{t('Kreis')}</option></select></label>}</>}
          {tool === 'shade' && <><label className="inline-check">{t('Richtung')} <select aria-label={t('Schattierrichtung')} value={shadeDirection} onChange={e => setShadeDirection(Number(e.target.value) as 1 | -1)}><option value={1}>{t('Aufhellen')}</option><option value={-1}>{t('Abdunkeln')}</option></select></label><label className="inline-check" title={t('Reihenfolge, in der Farben heller oder dunkler werden')}>{t('Rampe')} <select aria-label={t('Farbrampe')} value={shadeRampMode} onChange={e => setShadeRampMode(e.target.value as ShadeRamp)}><option value="palette">{t('Palettenreihenfolge')}</option><option value="luminance">{t('Helligkeit')}</option></select></label></>}
          {MIRROR_TOOLS.includes(tool) && <><label className="inline-check" title={t('Beim Zeichnen um die senkrechte Leinwandmitte spiegeln')}><input type="checkbox" checked={mirrorX} onChange={e => setMirrorX(e.target.checked)}/> {t('Links/rechts')}</label><label className="inline-check" title={t('Beim Zeichnen um die waagerechte Leinwandmitte spiegeln')}><input type="checkbox" checked={mirrorY} onChange={e => setMirrorY(e.target.checked)}/> {t('Oben/unten')}</label></>}
          {tool === 'pencil' && brushSize === 1 && <label className="inline-check" title={t('Überflüssige Eckpixel aus dem aktuellen Stiftstrich entfernen')}><input type="checkbox" checked={pixelPerfect} onChange={e => setPixelPerfect(e.target.checked)}/> Pixel-Perfect</label>}
          {PATTERN_TOOLS.includes(tool) && <><label className="inline-check" title={t('Dithering-Muster, an der Leinwand ausgerichtet')}>{t('Muster')} <select aria-label={t('Dithering-Muster')} value={pattern} onChange={e => setPattern(e.target.value as Pattern)}>{PATTERNS.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label>{pattern !== 'solid' && <label className="inline-check" title={t('Lücken des Musters mit der Zweitfarbe füllen (Rechtsklick auf eine Palettenfarbe)')}><input type="checkbox" checked={patternSecondary} onChange={e => setPatternSecondary(e.target.checked)}/> {t('Zweitfarbe')}</label>}</>}
          {(tool === 'fill' || tool === 'wand') && <><label className="inline-check"><input type="checkbox" checked={fillContiguous} onChange={e => setFillContiguous(e.target.checked)}/> {t('Zusammenhängend')}</label><label className="inline-check">{t('Referenz')} <select aria-label={t('Füllreferenz')} value={fillReference} onChange={e => setFillReference(e.target.value as 'layer' | 'composite')}><option value="layer">{t('Aktive Ebene')}</option><option value="composite">{t('Sichtbare Ebenen')}</option></select></label></>}{(tool === 'rect' || tool === 'ellipse' || tool === 'polygon') && <label className="inline-check"><input type="checkbox" checked={filled} onChange={e => setFilled(e.target.checked)}/> {t('Gefüllt')}</label>}{tool === 'polygon' && <span className="tool-option-hint">{t('Klick: Ecke · Enter/Doppelklick: schließen')}</span>}{SELECT_TOOLS.includes(tool) && <span className="tool-option-hint">{t('Umschalt: hinzufügen · Alt: abziehen')}</span>}{tool === 'move' && <label className="inline-check" title={t('Alternativ Alt beim Ziehen halten')}><input type="checkbox" checked={copyMode} onChange={e => setCopyMode(e.target.checked)}/> {t('Kopieren')} <span className="tool-option-hint">{t('(Alt + Ziehen)')}</span></label>}{selection && <button className="selection-chip" onClick={() => setSelection(null)}>{selection.rect.width} × {selection.rect.height} {selection.mask ? t('Freiform') : t('Auswahl')} <span>×</span></button>}<div className="toolbar-spacer"/><label className="inline-check" title={t('Nahtlos zeichnen: Striche und Formen laufen über den Rand auf der Gegenseite weiter; die Umgebung zeigt die Wiederholung')}>{t('Nahtlos')} <select aria-label={t('Nahtlos zeichnen')} value={wrapMode} onChange={e => setWrapMode(e.target.value as WrapMode)} disabled={!document}><option value="off">{t('aus')}</option><option value="x">{t('waagerecht')}</option><option value="y">{t('senkrecht')}</option><option value="both">{t('beide')}</option></select></label><IconButton icon="grid" label={t('Pixelraster ein-/ausblenden (Umschalt+G)')} active={grid} onClick={() => toggleSetting('showGrid')}/><span className="toolbar-divider"/><button className="zoom-button" onClick={() => changeZoom(-1)} disabled={!document || zoom === MIN_ZOOM} aria-label={t('Verkleinern (−)')}>−</button><button className="zoom-value" aria-label={t('Ansicht einpassen (F oder 0)')} title={t('Einpassen (F oder 0) · Originalgröße: 1')} onClick={fitView} disabled={!document}>{zoom * 100}%</button><button className="zoom-button" onClick={() => changeZoom(1)} disabled={!document || zoom === MAX_ZOOM} aria-label={t('Vergrößern (+)')}>+</button><span className="toolbar-divider"/><IconButton icon="keyboard" label={t('Tastenkürzel (?)')} onClick={() => showDialog('shortcuts')}/></div>
        {error && <div className="alert error" role="alert"><span>{error}</span><button aria-label={t('Fehlermeldung schließen')} onClick={() => setError('')}>×</button></div>}
        {viewingPast && <div className="alert past"><span>{t('Versionsvorschau')} · {historyLabel(viewRevision.label)}</span><button onClick={() => setViewRevision(null)}>{t('Zur aktuellen Version')}</button><button onClick={() => void restore(viewRevision.id)} disabled={busy || loading}>{t('Wiederherstellen')}</button></div>}
        <div className="canvas-workspace"><div className="tool-rail" role="toolbar" aria-label={t('Zeichenwerkzeuge')}>{tools.map(item => <IconButton key={item.id} icon={item.icon} label={`${t(item.label)} (${item.key})`} active={tool === item.id} onClick={() => setTool(item.id)} disabled={!detail}><span className="tool-key">{item.key}</span></IconButton>)}<span className="rail-divider"/><button className="color-pair" onClick={swapColors} disabled={!document} title={t('Farbe {color} · Zweitfarbe {secondary} · tauschen (X)', { color, secondary })} aria-label={t('Farbe {color} und Zweitfarbe {secondary} tauschen (X)', { color, secondary })}><span className={`secondary-chip${secondary === 0 ? ' checker' : ''}`} style={{ backgroundColor: secondary ? document?.palette[secondary] : undefined }}/><span className={`current-color${color === 0 ? ' checker' : ''}`} style={{ '--swatch': document?.palette[color] ?? '#abc887' } as CSSProperties}/></button></div>
          <div ref={stageRef} className={`canvas-stage tool-${tool}${spaceHeld || tool === 'pan' ? ' pan-ready' : ''}${panning ? ' is-panning' : ''}`} tabIndex={0} role="region" aria-label={t('Zeichenfläche')} onPointerDownCapture={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}>
            {document ? <><div ref={artboardRef} className={`canvas-artboard checker${grid && zoom >= 4 ? ' show-grid' : ''}`} style={{ width: document.width * zoom, height: document.height * zoom, transform: panTransform(view.pan), '--pixel-size': `${zoom}px` } as CSSProperties}>
              <ReferenceOverlay reference={reference.reference}/>
              {wrapMode !== 'off' && GHOSTS.map(([dx, dy], i) => (dx === 0 || wrap.x) && (dy === 0 || wrap.y) ? <canvas key={`${dx}:${dy}`} ref={element => { ghostRefs.current[i] = element; }} className="ghost-canvas" style={{ left: `${dx * 100}%`, top: `${dy * 100}%` }} aria-hidden="true" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onDoubleClick={() => commitPolygon()} onPointerCancel={event => { if (stroke.current?.pointerId === event.pointerId) cancelInteraction(); }}/> : null)}
              {onionVisible && <canvas ref={onionRef} className="onion-canvas" aria-hidden="true"/>}
              <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onDoubleClick={() => commitPolygon()} onPointerCancel={event => { if (stroke.current?.pointerId === event.pointerId) cancelInteraction(); }} onLostPointerCapture={event => { if (stroke.current?.pointerId === event.pointerId) cancelInteraction(); }} onPointerLeave={() => !stroke.current && setCursor(null)} aria-label={t('{name}, {width} mal {height} Pixel. {tool} aktiv.', { name: detail?.asset.name ?? 'Asset', width: document.width, height: document.height, tool: t(tools.find(item => item.id === tool)!.label) })}/>
              {tileset && settings.showTileGrid && <div className="tile-grid-overlay" style={{ backgroundSize: `${tileset.tileWidth * zoom}px ${tileset.tileHeight * zoom}px` }} aria-hidden="true"/>}
              {tileset && templateHint && <div className="template-hint" style={{ left: templateHint.x * tileset.tileWidth * zoom, top: templateHint.y * tileset.tileHeight * zoom, width: 8 * tileset.tileWidth * zoom, height: Math.ceil(autotileLayout(templateHint.template).length / 8) * tileset.tileHeight * zoom }} aria-hidden="true">{autotileLayout(templateHint.template).filter(cell => cell.key).map((cell, i) => <span key={cell.key} className="template-key" style={{ left: cell.column * tileset.tileWidth * zoom, top: cell.row * tileset.tileHeight * zoom, width: tileset.tileWidth * zoom, height: tileset.tileHeight * zoom }} title={t(KEY_LABELS[cell.key!])}><b>{i + 1}</b>{tileset.tileWidth * zoom >= 64 && <small>{t(KEY_LABELS[cell.key!])}</small>}</span>)}</div>}
              {selection && (selection.mask ? <svg className="selection-mask" viewBox={`0 0 ${document.width} ${document.height}`} preserveAspectRatio="none" aria-hidden="true"><path d={selectionPath}/></svg> : <div className="selection-overlay" style={{ left: selection.rect.x * zoom, top: selection.rect.y * zoom, width: selection.rect.width * zoom, height: selection.rect.height * zoom }}/>)}
              {(lassoPath || polygonPoints) && <svg className="path-overlay" viewBox={`0 0 ${document.width} ${document.height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={[...(lassoPath ?? polygonPoints ?? []), ...(polygonPoints && cursor ? [cursor] : [])].map(point => `${point.x + .5},${point.y + .5}`).join(' ')}/>{polygonPoints?.map((point, i) => <rect key={i} x={point.x + .25} y={point.y + .25} width=".5" height=".5"/>)}</svg>}</div></> : <div className="studio-empty"><span className="empty-canvas"><i/><i/><i/><i/><Icon name="spark" size={36}/></span><h2>{t('Kein Asset ausgewählt')}</h2><button className="button primary" onClick={() => openDialog(project ? 'asset' : 'project')}><Icon name="plus"/> {project ? t('Asset erstellen') : t('Projekt erstellen')}</button></div>}
            {loading && <div className="loading-overlay" role="status"><span className="spinner"/> {t('Laden …')}</div>}
          </div>
        </div>
        <div className="canvas-status"><span><span className={`status-dot${busy ? ' saving' : ''}`}/>{busy ? t('Wird gespeichert …') : preview ? t('Zeichnen …') : detail ? t('Gespeichert') : t('Bereit')}</span><span>{cursor && document ? `X ${((cursor.x % document.width) + document.width) % document.width} · Y ${((cursor.y % document.height) + document.height) % document.height}${tileset ? ` · ${t('Kachel')} ${tileAt(tileset, document.width, ((cursor.x % document.width) + document.width) % document.width, ((cursor.y % document.height) + document.height) % document.height)}` : ''}` : 'X — · Y —'}<i/>{t(document?.layers.length === 1 ? '1 Ebene' : '{count} Ebenen', { count: document?.layers.length ?? 0 })}<i/>{t(validation?.colorCount === 1 ? '1 Farbe' : '{count} Farben', { count: validation?.colorCount ?? 0 })}</span></div>
        {settings.showTimeline && detail && document && activeFrame && <Timeline doc={document} frameId={frameId} playingFrameId={playingFrameId} editable={editable} loop={loopMode} onlyTag={onlyTag} onion={onion} onSelect={selectFrame} onTogglePlay={togglePlay} onLoop={setLoopMode} onOnlyTag={setOnlyTag} onOnion={setOnion} onAdd={addFrame} onDuplicate={duplicateFrame} onRemove={removeFrame} onMove={moveFrame} onDuration={durationMs => void frameCommand([{ op: 'frame_duration', frameIds: [frameId], durationMs }], t('Frame-Dauer geändert'))} onEditTags={() => showDialog('tags')}/>}
      </section>
      {settings.showInspector && <ResizablePanel as="aside" id="inspector" label={t('Eigenschaften')} className="inspector" edge="left" minSize={230} flexiblePanel=".editor">
        <AssetPreview doc={document} frameId={playingFrameId ?? frameId} playing={!!playingFrameId}/>
        <ResizablePanel id="palette" label={t('Palette')} className="inspector-section palette-section" edge="bottom" minSize={130}><div className="section-heading"><span>{t('PALETTE')}</span><span className="muted">{t(document?.palette.length === 2 ? '1 FARBE' : '{count} FARBEN', { count: document ? document.palette.length - 1 : 0 })}</span></div><div className="palette-swatches">{document?.palette.map((c, i) => <button key={i} className={`swatch${i === color ? ' selected' : ''}${i === secondary ? ' secondary' : ''}${i === 0 ? ' checker' : ''}`} style={{ backgroundColor: i ? c : undefined }} aria-label={i ? t('Farbe {index}: {hex}', { index: i, hex: c }) : t('Transparent')} aria-pressed={i === color} title={`${i ? `${i} · ${c}` : t('Transparent')} · ${t('Rechtsklick: Zweitfarbe')}`} onClick={() => setColor(i)} onContextMenu={event => { event.preventDefault(); setSecondary(i); }}>{i === 0 && <span>╱</span>}</button>)}</div>{document && <div className="palette-current"><span className={`color-chip${color === 0 ? ' checker' : ''}`} style={{ backgroundColor: color ? document.palette[color] : undefined }}/>{color ? <input className="hex-input" aria-label={t('Hexfarbe')} value={colorDraft.toUpperCase()} onChange={e => setColorDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveColor(); }} maxLength={7} disabled={!editable || document.paletteLocked}/> : <span>{t('TRANSPARENT')}</span>}<span className="muted">#{color}</span>{color > 0 && <><input type="color" aria-label={t('Gewählte Palettenfarbe bearbeiten')} value={/^#[0-9a-f]{6}$/i.test(colorDraft) ? colorDraft : document.palette[color]} disabled={!editable || document.paletteLocked} onChange={e => setColorDraft(e.target.value)}/><IconButton icon="check" label={t('Palettenfarbe speichern')} disabled={!editable || document.paletteLocked || colorDraft.toUpperCase() === document.palette[color].toUpperCase()} onClick={saveColor}/></>}</div>}
          {document && <details ref={paletteDetailsRef} className="compact-details"><summary>{t('Palette bearbeiten')} {document.paletteLocked && <Icon name="lock" size={12}/>}</summary><textarea aria-label={t('Palettenfarben als Hexwerte')} value={paletteText} onChange={e => setPaletteText(e.target.value)} rows={3} disabled={!editable || document.paletteLocked}/><div className="palette-actions"><button className="button small" disabled={!editable || document.paletteLocked} onClick={() => applyPalette('index')} title={t('Jeder Farbindex erhält die Farbe an seiner Position')}>{t('Palette übernehmen')}</button><button className="button small" disabled={!editable || document.paletteLocked} onClick={() => applyPalette('nearest')} title={t('Jedes Pixel erhält die ähnlichste Farbe der neuen Palette')}>{t('Pixel zuordnen')}</button></div><p>{t('Übernehmen färbt jeden Farbindex global um. Pixel zuordnen sucht für jedes Pixel die ähnlichste neue Farbe.')}</p><div className="palette-files"><button className="button small" disabled={!editable || document.paletteLocked} onClick={() => paletteFileRef.current?.click()} title={t('GIMP (.gpl), JASC (.pal), Lospec/Hex (.hex) oder Paint.NET (.txt)')}><Icon name="import" size={13}/> {t('Datei laden …')}</button>{detail && <button className="button small" onClick={() => openExport('palette')}><Icon name="export" size={13}/> {t('Exportieren …')}</button>}</div></details>}</ResizablePanel>
        <ResizablePanel id="layers" label={t('Ebenen und Verlauf')} className="inspector-section layers-section" edge="bottom" minSize={185}><div className="inspector-tabs"><button className={rightTab === 'layers' ? 'selected' : ''} onClick={() => setRightTab('layers')}><Icon name="layers" size={14}/> {t('Ebenen')}</button><button className={rightTab === 'history' ? 'selected' : ''} onClick={() => setRightTab('history')}><Icon name="history" size={14}/> {t('Verlauf')}</button>{rightTab === 'layers' && <IconButton icon="plus" label={t('Ebene hinzufügen')} disabled={!editable || (document?.layers.length ?? 0) >= 32} onClick={() => void addLayer()}/>}</div>
          {rightTab === 'layers' ? <><div className="layer-list">{document?.layers.slice().reverse().map(layer => <div key={layer.id} className={`layer-row${layer.id === layerId ? ' selected' : ''}`}><IconButton icon={layer.visible ? 'eye' : 'hidden'} label={layer.visible ? t('{name} ausblenden', { name: layer.name }) : t('{name} einblenden', { name: layer.name })} disabled={!editable} onClick={() => void apply([{ op: 'update_layer', layerId: layer.id, visible: !layer.visible }], t('Ebenensichtbarkeit geändert'))}/><button className="layer-select" onClick={() => setLayerId(layer.id)} aria-label={t('Ebene {name} wählen', { name: layer.name })}><span className="layer-mini checker"><Miniature doc={document} layerId={layer.id} frameId={frameId}/></span><span>{layer.name}</span></button><IconButton icon={layer.locked ? 'lock' : 'unlock'} label={layer.locked ? t('{name} entsperren', { name: layer.name }) : t('{name} sperren', { name: layer.name })} disabled={!editable} onClick={() => void apply([{ op: 'update_layer', layerId: layer.id, locked: !layer.locked }], t('Ebenensperre geändert'))}/></div>)}</div>{activeLayer && <div className="layer-properties"><input key={`${activeLayer.id}-${activeLayer.name}`} aria-label={t('Ebenenname')} defaultValue={activeLayer.name} disabled={!editable} onBlur={e => { if (e.target.value.trim() && e.target.value !== activeLayer.name) void apply([{ op: 'update_layer', layerId, name: e.target.value.trim() }], t('Ebene umbenannt')); }}/><div><IconButton icon="arrow" label={t('Ebene nach oben')} disabled={!editable || document?.layers.at(-1)?.id === layerId} onClick={() => { if (!document) return; const ids = document.layers.map(l => l.id), i = ids.indexOf(layerId); [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]; void apply([{ op: 'reorder_layers', layerIds: ids }], t('Ebene verschoben')); }}/><IconButton icon="arrow" className="rotate-icon" label={t('Ebene nach unten')} disabled={!editable || document?.layers[0]?.id === layerId} onClick={() => { if (!document) return; const ids = document.layers.map(l => l.id), i = ids.indexOf(layerId); [ids[i], ids[i - 1]] = [ids[i - 1], ids[i]]; void apply([{ op: 'reorder_layers', layerIds: ids }], t('Ebene verschoben')); }}/><span/><IconButton icon="copy" label={t('Ebene duplizieren')} disabled={!editable || (document?.layers.length ?? 0) >= 32} onClick={() => void duplicateLayer()}/><IconButton icon="merge" label={t('Mit Ebene darunter zusammenführen')} disabled={!editable || !canMergeDown} onClick={() => void mergeDown()}/><IconButton icon="flatten" label={t('Sichtbare Ebenen zusammenführen')} disabled={!editable || !canFlatten} onClick={() => void flattenVisible()}/><IconButton icon="trash" label={t('Ebene löschen')} disabled={!editable || document?.layers.length === 1 || activeLayer.locked} onClick={removeLayer}/></div></div>}{document && <div className="transform-tools"><button disabled={!canDraw} onClick={() => transform({ op: 'flip', layerId, frameId, axis: 'x' }, t('Horizontal gespiegelt'))} title={t('Horizontal spiegeln')}>{t('↔ Spiegeln')}</button><button disabled={!canDraw} onClick={() => transform({ op: 'flip', layerId, frameId, axis: 'y' }, t('Vertikal gespiegelt'))} title={t('Vertikal spiegeln')}>↕</button><button disabled={!canDraw} onClick={() => transform({ op: 'rotate', layerId, frameId, turns: 1 }, t('90° gedreht'))} title={t('90 Grad drehen')}>↻ 90°</button><button disabled={!canDraw || !!selection?.mask} onClick={shiftHalf} title={selection?.mask ? t('Nur für Rechteck- und Kachelauswahl') : t('Inhalt um die halbe Breite und Höhe versetzen, mit Umlauf; zeigt Kachelnähte in der Mitte')}>⇲ ½</button></div>}{document && <details className="compact-details layer-tools"><summary>{t('Kontur und Farbe ersetzen')}</summary>
            <div className="tool-form"><select aria-label={t('Konturnachbarn')} value={outlineCorners ? '8' : '4'} onChange={e => setOutlineCorners(e.target.value === '8')}><option value="8">{t('Mit Ecken')}</option><option value="4">{t('Ohne Ecken')}</option></select><select aria-label={t('Konturreferenz')} title={t('Form, um die die Kontur gezogen wird')} value={outlineReference} onChange={e => setOutlineReference(e.target.value as 'layer' | 'composite')}><option value="layer">{t('Ebene')}</option><option value="composite">{t('Sichtbar')}</option></select><button className="button small" disabled={!canDraw || !color} onClick={drawOutline} title={color ? t('Kontur in der aktiven Farbe zeichnen') : t('Zuerst eine deckende Farbe wählen')}>{t('Kontur')}</button></div>
            <div className="tool-form"><span className="replace-from"><span className={`color-chip${color === 0 ? ' checker' : ''}`} style={{ backgroundColor: color ? document.palette[color] : undefined }}/>→</span><select aria-label={t('Aktive Farbe ersetzen durch')} value={Math.min(replaceTarget, document.palette.length - 1)} onChange={e => setReplaceTarget(Number(e.target.value))}>{document.palette.map((c, i) => <option key={i} value={i}>{i ? `${i} · ${c}` : t('Transparent')}</option>)}</select><button className="button small" disabled={!editable || !activeLayer} onClick={replaceColor}>{t('Ersetzen')}</button></div>
            <label>{t('Alle entsperrten Ebenen')}<input type="checkbox" checked={replaceAllLayers} onChange={e => setReplaceAllLayers(e.target.checked)}/></label><label>{t('Alle Frames')}<input type="checkbox" checked={replaceAllFrames} onChange={e => setReplaceAllFrames(e.target.checked)}/></label>
            <p>{t('Beide nutzen die aktive Farbe und bleiben innerhalb der Auswahl.')}</p></details>}</> : <div className="revision-list">{revisions.length ? [...revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => <button key={r.id} className={`revision-row${(viewRevision?.id ?? detail?.asset.headRevisionId) === r.id ? ' selected' : ''}`} disabled={busy || loading} onClick={() => void openRevision(r.id)}><span className="revision-dot"/><span><strong>{historyLabel(r.label)}</strong><small>{r.actor === 'agent' ? 'Agent' : r.actor === 'import' ? 'Import' : t('Du')} · {new Date(r.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small></span>{r.id === detail?.asset.headRevisionId && <span className="head-badge">{t('AKTUELL')}</span>}</button>) : <p className="empty-small">{t('Hier entsteht deine Asset-Historie.')}</p>}</div>}</ResizablePanel>
        {detail && document && <TilePanel assetId={detail.asset.id} doc={document} frameId={frameId} layerId={layerId} editable={editable} canDraw={canDraw} tile={selectedTile} onApply={(operations, label) => apply(operations, label)} onHint={setTemplateHint} onSelectTile={selectTile} onExport={() => openExport('tileset')}/>}
        {detail && document && <section className="inspector-section asset-details"><div className="section-heading"><span>{t('ASSET-DETAILS')}</span></div><dl><div><dt>{t('Auflösung')}</dt><dd><button className="link-button" disabled={!editable} onClick={() => { setError(''); showDialog('canvas'); }} title={t('Leinwandgröße ändern oder zuschneiden')}>{document.width} × {document.height}</button></dd></div><div><dt>{t('Farben verwendet')}</dt><dd>{validation?.colorCount ?? 0} / {document.maxColors}</dd></div><div><dt>Frames</dt><dd>{document.frames.length}{animated && ` · ${totalDuration(document.frames)} ms`}</dd></div><div><dt>{t('Perspektive')}</dt><dd>{detail.asset.style.perspective === 'side' ? t('Seitenansicht') : t('Frontansicht')}</dd></div><div><dt>{t('Licht')}</dt><dd>{detail.asset.style.lighting === 'upper-left' ? t('Links oben') : detail.asset.style.lighting}</dd></div></dl><div className="pivot-fields"><span>{t('Pivot (px)')}</span><input type="number" aria-label="Pivot X" min="0" max={document.width} step="0.5" key={`x-${document.pivot.x}`} defaultValue={document.pivot.x} disabled={!editable} onBlur={e => { const x = Number(e.target.value); if (x !== document.pivot.x) void apply([{ op: 'pivot', x, y: document.pivot.y }], t('Pivot geändert')); }}/><input type="number" aria-label="Pivot Y" min="0" max={document.height} step="0.5" key={`y-${document.pivot.y}`} defaultValue={document.pivot.y} disabled={!editable} onBlur={e => { const y = Number(e.target.value); if (y !== document.pivot.y) void apply([{ op: 'pivot', x: document.pivot.x, y }], t('Pivot geändert')); }}/></div>{(validation?.issues.length ?? 0) > 0 && <details className="validation-details"><summary>{(validation?.issues.length ?? 0) > 1 ? t('{count} Prüfhinweise', { count: validation?.issues.length ?? 0 }) : t('1 Prüfhinweis')}</summary>{validation?.issues.map((issue, i) => <p key={i} className={issue.severity}>{issue.message}</p>)}</details>}<button className="button small wide export-details" onClick={() => openExport()}><Icon name="export" size={13}/> {t('Exportieren …')}</button></section>}
        {detail && <ReferencePanel reference={reference.reference} disabled={!detail} onLoad={file => void reference.load(file).catch(e => setError((e as Error).message))} onChange={reference.update} onRemove={reference.remove}/>}
        {project && <section className="inspector-section project-style"><details className="compact-details"><summary>{t('Projektstil')} <span className="preset-badge">{project.style.preset}</span></summary><p>{t('Vorgabe für neue Assets. Bestehende Assets behalten ihren Stil.')}</p><label>{t('Stilprofil')}<select aria-label={t('Projekt-Stilprofil')} value={project.style.preset} disabled={busy} onChange={e => { const preset = e.target.value as PixelStyle; if (presets) void updateStyle({ ...presets[preset], width: project.style.width, height: project.style.height }); }}>{['1-bit', 'game-boy', '8-bit', '16-bit'].map(p => <option key={p}>{p}</option>)}</select></label><label>{t('Perspektive')}<select value={project.style.perspective} disabled={busy} onChange={e => void updateStyle({ ...project.style, perspective: e.target.value as Perspective })}><option value="side">{t('Seitenansicht')}</option><option value="front">{t('Frontansicht')}</option><option value="top-down">{t('Draufsicht')}</option><option value="three-quarter">{t('Dreiviertelansicht')}</option><option value="isometric">{t('Isometrisch')}</option></select></label><label>{t('Palette sperren')}<input type="checkbox" checked={project.style.paletteLocked} disabled={busy} onChange={e => void updateStyle({ ...project.style, paletteLocked: e.target.checked })}/></label><a className="button small" href={`/api/projects/${project.id}/export`}><Icon name="download" size={13}/> {t('Projekt exportieren')}</a></details></section>}
      </ResizablePanel>}
    </main>
    {notice && <div className="toast" role="status">{notice}</div>}
    <input ref={fileRef} type="file" accept="image/png,.png" hidden onChange={e => void importPng(e.target.files?.[0])}/><input ref={projectFileRef} type="file" accept="application/json,.json" hidden onChange={e => void importProject(e.target.files?.[0])}/><input ref={paletteFileRef} type="file" accept=".gpl,.hex,.pal,.txt,text/plain" hidden onChange={e => void importPalette(e.target.files?.[0])}/>
    {dialog === 'shortcuts' && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section ref={modalRef} className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"><div className="shortcuts-heading"><h2 id="shortcuts-title">{t('Tastenkürzel')}</h2><IconButton icon="close" label={t('Tastenkürzel schließen')} autoFocus onClick={() => setDialog(null)}/></div><div className="shortcut-groups"><section><h3>{t('Werkzeuge')}</h3><dl>{tools.map(item => <div key={item.id}><dt>{t(item.label)}</dt><dd><kbd>{item.key}</kbd></dd></div>)}</dl></section><section><h3>{t('Ansicht & Bearbeitung')}</h3><dl><div><dt>{t('Ansicht verschieben')}</dt><dd><kbd>{t('Leertaste')}</kbd> {t('+ Ziehen')}</dd></div><div><dt>{t('Ansicht verschieben')}</dt><dd>{t('Mittlere Maustaste')}</dd></div><div><dt>{t('Zoom am Mauszeiger')}</dt><dd>{t('Mausrad')}</dd></div><div><dt>{t('Vergrößern / verkleinern')}</dt><dd><kbd>+</kbd> / <kbd>−</kbd></dd></div><div><dt>{t('Einpassen & zentrieren')}</dt><dd><kbd>F</kbd> / <kbd>0</kbd></dd></div><div><dt>{t('Originalgröße (100 %)')}</dt><dd><kbd>1</kbd></dd></div><div><dt>{t('Raster ein-/ausblenden')}</dt><dd><kbd>{t('Umschalt G')}</kbd></dd></div><div><dt>{t('Rückgängig')}</dt><dd><kbd>{t('Strg Z')}</kbd></dd></div><div><dt>{t('Wiederholen')}</dt><dd><kbd>{t('Strg Umschalt Z')}</kbd></dd></div><div><dt>{t('Exportieren')}</dt><dd><kbd>{t('Strg S')}</kbd></dd></div><div><dt>{t('Einstellungen')}</dt><dd><kbd>{t('Strg ,')}</kbd></dd></div><div><dt>{t('Bibliothek ein-/ausblenden')}</dt><dd><kbd>{t('Strg B')}</kbd></dd></div><div><dt>{t('Animationsleiste ein-/ausblenden')}</dt><dd><kbd>{t('Strg J')}</kbd></dd></div><div><dt>{t('Auswahl löschen')}</dt><dd><kbd>{t('Entf')}</kbd></dd></div><div><dt>{t('Auswahl / Aktion abbrechen')}</dt><dd><kbd>{t('Esc')}</kbd></dd></div><div><dt>{t('Pixel kopieren')}</dt><dd><kbd>M</kbd>{t(', dann')} <kbd>{t('Alt')}</kbd> {t('+ Ziehen')}</dd></div><div><dt>{t('Alles auswählen / Auswahl aufheben')}</dt><dd><kbd>{t('Strg A')}</kbd> / <kbd>{t('Strg D')}</kbd></dd></div><div><dt>{t('Auswahl erweitern / abziehen')}</dt><dd><kbd>{t('Umschalt')}</kbd> / <kbd>{t('Alt')}</kbd> {t('+ Auswählen')}</dd></div><div><dt>{t('Kopieren / Ausschneiden')}</dt><dd><kbd>{t('Strg C')}</kbd> / <kbd>{t('Strg X')}</kbd></dd></div><div><dt>{t('Sichtbare Ebenen kopieren')}</dt><dd><kbd>{t('Strg Umschalt C')}</kbd></dd></div><div><dt>{t('Einfügen / als neue Ebene')}</dt><dd><kbd>{t('Strg V')}</kbd> / <kbd>{t('Strg Umschalt V')}</kbd></dd></div><div><dt>{t('Pinsel kleiner / größer')}</dt><dd><kbd>&lt;</kbd> / <kbd>&gt;</kbd> {t('oder')} <kbd>[</kbd> / <kbd>]</kbd></dd></div><div><dt>{t('Farbe und Zweitfarbe tauschen')}</dt><dd><kbd>X</kbd></dd></div><div><dt>{t('Zweitfarbe wählen')}</dt><dd>{t('Rechtsklick Palette,')} <kbd>{t('Alt')}</kbd> {t('+ Pipette')}</dd></div><div><dt>{t('Polygon schließen')}</dt><dd><kbd>{t('Enter')}</kbd> {t('/ Doppelklick')}</dd></div><div><dt>{t('Vorheriger / nächster Frame')}</dt><dd><kbd>,</kbd> / <kbd>.</kbd></dd></div><div><dt>{t('Animation abspielen / anhalten')}</dt><dd><kbd>K</kbd></dd></div><div><dt>{t('Zwiebelhaut ein/aus')}</dt><dd><kbd>{t('Umschalt O')}</kbd></dd></div><div><dt>{t('Diese Übersicht')}</dt><dd><kbd>?</kbd></dd></div></dl></section></div><p>{t('Beim Schreiben und in Dialogen bleiben die Kürzel inaktiv. Das Pixelraster erscheint ab 400 % Zoom. Auf dem Mac ersetzt ⌘ die Strg-Taste.')}</p></section></div>}
    {dialog === 'export' && detail && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section ref={modalRef} className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title"><ExportDialog assetId={detail.asset.id} name={detail.asset.name} doc={detail.revision.document} frameId={frameId} revisions={revisions.length} initialFormat={exportFormat} onClose={() => setDialog(null)}/></section></div>}
    {dialog === 'settings' && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section ref={modalRef} className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><SettingsDialog settings={settings} onChange={setSettings} onResetLayout={resetPanelSizes} onClose={() => setDialog(null)}/></section></div>}
    {dialog === 'about' && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section ref={modalRef} className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><div className="shortcuts-heading"><span className="brand about-brand"><span className="brand-mark"><i/><i/><i/><i/><i/><i/><i/></span><span id="about-title">pixelator<span className="brand-dot">.</span></span></span><IconButton icon="close" label={t('Info schließen')} autoFocus onClick={() => setDialog(null)}/></div><p>{t('Lokales Pixel-Art-Studio für Menschen und KI-Agenten: zeichnen, animieren, Tilesets bauen und über MCP mit Claude, Codex oder Antigravity zusammenarbeiten.')}</p><p className="about-links"><a href="https://github.com/ermancekic/Pixelator" target="_blank" rel="noreferrer">{t('GitHub')}</a><a href="https://github.com/ermancekic/Pixelator/tree/main/docs" target="_blank" rel="noreferrer">{t('Dokumentation')}</a></p></section></div>}
    {dialog === 'tags' && document && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(null); }}><section ref={modalRef} className="modal tags-modal" role="dialog" aria-modal="true" aria-labelledby="tags-title"><div className="shortcuts-heading"><h2 id="tags-title">{t('Animations-Tags')}</h2><IconButton icon="close" label={t('Tags schließen')} disabled={busy} onClick={() => setDialog(null)}/></div>{error && <p className="form-error" role="alert">{error}</p>}<TagEditor doc={document} frameIndex={frameIndex} busy={busy} onSave={tags => void saveTags(tags)} onCancel={() => setDialog(null)}/></section></div>}
    {dialog === 'projects' && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section ref={modalRef} className="modal projects-modal" role="dialog" aria-modal="true" aria-labelledby="projects-title"><ProjectBrowser projects={projects} currentId={projectId} busy={busy} onClose={() => setDialog(null)} onSelect={id => { if (busyRef.current) return; if (id !== projectIdRef.current) setProjectId(id); setDialog(null); }} onCreate={() => openDialog('project')} onImport={() => { setDialog(null); projectFileRef.current?.click(); }}/></section></div>}
    {dialog === 'canvas' && detail && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(null); }}><section ref={modalRef} className="modal canvas-modal" role="dialog" aria-modal="true" aria-labelledby="canvas-title"><div className="shortcuts-heading"><h2 id="canvas-title">{t('Leinwandgröße')}</h2><IconButton icon="close" label={t('Leinwanddialog schließen')} disabled={busy} onClick={() => setDialog(null)}/></div>{error && <p className="form-error" role="alert">{error}</p>}<CanvasSizeDialog doc={detail.revision.document} tile={detail.revision.document.tileset ? { width: detail.revision.document.tileset.tileWidth, height: detail.revision.document.tileset.tileHeight } : undefined} selection={selection?.rect ?? null} content={detail.revision.validation.boundingBox} busy={busy} onApply={(operation, label) => void resizeCanvas(operation, label)} onCancel={() => setDialog(null)}/></section></div>}
    {dialog && ['project', 'asset', 'variant'].includes(dialog) && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !busy && setDialog(null)}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-heading"><span className="document-icon"><Icon name={dialog === 'project' ? 'folder' : 'rect'} size={22}/></span><IconButton icon="close" label={t('Dialog schließen')} disabled={busy} onClick={() => setDialog(null)}/></div><h2 id="dialog-title">{dialog === 'project' ? t('Projekt erstellen') : dialog === 'variant' ? t('Variante erstellen') : t('Asset erstellen')}</h2>{dialog === 'variant' && <p>{t('Erstellt eine Kopie des aktuellen Assets.')}</p>}<form onSubmit={e => void submitDialog(e)}><label>{dialog === 'project' ? t('Projektname') : t('Assetname')}<input autoFocus value={newName} onChange={e => setNewName(e.target.value)} maxLength={120} required disabled={busy}/></label>{dialog === 'project' && <label>{t('Stilprofil')}<select value={newPreset} onChange={e => setNewPreset(e.target.value as PixelStyle)}>{['1-bit', 'game-boy', '8-bit', '16-bit'].map(p => <option key={p} value={p}>{p}</option>)}</select></label>}{dialog === 'asset' && <><label>{t('Assettyp')}<select value={newType} onChange={e => setNewType(e.target.value as AssetType)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>{newType === 'tileset' ? <><div className="size-presets">{[8, 16, 24, 32].map(size => <button type="button" className={newTile.size === size ? 'selected' : ''} key={size} onClick={() => setNewTile(t => ({ ...t, size }))}>{size}×{size} px</button>)}</div><div className="form-row"><label>{t('Spalten')}<input type="number" min="1" max="64" step="1" value={newTile.columns} onChange={e => setNewTile(t => ({ ...t, columns: Number(e.target.value) }))} required/></label><span>×</span><label>{t('Zeilen')}<input type="number" min="1" max="64" step="1" value={newTile.rows} onChange={e => setNewTile(t => ({ ...t, rows: Number(e.target.value) }))} required/></label></div><p className="form-hint-muted">{t('{count} Kacheln à {size} × {size} px · Leinwand {width} × {height} px. 8 × 6 reicht für ein Blob-Autotile.', { count: newTile.columns * newTile.rows, size: newTile.size, width: newTile.columns * newTile.size, height: newTile.rows * newTile.size })}</p></> : <><div className="size-presets">{[8, 16, 32, 48, 64].map(size => <button type="button" className={newSize.width === size && newSize.height === size ? 'selected' : ''} key={size} onClick={() => setNewSize({ width: size, height: size })}>{size}×{size}</button>)}</div><div className="form-row"><label>{t('Breite')}<input type="number" min="1" step="1" value={newSize.width} onChange={e => setNewSize(s => ({ ...s, width: Number(e.target.value) }))} required/></label><span>×</span><label>{t('Höhe')}<input type="number" min="1" step="1" value={newSize.height} onChange={e => setNewSize(s => ({ ...s, height: Number(e.target.value) }))} required/></label></div></>}</>}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" type="button" onClick={() => setDialog(null)} disabled={busy}>{t('Abbrechen')}</button><button className="button primary" disabled={busy || !newName.trim()} type="submit"><Icon name="plus" size={17}/>{busy ? t('Wird erstellt …') : dialog === 'project' ? t('Projekt erstellen') : dialog === 'variant' ? t('Variante erstellen') : t('Asset erstellen')}</button></div></form></section></div>}
    {(dialog === 'delete-asset' || dialog === 'delete-project') && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
      <section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">{dialog === 'delete-project' ? t('Projekt löschen?') : t('Asset löschen?')}</h2>
        <p>{dialog === 'delete-project' ? t('„{name}“ und alle zugehörigen Assets, Revisionen und Aufträge werden endgültig gelöscht.', { name: project?.name ?? '' }) : t('„{name}“ samt Revisionen und zugehörigen Aufträgen wird endgültig gelöscht. Varianten bleiben erhalten.', { name: detail?.asset.name ?? '' })}</p>
        <p>{t('Das lässt sich nicht rückgängig machen.')}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="button" autoFocus onClick={() => setDialog(null)} disabled={busy}>{t('Abbrechen')}</button><button className="button danger" disabled={busy || loading || (dialog === 'delete-project' ? !project : !detail)} onClick={() => void deleteCurrent()}><Icon name="trash" size={16}/>{busy ? t('Wird gelöscht …') : t('Endgültig löschen')}</button></div>
      </section>
    </div>}
    {dialog === 'mcp' && <div className="modal-backdrop mcp-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}>
      <section ref={modalRef} className="modal mcp-modal" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
        <div className="mcp-heading"><span className="document-icon"><Icon name="server" size={22}/></span><div><h2 id="mcp-title">{t('MCP-Server')}</h2><p>{t('Deine Verbindung zum Pixel Artist')}</p></div><IconButton icon="close" label={t('MCP-Fenster schließen')} autoFocus onClick={() => setDialog(null)}/></div>
        <div className="mcp-connection"><span>{t('Serverstatus')}</span><span className={`connection${connected && mcpStatus?.running ? '' : ' offline'}`} role="status"><i/>{mcpLabel}</span></div>
        <div className="mcp-connection"><span>{t('Editor-Verbindung')}</span><span className={`connection${connected ? '' : ' offline'}`}><i/>{connected ? t('Verbunden') : t('Unterbrochen')}</span></div>
        <section className="mcp-agents" aria-label={t('Agenten-Verbindungen')}>{(['claude', 'codex', 'antigravity'] as const).map(id => {
          const agent = mcpStatus?.agents?.[id]; const live = connected && mcpStatus?.running && agent?.connected;
          return <div className="mcp-agent" key={id}><div><strong>{id === 'claude' ? 'Claude' : id === 'codex' ? 'Codex' : 'Antigravity'}</strong><small>{agent?.lastSeenAt ? t('Letzter Kontakt: {time}', { time: new Date(agent.lastSeenAt).toLocaleTimeString(locale) }) : t('Noch kein Kontakt')}</small></div><span className={`connection${live ? '' : ' offline'}`} role="status"><i/>{!connected || !agent ? t('Unbekannt') : live ? t('Verbunden') : t('Nicht verbunden')}</span></div>;
        })}</section>
        {mcpError && <p className="form-error" role="alert">{mcpError}</p>}
        <div className="mcp-actions"><button className="button primary" disabled={!connected || !mcpStatus || mcpStatus.running || mcpBusy} onClick={() => void controlMcp('start')}><Icon name="play" size={15}/>Start</button><button className="button mcp-stop" disabled={!connected || !mcpStatus?.running || mcpBusy} onClick={() => void controlMcp('stop')}><Icon name="stop" size={14}/>{t('Stopp')}</button>{mcpBusy && <span role="status">{t('Wird umgeschaltet …')}</span>}</div>
        <div className="mcp-stats">
          <div><span>{t('Laufzeit')}</span><strong>{connected && mcpStatus?.running ? `${Math.floor(mcpUptime / 3600)}:${String(Math.floor(mcpUptime / 60) % 60).padStart(2, '0')}:${String(mcpUptime % 60).padStart(2, '0')}` : '—'}</strong></div>
          <div><span>{t('Aktive Anfragen')}</span><strong>{connected ? mcpStatus?.activeRequests ?? '—' : '—'}</strong></div>
          <div><span>{t('Anfragen gesamt')}</span><strong>{mcpStatus?.requests ?? '—'}</strong></div>
          <div><span>{t('Tool-Anfragen')}</span><strong>{mcpStatus?.toolCalls ?? '—'}</strong></div>
        </div>
        <label className="mcp-endpoint">{t('MCP-Endpunkt')}<input aria-label={t('MCP-Endpunkt')} readOnly value={mcpStatus?.endpoint ?? ''} placeholder={t('Wird geladen …')}/></label>
        <p className="mcp-last-request">{t('Letzte Anfrage')} <span>{mcpStatus?.lastRequestAt ? new Date(mcpStatus.lastRequestAt).toLocaleString(locale) : t('Noch keine')}</span></p>
        <p className="mcp-note">{t('Stopp pausiert neue MCP-Anfragen. Laufende Anfragen werden abgeschlossen. Inaktive Sitzungen enden nach 5 Minuten ohne Kontakt. Zähler seit App-Start.')}</p>
      </section>
    </div>}
  </div></I18nContext.Provider>;
}
