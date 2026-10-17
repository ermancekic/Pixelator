export type AssetType = 'character' | 'item' | 'prop' | 'ui';
export type PixelStyle = '1-bit' | 'game-boy' | '8-bit' | '16-bit';
export interface Rect { x: number; y: number; width: number; height: number }
export interface PixelLayer { id: string; name: string; visible: boolean; locked: boolean; pixels: number[] }
export interface PixelDocument {
  schemaVersion: 1;
  width: number;
  height: number;
  palette: string[];
  maxColors: number;
  paletteLocked: boolean;
  layers: PixelLayer[];
  pivot: { x: number; y: number };
}
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
export interface Issue { code: string; severity: 'error' | 'warning'; message: string; layerId?: string }
export interface ValidationReport {
  valid: boolean;
  issues: Issue[];
  colorCount: number;
  opaquePixels: number;
  boundingBox: Rect | null;
  isolatedPixels: number;
}
export interface PixelDiff { changedPixels: number; changedLayers: string[]; boundingBox: Rect | null }
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
export interface AssetDetail { asset: Asset; revision: Revision }
export interface EditScope {
  layerIds: string[];
  rect?: Rect;
  allowPaletteChanges?: boolean;
  allowLayerChanges?: boolean;
}
type DrawingBase = { layerId: string };
export type Operation =
  | (DrawingBase & { op: 'pixels'; points: [number, number, number][] })
  | (DrawingBase & { op: 'patch'; x: number; y: number; width: number; height: number; pixels: number[] })
  | (DrawingBase & { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: number })
  | (DrawingBase & { op: 'rect' | 'ellipse'; x: number; y: number; width: number; height: number; color: number; filled?: boolean })
  | (DrawingBase & { op: 'polygon'; points: [number, number][]; color: number })
  | (DrawingBase & { op: 'fill'; x: number; y: number; color: number; reference?: 'layer' | 'composite'; contiguous?: boolean })
  | (DrawingBase & { op: 'move' | 'copy'; dx: number; dy: number; rect?: Rect })
  | (DrawingBase & { op: 'flip'; axis: 'x' | 'y'; rect?: Rect })
  | (DrawingBase & { op: 'rotate'; turns: 1 | 2 | 3; rect?: Rect })
  | (DrawingBase & { op: 'replace'; from: number; to: number; rect?: Rect })
  | (DrawingBase & { op: 'outline'; color: number })
  | { op: 'add_layer'; id: string; name: string }
  | { op: 'duplicate_layer'; layerId: string; id: string; name: string }
  | { op: 'remove_layer'; layerId: string }
  | { op: 'update_layer'; layerId: string; name?: string; visible?: boolean; locked?: boolean }
  | { op: 'reorder_layers'; layerIds: string[] }
  | { op: 'palette'; colors: string[] }
  | { op: 'pivot'; x: number; y: number };
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
  batchCount: number;
  createdAt: string;
  updatedAt: string;
}
export type McpAgent = 'claude' | 'codex';
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
  sourceAssetId?: string;
  runId?: string;
}
