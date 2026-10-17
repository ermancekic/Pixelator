import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './contracts.js';
import { AppError, Store } from './store.js';
import { renderPng, unityManifest } from './images.js';
import { STYLE_PRESETS, validateDocument } from './engine.js';
import type { AssetDetail, Revision } from './types.js';

export const WORKFLOW = readFileSync(new URL('../skills/pixel-artist/SKILL.md', import.meta.url), 'utf8');
export const ARTIST_GUIDE = {
  version: '2026-10-17', uri: 'pixelator://artist-guide',
  text: readFileSync(new URL('../skills/pixel-artist/references/artist-guide.md', import.meta.url), 'utf8'),
};
export function publicError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message, status: error.status };
  if (error instanceof z.ZodError) return { code: 'INVALID_INPUT', message: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), status: 400 };
  if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) return { code: 'INVALID_REQUEST', message: error.statusCode === 413 ? 'Die Anfrage überschreitet das Größenlimit dieses Endpunkts (Projektimport: 128 MB; übrige Anfragen: 16 MB).' : 'Die Anfrage konnte nicht gelesen werden. JSON und Content-Type prüfen.', status: error.statusCode };
  if (error instanceof Error && /^[A-Z_]+:/.test(error.message)) {
    const colon = error.message.indexOf(':');
    return { code: error.message.slice(0, colon), message: error.message.slice(colon + 1).trim(), status: 400 };
  }
  return { code: 'INTERNAL_ERROR', message: 'Ein interner Fehler ist aufgetreten. Details stehen im Serverprotokoll.', status: 500 };
}
export function revisionSummary(revision: Revision, includePixels = false) {
  const { document } = revision;
  return {
    id: revision.id, parentId: revision.parentId, label: revision.label, actor: revision.actor, runId: revision.runId, createdAt: revision.createdAt,
    validation: revision.validation,
    document: { ...document, layers: document.layers.map(layer => includePixels ? layer : {
      id: layer.id, name: layer.name, visible: layer.visible, locked: layer.locked,
      opaquePixels: layer.pixels.filter(Boolean).length,
    }) },
  };
}
const detailSummary = (detail: AssetDetail, includePixels = false) => ({ asset: detail.asset, revision: revisionSummary(detail.revision, includePixels) });
const jsonResult = (value: unknown) => {
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { result: value };
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent };
};
const identifier = z.string().min(1).max(100);
const assetIdInput = z.object({ assetId: identifier }).strict();
const runIdInput = z.object({ runId: identifier }).strict();

export function createMcpServer(store: Store, exportDir: string, baseUrl: string): McpServer {
  const server = new McpServer({ name: 'pixelator', version: '0.1.0' }, {
    instructions: 'Pixelator is a local, deterministic pixel-art engine, not an image model. Before every art task call get_workflow and apply its Artist Guide throughout creation, variants, edits and reviews. Read the project/asset style and honor explicit user direction. Use semantic layers and indexed palette colors. Inspect real PNG images at native size and enlarged, record concrete observations against the Artist Guide checklist for the current revision, and preserve unrelated pixels. apply_operations requires the latest expectedRevision and a unique requestId. The external agent performs all visual reasoning. No image generation or downsampling pipeline.',
  });
  function tool<S extends z.ZodObject>(name: string, description: string, inputSchema: S, handler: (input: z.infer<S>) => unknown, readOnly = false) {
    const definition: z.ZodObject = inputSchema;
    server.registerTool(name, {
      description, inputSchema: definition,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    }, async input => {
      try { return jsonResult(await handler(input as z.infer<S>)); }
      catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: publicError(error) }) }] }; }
    });
  }
  tool('get_workflow', 'Read and apply the current source-backed Artist Guide, review checklist, workflow and precision rules before every art task.', z.object({}).strict(), () => ({ workflow: WORKFLOW, artistGuide: ARTIST_GUIDE, presets: STYLE_PRESETS, limits: { canvas: 'Positive integer dimensions; limited by available memory and runtime', opaqueColors: 32, layers: 32, operationsPerBatch: 512, batchesPerRun: 120, correctionRounds: 3, targetMinutes: 10 } }), true);
  tool('list_projects', 'List local projects and their visual style profiles.', z.object({}).strict(), () => ({ projects: store.listProjects() }), true);
  tool('create_project', 'Create a local project with a consistent style profile.', schema.projectInput, input => store.createProject(input));
  tool('update_project', 'Update project defaults. Existing assets keep their saved style. A full style object is required when changing style.', schema.projectUpdate.extend({ projectId: identifier }), ({ projectId, ...input }) => store.updateProject(projectId, input));
  tool('find_assets', 'Find reusable assets by project, words, tags and asset type.', z.object({ projectId: identifier, q: z.string().max(300).optional(), type: schema.assetType.optional() }).strict(), input => ({ assets: store.listAssets(input.projectId, input.q, input.type) }), true);
  tool('create_asset', 'Create a blank editable canvas with named semantic layers, not a generated image. Plan and draw the asset next using apply_operations. Palette index 0 is transparent. For character consistency, put body and equipment on separate layers.', schema.createAssetInput.omit({ sourceAssetId: true }), input => detailSummary(store.createAsset(input)));
  tool('get_asset', 'Read current revision, palette indices, layers, style and validation. Set includePixels only when exact raster data is needed; ordinary inspection uses inspect_asset.', assetIdInput.extend({ includePixels: z.boolean().optional() }), input => detailSummary(store.getAsset(input.assetId), input.includePixels), true);
  tool('apply_operations', 'Atomically draw exact integer pixel operations. Layer order is bottom-to-top. Use editScope.layerIds and optional rect to protect all other raster data. Global palette edits need allowPaletteChanges, every layer in scope, no rect, and an unlocked palette. Metadata edits need allowLayerChanges and full scope. duplicate_layer inserts an independent copy above layerId with new id/name, retaining visibility and lock. Fill defaults to contiguous=true and reference=layer; reference=composite samples visible layers but writes only the target, and contiguous=false fills all matching indices within scope. Never redraw the whole asset for a local request. Reuse requestId only for an identical retry. Shapes use palette indices; filled defaults true.', schema.applyRequest.extend({ assetId: identifier }), ({ assetId, ...request }) => {
    const result = store.apply(assetId, { ...request, actor: 'agent' });
    return { ...detailSummary(result), diff: result.diff };
  });
  const inspectInput = assetIdInput.extend({ revisionId: identifier.optional(), runId: identifier.optional(), scale: z.number().int().min(1).max(32).optional() });
  server.registerTool('inspect_asset', {
    description: 'See the actual PNG rendering, saved asset style and revision metadata. Current colors come from document.palette, not the original style palette. Use scale 1 and an enlarged integer scale, then review against the Artist Guide checklist. This returns real image content. Pass runId to record delivery of the current revision before record_review. Transparency is real; grid/checkerboard are not asset pixels.',
    inputSchema: inspectInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async input => {
    try {
      const revision = store.getRevision(input.assetId, input.revisionId);
      const { asset } = store.getAsset(input.assetId);
      const scale = input.scale ?? Math.max(1, Math.min(16, Math.floor(512 / Math.max(revision.document.width, revision.document.height))));
      const png = renderPng(revision.document, scale);
      if (input.runId) store.inspected(input.runId, input.assetId, revision.id);
      const summary = { ...revisionSummary(revision), asset: { id: asset.id, name: asset.name, type: asset.type, style: asset.style }, artistGuide: { version: ARTIST_GUIDE.version, uri: ARTIST_GUIDE.uri }, scale, imageWidth: revision.document.width * scale, imageHeight: revision.document.height * scale };
      return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text' as const, text: JSON.stringify(summary) }], structuredContent: summary };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: publicError(error) }) }] }; }
  });
  tool('validate_asset', 'Check dimensions, palette, alpha, bounding box and raster integrity. Isolated pixels and empty canvases are diagnostics, not automatic art-quality judgments. Light, readability and character identity require visual review.', assetIdInput.extend({ revisionId: identifier.optional() }), input => validateDocument(store.getRevision(input.assetId, input.revisionId).document), true);
  tool('list_revisions', 'List immutable revisions. inspect_asset can render a selected revision. Restoring creates a new revision and preserves history.', assetIdInput, input => ({ revisions: store.listRevisions(input.assetId).map(rev => ({ id: rev.id, parentId: rev.parentId, label: rev.label, actor: rev.actor, createdAt: rev.createdAt, validation: rev.validation })) }), true);
  tool('restore_revision', 'Restore an earlier whole-asset state as a new revision. This is a global history operation, not a scoped drawing edit.', schema.restoreInput.extend({ assetId: identifier }), ({ assetId, ...input }) => detailSummary(store.restore(assetId, input)));
  tool('create_variant', 'Duplicate the current asset, retaining indexed raster, style and semantic layers. The new asset records its sourceAssetId.', assetIdInput.extend({ name: z.string().trim().min(1).max(160) }), input => detailSummary(store.createVariant(input.assetId, input.name)));
  tool('export_asset', 'Export lossless PNG, editable JSON, or Unity import metadata to the local exports folder. PNG has true transparency and no preview overlays. Unity metadata documents manual import settings; no Unity project is modified.', assetIdInput.extend({ format: z.enum(['png', 'json', 'unity']).default('png') }), input => {
    const { asset, revision } = store.getAsset(input.assetId);
    const safeName = asset.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'asset';
    const filename = `${safeName}-${asset.id.slice(-8)}-${revision.id.slice(-8)}.${input.format === 'png' ? 'png' : input.format === 'unity' ? 'unity.json' : 'pixelator.json'}`;
    const bytes = input.format === 'png' ? renderPng(revision.document) : Buffer.from(JSON.stringify(input.format === 'unity' ? unityManifest(asset.id, revision.id, asset.name, revision.document) : store.exportAsset(asset.id), null, 2));
    mkdirSync(exportDir, { recursive: true });
    const path = join(exportDir, filename);
    writeFileSync(path, bytes);
    return { assetId: asset.id, revisionId: revision.id, path, downloadUrl: `${baseUrl}/api/assets/${asset.id}/export?format=${input.format}` };
  });
  tool('start_run', 'Record an artist task and return the current Artist Guide to apply throughout this run. This does not start an AI model. Attach assetId for edits; for new art pass this runId to create_asset.', schema.runInput, input => ({ ...store.startRun(input), artistGuide: ARTIST_GUIDE }));
  tool('get_run', 'Read artist progress, delivered inspection revision, reviews and budget usage.', runIdInput, input => store.getRun(input.runId), true);
  tool('resume_run', 'Resume a run interrupted by a service restart and return the current Artist Guide. Preserve reviews and batch budget; reload and inspect the current asset before further edits.', runIdInput, input => ({ ...store.resumeRun(input.runId), artistGuide: ARTIST_GUIDE }));
  tool('record_review', 'Record concrete observations against the Artist Guide checklist (readability, clusters/edges, palette/light, style/context, edit fidelity) and remaining issues for the exact current revision delivered by inspect_asset(runId). Maximum one initial review plus three correction reviews. This records the agent assessment; it cannot prove visual understanding.', schema.reviewInput.extend({ runId: identifier }), ({ runId, ...input }) => store.recordReview(runId, input));
  tool('finish_run', 'Finish the task. completed requires a nonempty valid current revision and its latest inspection/review with no remaining issues. Otherwise use needs_review to preserve a useful partial result honestly.', runIdInput.extend({ status: z.enum(['completed', 'needs_review']) }), input => store.finishRun(input.runId, input.status));
  tool('cancel_run', 'Stop a run while preserving every saved revision.', runIdInput, input => store.finishRun(input.runId, 'cancelled'));
  server.registerResource('artist-workflow', 'pixelator://workflow', { mimeType: 'text/markdown', description: 'Portable Pixel Artist workflow for Codex, Claude and Antigravity' }, async uri => ({ contents: [{ uri: uri.href, text: WORKFLOW }] }));
  server.registerResource('artist-guide', ARTIST_GUIDE.uri, { mimeType: 'text/markdown', description: 'Source-backed Pixel Art best practices and visual review checklist for every artist task' }, async uri => ({ contents: [{ uri: uri.href, text: ARTIST_GUIDE.text }] }));
  return server;
}
