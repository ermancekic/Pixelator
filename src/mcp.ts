import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './contracts.js';
import { AppError, Store } from './store.js';
import { framesFor, renderGif, renderPng, renderSheet, sheetLayout, sheetManifest, unityManifest, unitySheetManifest } from './images.js';
import { MAX_FRAMES, MAX_TAGS, readIndices, STYLE_PRESETS, validateDocument } from './engine.js';
import { encodeRows, MAX_READ_CELLS, ROW_ALPHABET, rowLegend } from './raster-text.js';
import type { ApplyResult, AssetDetail, Revision, ValidationReport } from './types.js';

export const WORKFLOW = readFileSync(new URL('../skills/pixel-artist/SKILL.md', import.meta.url), 'utf8');
export const ARTIST_GUIDE = {
  version: '2026-10-17.2', uri: 'pixelator://artist-guide',
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
  const { document } = revision; const { frames, layers, ...rest } = document;
  return {
    id: revision.id, parentId: revision.parentId, label: revision.label, actor: revision.actor, runId: revision.runId, createdAt: revision.createdAt,
    validation: revision.validation,
    document: includePixels ? document : {
      ...rest,
      layers: layers.map(layer => ({ ...layer, opaquePixels: frames.reduce((count, frame) => count + frame.cels[layer.id].filter(Boolean).length, 0) })),
      frames: frames.map(({ id, durationMs }) => ({ id, durationMs })),
    },
  };
}
const detailSummary = (detail: AssetDetail, includePixels = false) => ({ asset: detail.asset, revision: revisionSummary(detail.revision, includePixels) });
const compactValidation = ({ valid, colorCount, opaquePixels, boundingBox, isolatedPixels, issues }: ValidationReport) => ({ valid, colorCount, opaquePixels, boundingBox, isolatedPixels, issues });
// Agents mostly need the new revision for the next expectedRevision; the full context stays available via response=full or get_asset.
export const compactApplyResult = ({ asset, revision, diff }: ApplyResult) => ({
  assetId: asset.id, revisionId: revision.id, parentId: revision.parentId, label: revision.label, width: revision.document.width, height: revision.document.height, diff,
  validation: compactValidation(revision.validation),
  layers: revision.document.layers.map(({ id, visible, locked }) => ({ id, visible, locked })),
  frames: revision.document.frames.map(({ id, durationMs }) => ({ id, durationMs })),
  tags: revision.document.tags,
});
const MAX_INSPECT_PIXELS = 4096 * 4096;
const jsonResult = (value: unknown) => {
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { result: value };
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent };
};
const identifier = z.string().min(1).max(100);
const assetIdInput = z.object({ assetId: identifier }).strict();
const runIdInput = z.object({ runId: identifier }).strict();

export function createMcpServer(store: Store, exportDir: string, baseUrl: string): McpServer {
  const server = new McpServer({ name: 'pixelator', version: '0.1.0' }, {
    instructions: 'Pixelator is a local, deterministic pixel-art engine, not an image model. Before every art task call get_workflow and apply its Artist Guide throughout creation, variants, edits and reviews. Read the project/asset style and honor explicit user direction. Use semantic layers and indexed palette colors. Inspect real PNG images at native size and enlarged, record concrete observations against the Artist Guide checklist for the current revision, and preserve unrelated pixels. Animations are frames of one asset sharing its layers; inspect them as one sprite sheet. apply_operations requires the latest expectedRevision and a unique requestId. The external agent performs all visual reasoning. No image generation or downsampling pipeline.',
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
  tool('get_workflow', 'Read and apply the current source-backed Artist Guide, review checklist, workflow and precision rules before every art task.', z.object({}).strict(), () => ({ workflow: WORKFLOW, artistGuide: ARTIST_GUIDE, presets: STYLE_PRESETS, limits: { canvas: 'Positive integer dimensions; limited by available memory and runtime', opaqueColors: 32, layers: 32, operationsPerBatch: 512, batchesPerRun: 120, correctionRounds: 3, targetMinutes: 10, readPixelsCells: MAX_READ_CELLS, inspectScales: 3, frames: MAX_FRAMES, tags: MAX_TAGS, frameDurationMs: '10..60000' }, rowAlphabet: ROW_ALPHABET }), true);
  tool('list_projects', 'List local projects and their visual style profiles.', z.object({}).strict(), () => ({ projects: store.listProjects() }), true);
  tool('create_project', 'Create a local project with a consistent style profile.', schema.projectInput, input => store.createProject(input));
  tool('update_project', 'Update project defaults. Existing assets keep their saved style. A full style object is required when changing style.', schema.projectUpdate.extend({ projectId: identifier }), ({ projectId, ...input }) => store.updateProject(projectId, input));
  tool('find_assets', 'Find reusable assets by project, words, tags and asset type.', z.object({ projectId: identifier, q: z.string().max(300).optional(), type: schema.assetType.optional() }).strict(), input => ({ assets: store.listAssets(input.projectId, input.q, input.type) }), true);
  tool('create_asset', 'Create a blank editable canvas with named semantic layers, not a generated image. Plan and draw the asset next using apply_operations. Palette index 0 is transparent. For character consistency, put body and equipment on separate layers. For an animation pass frames (ids like walk_1 with durationMs) and optional animationTags (zero-based inclusive from/to); every frame shares the layers.', schema.createAssetInput.omit({ sourceAssetId: true }), input => detailSummary(store.createAsset(input)));
  tool('get_asset', 'Read current revision, palette indices, layers, frames, tags, style and validation. Set includePixels only when the whole raster is needed (frameIds limits it to some frames); use read_pixels for regions and inspect_asset to look at the image.', assetIdInput.extend({ includePixels: z.boolean().optional(), frameIds: z.array(identifier).min(1).max(MAX_FRAMES).optional() }), input => {
    const detail = store.getAsset(input.assetId);
    if (!input.frameIds) return detailSummary(detail, input.includePixels);
    const { document } = detail.revision;
    const missing = input.frameIds.find(id => !document.frames.some(frame => frame.id === id));
    if (missing) throw new AppError('UNKNOWN_FRAME', `Frame ${missing} existiert nicht.`);
    return detailSummary({ ...detail, revision: { ...detail.revision, document: { ...document, frames: document.frames.filter(frame => input.frameIds!.includes(frame.id)) } } }, input.includePixels);
  }, true);
  tool('apply_operations', 'Atomically draw exact integer pixel operations. Layer order is bottom-to-top. Use editScope.layerIds and optional rect to protect all other raster data. In animations every drawing operation targets one frame: give frameId, or a single editScope.frameIds entry; editScope.frameIds protects all other frames. Frame structure (add_frame, duplicate_frame, remove_frame, reorder_frames, frame_duration, set_tags) needs every layer in scope and allowFrameChanges. stamp copies a region from any layer/frame (sourceLayerId, sourceFrameId, rect, dx, dy; mode over skips transparent source pixels) to reuse poses. Global palette edits need allowPaletteChanges, every layer in scope, no rect, and an unlocked palette. Metadata edits need allowLayerChanges and full scope. Prefer rows for raster blocks: one string per row, "." transparent, 1-9 and a-w for palette indices 1-32; mode=over keeps existing pixels under ".". duplicate_layer inserts an independent copy above layerId with new id/name, retaining visibility and lock. Fill defaults to contiguous=true and reference=layer; reference=composite samples visible layers but writes only the target, and contiguous=false fills all matching indices within scope. Never redraw the whole asset for a local request. Reuse requestId only for an identical retry. Shapes and polygons use palette indices; filled defaults true. editScope.mask (one string per rect row, "#" writable, "." protected) restricts writes to an irregular region inside rect; fill, replace and outline stay inside it. outline accepts rect, reference=composite (outline around all visible layers, written to the target layer) and corners=false (no diagonal neighbors). merge_layers combines visible layers into the lowest of them; visible layers in between must be merged too. resize_canvas sets width/height and places old content at offsetX/offsetY (negative values crop); it needs allowLayerChanges and full scope, moves the pivot and rejects clipping a locked layer. palette remap=nearest moves every pixel to the closest color of the new palette instead of keeping indices. The response is compact (new revisionId, diff, validation, layers); pass response=full for the complete asset and revision summary.', schema.applyRequest.extend({ assetId: identifier, response: z.enum(['compact', 'full']).optional() }), ({ assetId, response, ...request }) => {
    const result = store.apply(assetId, { ...request, actor: 'agent' });
    return response === 'full' ? { ...detailSummary(result), diff: result.diff } : compactApplyResult(result);
  });
  tool('read_pixels', `Read exact palette indices of a region as compact rows, the same encoding the rows operation writes. Omit layerId for the visible composite and frameId for the first frame. Use before precise local edits instead of get_asset includePixels. At most ${MAX_READ_CELLS} cells per call.`, assetIdInput.extend({ revisionId: identifier.optional(), frameId: identifier.optional(), layerId: identifier.optional(), rect: schema.rect.optional() }), input => {
    const revision = store.getRevision(input.assetId, input.revisionId); const { document } = revision;
    const area = input.rect ?? { x: 0, y: 0, width: document.width, height: document.height };
    if (area.x + area.width > document.width || area.y + area.height > document.height) throw new AppError('INVALID_RECT', 'Der Bereich muss innerhalb der Leinwand liegen.');
    if (area.width * area.height > MAX_READ_CELLS) throw new AppError('REGION_TOO_LARGE', `Höchstens ${MAX_READ_CELLS} Zellen pro Aufruf. Einen kleineren rect wählen.`);
    const frameId = input.frameId ?? document.frames[0].id;
    return { assetId: input.assetId, revisionId: revision.id, frameId, source: input.layerId ?? 'composite', ...area, legend: rowLegend(document.palette), rows: encodeRows(readIndices(document, input.layerId, frameId), document.width, area) };
  }, true);
  const inspectInput = assetIdInput.extend({
    revisionId: identifier.optional(), runId: identifier.optional(),
    scale: z.number().int().min(1).max(32).optional(), scales: z.array(z.number().int().min(1).max(32)).min(1).max(3).optional(),
    frameId: identifier.optional(), frameIds: z.array(identifier).min(1).max(MAX_FRAMES).optional(), tag: z.string().min(1).max(160).optional(),
    layout: z.enum(['frame', 'sheet']).optional(), columns: z.number().int().min(1).max(MAX_FRAMES).optional(),
    onion: z.object({ before: z.number().int().min(0).max(3).optional(), after: z.number().int().min(0).max(3).optional() }).strict().optional(),
  });
  server.registerTool('inspect_asset', {
    description: 'See the actual PNG rendering, saved asset style and revision metadata. Current colors come from document.palette, not the original style palette. Pass scales, for example [1, 8], to receive native and enlarged images in one call, then review against the Artist Guide checklist. Animations render as one sprite sheet of all frames (or of frameIds/tag) in timeline order, separated by a gutter color outside the palette; frameId shows a single frame. onion tints previous frames blue and next frames red behind each frame to judge motion. This returns real image content. Pass runId to record delivery of the current revision before record_review; finishing an animation requires an inspection that showed every frame. Transparency is real; grid/checkerboard, gutters and onion tints are not asset pixels.',
    inputSchema: inspectInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async input => {
    try {
      const revision = store.getRevision(input.assetId, input.revisionId); const { document } = revision;
      const { asset } = store.getAsset(input.assetId);
      const frameIds = input.frameId ? [input.frameId] : input.frameIds ?? framesFor(document, input.tag);
      const layout = input.layout ?? (frameIds.length > 1 ? 'sheet' : 'frame');
      if (layout === 'frame' && frameIds.length !== 1) throw new AppError('INVALID_LAYOUT', 'layout frame zeigt genau einen Frame; für mehrere Frames layout sheet verwenden.');
      const sheet = sheetLayout(document, { frameIds, columns: input.columns ?? (layout === 'sheet' ? Math.min(frameIds.length, 8) : 1), gutter: layout === 'sheet' ? 1 : 0 });
      const scales = input.scales ?? [input.scale ?? Math.max(1, Math.min(16, Math.floor(512 / Math.max(sheet.width, sheet.height))))];
      if (scales.some(scale => sheet.width * scale * sheet.height * scale > MAX_INSPECT_PIXELS)) throw new AppError('RENDER_SIZE', 'Das Prüfbild wäre zu groß. Einen kleineren Zoom, weniger Frames oder frameId wählen.');
      const onion = input.onion && (input.onion.before || input.onion.after) ? input.onion : undefined;
      const images = scales.map(scale => ({
        scale, width: sheet.width * scale, height: sheet.height * scale,
        png: layout === 'frame' && !onion ? renderPng(document, scale, frameIds[0]) : renderSheet(document, { frameIds, columns: sheet.columns, gutter: sheet.gutter, scale, onion }).png,
      }));
      if (input.runId) store.inspected(input.runId, input.assetId, revision.id, frameIds);
      const summary = {
        ...revisionSummary(revision), asset: { id: asset.id, name: asset.name, type: asset.type, style: asset.style },
        artistGuide: { version: ARTIST_GUIDE.version, uri: ARTIST_GUIDE.uri },
        scale: images[0].scale, imageWidth: images[0].width, imageHeight: images[0].height,
        images: images.map(({ scale, width, height }) => ({ scale, width, height })),
        view: { layout, frameIds, ...(layout === 'sheet' ? { columns: sheet.columns, rows: sheet.rows, gutter: sheet.gutter, gutterColor: sheet.gutterColor, cells: sheet.cells.map(({ frameId, column, row, x, y, durationMs }) => ({ frameId, column, row, x, y, durationMs })) } : {}), ...(onion ? { onion: { before: onion.before ?? 0, after: onion.after ?? 0, note: 'Blue tints show previous frames, red tints next frames.' } } : {}) },
      };
      return { content: [...images.map(image => ({ type: 'image' as const, data: image.png.toString('base64'), mimeType: 'image/png' })), { type: 'text' as const, text: JSON.stringify(summary) }], structuredContent: summary };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: publicError(error) }) }] }; }
  });
  tool('validate_asset', 'Check dimensions, palette, alpha, bounding box and raster integrity. Isolated pixels and empty canvases are diagnostics, not automatic art-quality judgments. Light, readability and character identity require visual review.', assetIdInput.extend({ revisionId: identifier.optional() }), input => validateDocument(store.getRevision(input.assetId, input.revisionId).document), true);
  tool('list_revisions', 'List immutable revisions. inspect_asset can render a selected revision. Restoring creates a new revision and preserves history.', assetIdInput, input => ({ revisions: store.listRevisions(input.assetId).map(rev => ({ id: rev.id, parentId: rev.parentId, label: rev.label, actor: rev.actor, createdAt: rev.createdAt, validation: rev.validation })) }), true);
  tool('restore_revision', 'Restore an earlier whole-asset state as a new revision. This is a global history operation, not a scoped drawing edit.', schema.restoreInput.extend({ assetId: identifier }), ({ assetId, ...input }) => detailSummary(store.restore(assetId, input)));
  tool('create_variant', 'Duplicate the current asset, retaining indexed raster, style and semantic layers. The new asset records its sourceAssetId.', assetIdInput.extend({ name: z.string().trim().min(1).max(160) }), input => detailSummary(store.createVariant(input.assetId, input.name)));
  tool('export_asset', 'Export to the local exports folder: png (one frame, default first, true transparency), json (editable project), unity (import metadata; animations describe the sheet with one sprite per frame and one clip per tag), sheet (all frames or one tag as a horizontal sprite sheet PNG plus Aseprite-compatible JSON with durations and frame tags), gif (animated preview for sharing; a tag plays in its direction and loop mode). scale enlarges png, sheet and gif by nearest neighbor (the sheet JSON addresses the enlarged image; unity stays 1x). No preview overlays; no Unity project is modified.', assetIdInput.extend({ format: z.enum(['png', 'json', 'unity', 'sheet', 'gif']).default('png'), frameId: identifier.optional(), tag: z.string().min(1).max(160).optional(), columns: z.number().int().min(1).max(MAX_FRAMES).optional(), scale: z.number().int().min(1).max(16).optional() }), input => {
    const { asset, revision } = store.getAsset(input.assetId); const { document } = revision;
    const base = `${asset.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'asset'}-${asset.id.slice(-8)}-${revision.id.slice(-8)}${input.tag ? `-${input.tag.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)}` : ''}`;
    const query = new URLSearchParams({ ...(input.frameId ? { frameId: input.frameId } : {}), ...(input.tag ? { tag: input.tag } : {}), ...(input.columns ? { columns: String(input.columns) } : {}), ...(input.scale ? { scale: String(input.scale) } : {}) });
    const url = (format: string) => `${baseUrl}/api/assets/${asset.id}/export?${new URLSearchParams({ format, ...Object.fromEntries(query) })}`;
    const sheet = () => renderSheet(document, { frameIds: framesFor(document, input.tag), columns: input.columns, scale: input.scale });
    const files: { path: string; downloadUrl: string }[] = [];
    const write = (filename: string, bytes: Buffer, format: string) => { const path = join(exportDir, filename); writeFileSync(path, bytes); files.push({ path, downloadUrl: url(format) }); };
    mkdirSync(exportDir, { recursive: true });
    if (input.format === 'png') write(`${base}.png`, renderPng(document, input.scale ?? 1, input.frameId), 'png');
    else if (input.format === 'gif') write(`${base}.gif`, renderGif(document, { tag: input.tag, scale: input.scale }), 'gif');
    else if (input.format === 'json') write(`${base}.pixelator.json`, Buffer.from(JSON.stringify(store.exportAsset(asset.id), null, 2)), 'json');
    else if (input.format === 'unity') {
      const manifest = document.frames.length > 1 ? unitySheetManifest(asset.id, revision.id, asset.name, document, { image: `${base}.sheet.png`, layout: sheetLayout(document, { frameIds: framesFor(document, input.tag), columns: input.columns }) }) : unityManifest(asset.id, revision.id, asset.name, document);
      write(`${base}.unity.json`, Buffer.from(JSON.stringify(manifest, null, 2)), 'unity');
    } else {
      const rendered = sheet();
      write(`${base}.sheet.png`, rendered.png, 'sheet');
      write(`${base}.sheet.json`, Buffer.from(JSON.stringify(sheetManifest(asset.name, `${base}.sheet.png`, document, rendered.layout, input.scale), null, 2)), 'sheet-json');
    }
    return { assetId: asset.id, revisionId: revision.id, path: files[0].path, downloadUrl: files[0].downloadUrl, files };
  });
  tool('start_run', 'Record an artist task and return the current Artist Guide to apply throughout this run. This does not start an AI model. Attach assetId for edits; for new art pass this runId to create_asset.', schema.runInput, input => ({ ...store.startRun(input), artistGuide: ARTIST_GUIDE }));
  tool('get_run', 'Read artist progress, delivered inspection revision, reviews and budget usage.', runIdInput, input => store.getRun(input.runId), true);
  tool('resume_run', 'Resume a run interrupted by a service restart and return the current Artist Guide. Preserve reviews and batch budget; reload and inspect the current asset before further edits.', runIdInput, input => ({ ...store.resumeRun(input.runId), artistGuide: ARTIST_GUIDE }));
  tool('record_review', 'Record concrete observations against the Artist Guide checklist (readability, clusters/edges, palette/light, style/context, edit fidelity, motion for animations) and remaining issues for the exact current revision delivered by inspect_asset(runId). Maximum one initial review plus three correction reviews. This records the agent assessment; it cannot prove visual understanding.', schema.reviewInput.extend({ runId: identifier }), ({ runId, ...input }) => store.recordReview(runId, input));
  tool('finish_run', 'Finish the task. completed requires a nonempty valid current revision and its latest inspection/review with no remaining issues. Otherwise use needs_review to preserve a useful partial result honestly.', runIdInput.extend({ status: z.enum(['completed', 'needs_review']) }), input => store.finishRun(input.runId, input.status));
  tool('cancel_run', 'Stop a run while preserving every saved revision.', runIdInput, input => store.finishRun(input.runId, 'cancelled'));
  server.registerResource('artist-workflow', 'pixelator://workflow', { mimeType: 'text/markdown', description: 'Portable Pixel Artist workflow for Codex, Claude and Antigravity' }, async uri => ({ contents: [{ uri: uri.href, text: WORKFLOW }] }));
  server.registerResource('artist-guide', ARTIST_GUIDE.uri, { mimeType: 'text/markdown', description: 'Source-backed Pixel Art best practices and visual review checklist for every artist task' }, async uri => ({ contents: [{ uri: uri.href, text: ARTIST_GUIDE.text }] }));
  return server;
}
