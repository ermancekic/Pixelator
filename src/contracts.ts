import { z } from 'zod';

const coordinate = z.number().int().min(0).max(63);
const size = z.number().int().min(1).max(64);
const offset = z.number().int().min(-63).max(63);
const color = z.number().int().min(0).max(32);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(160);
export const assetType = z.enum(['character', 'item', 'prop', 'ui']);
export const preset = z.enum(['1-bit', 'game-boy', '8-bit', '16-bit']);
export const palette = z.array(z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)).min(2).max(33);
export const rect = z.object({ x: coordinate, y: coordinate, width: size, height: size }).strict();
export const projectStyle = z.object({
  preset, palette, maxColors: z.number().int().min(1).max(32), paletteLocked: z.boolean(),
  width: size, height: size, perspective: z.enum(['front', 'side']),
  lighting: z.string().max(300), outline: z.string().max(300), theme: z.string().max(1000),
}).strict();
export const documentSchema = z.object({
  schemaVersion: z.literal(1), width: size, height: size, palette,
  maxColors: z.number().int().min(1).max(32), paletteLocked: z.boolean(),
  layers: z.array(z.object({
    id, name, visible: z.boolean(), locked: z.boolean(),
    pixels: z.array(color).max(4096),
  }).strict()).min(1).max(32),
  pivot: z.object({ x: z.number().min(0).max(64), y: z.number().min(0).max(64) }).strict(),
}).strict();
const layerId = id;
export const operation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('pixels'), layerId, points: z.array(z.tuple([coordinate, coordinate, color])).min(1).max(4096) }).strict(),
  z.object({ op: z.literal('patch'), layerId, x: coordinate, y: coordinate, width: size, height: size, pixels: z.array(color).max(4096) }).strict(),
  z.object({ op: z.literal('line'), layerId, x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, color }).strict(),
  z.object({ op: z.literal('rect'), layerId, x: coordinate, y: coordinate, width: size, height: size, color, filled: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('ellipse'), layerId, x: coordinate, y: coordinate, width: size, height: size, color, filled: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('polygon'), layerId, points: z.array(z.tuple([coordinate, coordinate])).min(3).max(128), color }).strict(),
  z.object({ op: z.literal('fill'), layerId, x: coordinate, y: coordinate, color }).strict(),
  z.object({ op: z.literal('move'), layerId, dx: offset, dy: offset, rect: rect.optional() }).strict(),
  z.object({ op: z.literal('copy'), layerId, dx: offset, dy: offset, rect: rect.optional() }).strict(),
  z.object({ op: z.literal('flip'), layerId, axis: z.enum(['x', 'y']), rect: rect.optional() }).strict(),
  z.object({ op: z.literal('rotate'), layerId, turns: z.union([z.literal(1), z.literal(2), z.literal(3)]), rect: rect.optional() }).strict(),
  z.object({ op: z.literal('replace'), layerId, from: color, to: color, rect: rect.optional() }).strict(),
  z.object({ op: z.literal('outline'), layerId, color }).strict(),
  z.object({ op: z.literal('add_layer'), id, name }).strict(),
  z.object({ op: z.literal('remove_layer'), layerId }).strict(),
  z.object({ op: z.literal('update_layer'), layerId, name: name.optional(), visible: z.boolean().optional(), locked: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('reorder_layers'), layerIds: z.array(id).min(1).max(32) }).strict(),
  z.object({ op: z.literal('palette'), colors: palette }).strict(),
  z.object({ op: z.literal('pivot'), x: z.number().min(0).max(64), y: z.number().min(0).max(64) }).strict(),
]);
export const editScope = z.object({
  layerIds: z.array(id).max(32), rect: rect.optional(),
  allowPaletteChanges: z.boolean().optional(), allowLayerChanges: z.boolean().optional(),
}).strict();
export const applyRequest = z.object({
  expectedRevision: id, requestId: id, label: z.string().max(300).optional(),
  actor: z.enum(['human', 'agent']).optional(), runId: id.optional(), editScope,
  operations: z.array(operation).min(1).max(512),
}).strict();
export const createAssetInput = z.object({
  projectId: id, name, type: assetType, tags: z.array(z.string().max(80)).max(30).optional(),
  width: size.optional(), height: size.optional(), palette: palette.optional(),
  maxColors: z.number().int().min(1).max(32).optional(),
  layers: z.array(z.object({ id, name }).strict()).min(1).max(32).optional(),
  sourceAssetId: id.optional(), runId: id.optional(),
}).strict();
export const projectInput = z.object({ name, preset: preset.optional() }).strict();
export const assetSearch = z.object({ projectId: id, q: z.string().max(300).optional(), type: z.union([assetType, z.literal('')]).optional() }).strict();
export const projectUpdate = z.object({ name: name.optional(), style: projectStyle.optional() }).strict();
export const restoreInput = z.object({ revisionId: id, expectedRevision: id, requestId: id, label: z.string().max(300).optional() }).strict();
export const runInput = z.object({ projectId: id, assetId: id.optional(), prompt: z.string().trim().min(1).max(12000) }).strict();
export const reviewInput = z.object({
  revisionId: id, observations: z.string().trim().min(1).max(6000),
  issues: z.array(z.string().max(1000)).max(30),
}).strict();
export const artistRunImport = runInput.extend({
  id, status: z.enum(['active', 'completed', 'needs_review', 'cancelled', 'interrupted']),
  reviews: z.array(reviewInput.extend({ createdAt: z.string().datetime() })).max(4),
  inspectedRevisionId: id.optional(), batchCount: z.number().int().min(0).max(120),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export const importPngInput = z.object({
  projectId: id, name, type: assetType, pngBase64: z.string().min(1).max(1_500_000),
}).strict();
export const revisionImport = z.object({
  id, assetId: id, parentId: id.nullable(), document: documentSchema,
  label: z.string().max(300), actor: z.enum(['human', 'agent', 'import']),
  runId: id.optional(), operations: z.array(operation).max(512),
  validation: z.unknown().optional(), createdAt: z.string().datetime(),
}).strict();
export const projectBundle = z.object({
  kind: z.literal('pixelator-project'), schemaVersion: z.literal(1),
  project: z.object({ id, name, style: projectStyle, createdAt: z.string().datetime() }).strict(),
  assets: z.array(z.object({
    id, projectId: id, name, type: assetType, tags: z.array(z.string().max(80)).max(30),
    headRevisionId: id, sourceAssetId: id.optional(), style: projectStyle,
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  }).strict()).max(500),
  revisions: z.array(revisionImport).max(10000),
  runs: z.array(artistRunImport).max(10000).optional(),
}).strict();
