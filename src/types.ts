export type AssetType = 'character' | 'item' | 'prop' | 'ui' | 'tileset';
export type PixelStyle = '1-bit' | 'game-boy' | '8-bit' | '16-bit';
export interface Rect { x: number; y: number; width: number; height: number }
export interface PixelLayer { id: string; name: string; visible: boolean; locked: boolean }
/** One frame of the animation; cels hold one raster per layer ID. */
export interface PixelFrame { id: string; durationMs: number; cels: Record<string, number[]> }
export type TagDirection = 'forward' | 'reverse' | 'pingpong';
/** A named frame range; from/to are zero-based and inclusive. */
export interface AnimationTag { name: string; from: number; to: number; direction: TagDirection; loop: boolean }
export type AnimationTagInput = Pick<AnimationTag, 'name' | 'from' | 'to'> & Partial<Pick<AnimationTag, 'direction' | 'loop'>>;
export type TerrainMode = 'corner' | 'edge' | 'mixed';
export interface TerrainType { name: string; color: string }
/**
 * Metadata of one grid tile; id counts row by row. terrain has nine slots: Tiled's Wang ID order (top, top-right, right,
 * bottom-right, bottom, bottom-left, left, top-left) plus the center; 0 is unset, n refers to terrains[n - 1].
 * collision rectangles use pixel coordinates inside the tile.
 */
export interface TileInfo { id: number; name?: string; type?: string; probability?: number; collision?: Rect[]; terrain?: number[] }
/** A tile grid over the whole canvas, one terrain set and per-tile metadata; frames animate every tile together. */
export interface Tileset { tileWidth: number; tileHeight: number; terrainMode: TerrainMode; terrains: TerrainType[]; tiles: TileInfo[] }
export type TileInfoInput = { id: number } & { [K in Exclude<keyof TileInfo, 'id'>]?: TileInfo[K] | null };
export type AutotileTemplate = 'blob' | 'edge' | 'corner';
export interface PixelDocument {
  schemaVersion: 2;
  width: number;
  height: number;
  palette: string[];
  maxColors: number;
  paletteLocked: boolean;
  layers: PixelLayer[];
  frames: PixelFrame[];
  tags: AnimationTag[];
  pivot: { x: number; y: number };
  tileset?: Tileset;
}
/** A layer with the raster of one frame, as drawing and rendering code sees it. */
export type RasterLayer = PixelLayer & { pixels: number[] };
export interface FrameView { width: number; height: number; palette: string[]; layers: RasterLayer[] }
/** Stored documents written before animation support. */
export interface LegacyPixelDocument extends Omit<PixelDocument, 'schemaVersion' | 'layers' | 'frames' | 'tags'> { schemaVersion: 1; layers: RasterLayer[] }
export interface ProjectStyle {
  preset: PixelStyle;
  palette: string[];
  maxColors: number;
  paletteLocked: boolean;
  width: number;
  height: number;
  perspective: 'front' | 'side';
  lighting: string;
  outline: string;
  theme: string;
}
export interface Project { id: string; name: string; style: ProjectStyle; createdAt: string }
/** A project with what its overview card shows: asset count, last change and the most recently changed assets. */
export interface ProjectOverview extends Project { assetCount: number; updatedAt: string; previews: { id: string; name: string; headRevisionId: string }[] }
export interface Asset {
  id: string;
  projectId: string;
  name: string;
  type: AssetType;
  tags: string[];
  headRevisionId: string;
  sourceAssetId?: string;
  style: ProjectStyle;
  createdAt: string;
  updatedAt: string;
}
export interface Issue { code: string; severity: 'error' | 'warning'; message: string; layerId?: string; frameId?: string }
export interface FrameReport { frameId: string; opaquePixels: number; boundingBox: Rect | null }
export interface ValidationReport {
  valid: boolean;
  issues: Issue[];
  colorCount: number;
  opaquePixels: number;
  boundingBox: Rect | null;
  isolatedPixels: number;
  frames?: FrameReport[];
}
/** changedPixels counts changed (frame, position) pairs; boundingBox covers all frames. */
export interface PixelDiff { changedPixels: number; changedLayers: string[]; changedFrames: string[]; boundingBox: Rect | null }
export interface Revision {
  id: string;
  assetId: string;
  parentId: string | null;
  document: PixelDocument;
  label: string;
  actor: 'human' | 'agent' | 'import';
  runId?: string;
  operations: Operation[];
  validation: ValidationReport;
  createdAt: string;
}
export type RevisionSummary = Pick<Revision, 'id' | 'assetId' | 'parentId' | 'label' | 'actor' | 'createdAt'>;
export interface AssetDetail { asset: Asset; revision: Revision }
export interface EditScope {
  layerIds: string[];
  rect?: Rect;
  /** Writable pixels inside rect, one string per row: "#" writable, "." protected. */
  mask?: string[];
  /** Writable frames; omitted means every frame. */
  frameIds?: string[];
  allowPaletteChanges?: boolean;
  allowLayerChanges?: boolean;
  allowFrameChanges?: boolean;
}
type DrawingBase = { layerId: string; frameId?: string };
export type Operation =
  | (DrawingBase & { op: 'pixels'; points: [number, number, number][] })
  | (DrawingBase & { op: 'patch'; x: number; y: number; width: number; height: number; pixels: number[] })
  | (DrawingBase & { op: 'rows'; x: number; y: number; rows: string[]; mode?: 'replace' | 'over' })
  | (DrawingBase & { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: number })
  | (DrawingBase & { op: 'rect' | 'ellipse'; x: number; y: number; width: number; height: number; color: number; filled?: boolean })
  | (DrawingBase & { op: 'polygon'; points: [number, number][]; color: number; filled?: boolean })
  | (DrawingBase & { op: 'fill'; x: number; y: number; color: number; reference?: 'layer' | 'composite'; contiguous?: boolean })
  | (DrawingBase & { op: 'move' | 'copy'; dx: number; dy: number; rect?: Rect })
  | (DrawingBase & { op: 'flip'; axis: 'x' | 'y'; rect?: Rect })
  | (DrawingBase & { op: 'rotate'; turns: 1 | 2 | 3; rect?: Rect })
  | (DrawingBase & { op: 'replace'; from: number; to: number; rect?: Rect })
  | (DrawingBase & { op: 'outline'; color: number; rect?: Rect; reference?: 'layer' | 'composite'; corners?: boolean })
  | (DrawingBase & { op: 'shift'; dx: number; dy: number; rect?: Rect })
  | (DrawingBase & { op: 'autotile'; template: AutotileTemplate; x?: number; y?: number; terrain?: number })
  | (DrawingBase & { op: 'stamp'; sourceLayerId?: string; sourceFrameId?: string; rect?: Rect; dx?: number; dy?: number; mode?: 'over' | 'replace' })
  | { op: 'add_frame'; id: string; index?: number; durationMs?: number }
  | { op: 'duplicate_frame'; frameId: string; id: string; index?: number }
  | { op: 'remove_frame'; frameId: string }
  | { op: 'reorder_frames'; frameIds: string[] }
  | { op: 'frame_duration'; frameIds: string[]; durationMs: number }
  | { op: 'set_tags'; tags: AnimationTagInput[] }
  | { op: 'add_layer'; id: string; name: string }
  | { op: 'duplicate_layer'; layerId: string; id: string; name: string }
  | { op: 'remove_layer'; layerId: string }
  | { op: 'update_layer'; layerId: string; name?: string; visible?: boolean; locked?: boolean }
  | { op: 'reorder_layers'; layerIds: string[] }
  | { op: 'merge_layers'; layerIds: string[] }
  | { op: 'resize_canvas'; width: number; height: number; offsetX?: number; offsetY?: number }
  | { op: 'palette'; colors: string[]; remap?: 'index' | 'nearest' }
  | { op: 'pivot'; x: number; y: number }
  | { op: 'tileset'; tileWidth?: number; tileHeight?: number; terrainMode?: TerrainMode; terrains?: TerrainType[] }
  | { op: 'remove_tileset' }
  | { op: 'tile_properties'; tiles: TileInfoInput[] };
export interface ApplyRequest {
  expectedRevision: string;
  requestId: string;
  label?: string;
  actor?: 'human' | 'agent';
  runId?: string;
  editScope: EditScope;
  operations: Operation[];
}
export interface ApplyResult { asset: Asset; revision: Revision; diff: PixelDiff }
export interface Review {
  revisionId: string;
  observations: string;
  issues: string[];
  createdAt: string;
}
export interface ArtistRun {
  id: string;
  projectId: string;
  assetId?: string;
  prompt: string;
  status: 'active' | 'completed' | 'needs_review' | 'cancelled' | 'interrupted';
  reviews: Review[];
  inspectedRevisionId?: string;
  /** Frames shown by the latest inspection of inspectedRevisionId. */
  inspectedFrameIds?: string[];
  batchCount: number;
  createdAt: string;
  updatedAt: string;
}
export type McpAgent = 'claude' | 'codex' | 'antigravity';
export interface McpAgentStatus { connected: boolean; sessions: number; lastSeenAt: string | null }
export interface McpStatus {
  running: boolean;
  endpoint: string;
  startedAt: string | null;
  requests: number;
  toolCalls: number;
  activeRequests: number;
  lastRequestAt: string | null;
  agents: Record<McpAgent, McpAgentStatus>;
}
export interface CreateAssetInput {
  projectId: string;
  name: string;
  type: AssetType;
  tags?: string[];
  width?: number;
  height?: number;
  palette?: string[];
  maxColors?: number;
  layers?: { id: string; name: string }[];
  frames?: { id: string; durationMs?: number }[];
  animationTags?: AnimationTagInput[];
  tileWidth?: number;
  tileHeight?: number;
  sourceAssetId?: string;
  runId?: string;
}
