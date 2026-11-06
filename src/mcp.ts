import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import * as schema from './contracts.js';
import { AppError, Store } from './store.js';
import { documentFromPng, framesFor, renderGif, renderPng, renderSheet, renderTerrainPreview, renderTileSheet, renderWrapPreview, sheetLayout, sheetManifest, unityManifest, unitySheetManifest } from './images.js';
import { godotTileset, renderTilesetImage, tiledTileset, tiledTilesetXml, unityTilesetManifest } from './tileset-export.js';
import { MAX_FRAMES, MAX_TAGS, readIndices, STYLE_PRESETS, validateDocument } from './engine.js';
import { encodeRows, MAX_READ_CELLS, ROW_ALPHABET, rowLegend } from './raster-text.js';
import type { ApplyResult, ArtistRun, AssetDetail, Revision, ValidationReport } from './types.js';

export const WORKFLOW = readFileSync(new URL('../skills/pixel-artist/SKILL.md', import.meta.url), 'utf8');
export const ARTIST_GUIDE = {
  version: '2026-11-06.1', uri: 'pixelator://artist-guide',
  text: readFileSync(new URL('../skills/pixel-artist/references/artist-guide.md', import.meta.url), 'utf8'),
};
export function publicError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message, status: error.status };
  if (error instanceof z.ZodError) return { code: 'INVALID_INPUT', message: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), status: 400 };
  if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) return { code: 'INVALID_REQUEST', message: error.statusCode === 413 ? 'The request exceeds the size limit of this endpoint (project import: 128 MB; other requests: 16 MB).' : 'The request could not be read. Check the JSON and Content-Type.', status: error.statusCode };
  if (error instanceof Error && /^[A-Z_]+:/.test(error.message)) {
    const colon = error.message.indexOf(':');
    return { code: error.message.slice(0, colon), message: error.message.slice(colon + 1).trim(), status: 400 };
  }
  return { code: 'INTERNAL_ERROR', message: 'An internal error occurred. Details are in the server log.', status: 500 };
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
// Run lists stay small: details and reviews come from get_run.
const runSummary = (run: ArtistRun) => ({
  id: run.id, projectId: run.projectId, assetId: run.assetId, status: run.status,
  prompt: run.prompt.length > 200 ? `${run.prompt.slice(0, 200)}…` : run.prompt,
  batchCount: run.batchCount, reviews: run.reviews.length, openIssues: run.reviews.at(-1)?.issues.length ?? 0,
  inspectedRevisionId: run.inspectedRevisionId, createdAt: run.createdAt, updatedAt: run.updatedAt,
});
const MAX_INSPECT_PIXELS = 4096 * 4096;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB.');
const jsonResult = (value: unknown) => {
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { result: value };
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent };
};
const identifier = z.string().min(1).max(100);
const assetIdInput = z.object({ assetId: identifier }).strict();
const runIdInput = z.object({ runId: identifier }).strict();

export function createMcpServer(store: Store, exportDir: string, baseUrl: string): McpServer {
  const server = new McpServer({ name: 'pixelator', version: '0.1.0' }, {
    instructions: 'Pixelator is a local, deterministic pixel-art engine, not an image model. Before every art task call get_workflow and apply its Artist Guide throughout creation, variants, edits and reviews. Read the project/asset style and honor explicit user direction. Use semantic layers and indexed palette colors. Inspect real PNG images at native size and enlarged on the intended game background (background), record concrete observations against the Artist Guide checklist for the current revision, and preserve unrelated pixels. Animations are frames of one asset sharing its layers; inspect them as one sprite sheet. apply_operations requires the latest expectedRevision and a unique requestId. The external agent performs all visual reasoning. No image generation or downsampling pipeline.',
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
  tool('get_workflow', 'Read and apply the current source-backed Artist Guide, review checklist, workflow and precision rules before every art task.', z.object({}).strict(), () => ({ workflow: WORKFLOW, artistGuide: ARTIST_GUIDE, presets: STYLE_PRESETS, limits: { canvas: 'Positive integer dimensions; limited by available memory and runtime', opaqueColors: 32, layers: 32, operationsPerBatch: 512, batchesPerRun: 120, correctionRounds: 3, targetMinutes: 10, readPixelsCells: MAX_READ_CELLS, inspectScales: 3, frames: MAX_FRAMES, tags: MAX_TAGS, frameDurationMs: '10..60000', terrains: 8, autotileTemplates: { blob: 47, edge: 16, corner: 15 } }, rowAlphabet: ROW_ALPHABET }), true);
  tool('list_projects', 'List local projects and their visual style profiles.', z.object({}).strict(), () => ({ projects: store.listProjects() }), true);
  tool('create_project', 'Create a local project with a consistent style profile.', schema.projectInput, input => store.createProject(input));
  tool('update_project', 'Update project defaults. Existing assets keep their saved style. A full style object is required when changing style.', schema.projectUpdate.extend({ projectId: identifier }), ({ projectId, ...input }) => store.updateProject(projectId, input));
  tool('find_assets', 'Find reusable assets by project, words, tags and asset type.', z.object({ projectId: identifier, q: z.string().max(300).optional(), type: schema.assetType.optional() }).strict(), input => ({ assets: store.listAssets(input.projectId, input.q, input.type) }), true);
  tool('update_asset', 'Rename or retag an asset; find_assets searches names and tags. Metadata only: no new revision, pixels untouched.', assetIdInput.extend({ name: z.string().trim().min(1).max(160).optional(), tags: z.array(z.string().max(80)).max(30).optional() }), ({ assetId, ...changes }) => ({ asset: store.updateAsset(assetId, changes) }));
  tool('import_png', 'Import a lossless PNG as a new asset with one layer: from an absolute local path (preferred, saves tokens) or pngBase64. No quantization: alpha must be fully opaque or transparent, and the colors must fit the project\'s maxColors and locked palette (raise maxColors with update_project if needed). frameWidth/frameHeight cut a sprite sheet row by row into frames (frameCount, durationMs). Pass runId to continue in an artist run. Inspect the result before editing.', z.object({
    projectId: identifier, name: z.string().trim().min(1).max(160), type: schema.assetType, tags: z.array(z.string().max(80)).max(30).optional(),
    path: z.string().min(1).max(1000).optional(), pngBase64: z.string().min(1).optional(),
    frameWidth: z.number().int().min(1).optional(), frameHeight: z.number().int().min(1).optional(), frameCount: z.number().int().min(1).max(MAX_FRAMES).optional(), durationMs: z.number().int().min(10).max(60000).optional(),
    runId: identifier.optional(),
  }).strict(), input => {
    if ((input.path === undefined) === (input.pngBase64 === undefined)) throw new AppError('INVALID_INPUT', 'Give either path or pngBase64.');
    let source: string | Buffer;
    if (input.path !== undefined) {
      if (!isAbsolute(input.path) || !/\.png$/i.test(input.path)) throw new AppError('INVALID_PATH', 'path must be an absolute path to a .png file.');
      const file = statSync(input.path, { throwIfNoEntry: false });
      if (!file?.isFile()) throw new AppError('NOT_FOUND', 'No PNG file exists at this path.', 404);
      if (file.size > MAX_IMPORT_BYTES) throw new AppError('PNG_SIZE', 'The PNG file is larger than 16 MB.');
      try { source = readFileSync(input.path); } catch { throw new AppError('PNG_UNREADABLE', 'The PNG file could not be read.'); }
    } else source = input.pngBase64!;
    const doc = documentFromPng(source, store.getProject(input.projectId).style, input);
    return detailSummary(store.importDocument({ projectId: input.projectId, name: input.name, type: input.type, tags: input.tags, runId: input.runId }, doc));
  });
  tool('create_asset', 'Create a blank editable canvas with named semantic layers, not a generated image. Plan and draw the asset next using apply_operations. Palette index 0 is transparent. maxColors defaults to the project budget (16 or fewer in the presets, at most 32); set it here when the asset may need more colors. For character consistency, put body and equipment on separate layers. For an animation pass frames (ids like walk_1 with durationMs) and optional animationTags (zero-based inclusive from/to); every frame shares the layers. For a tileset use type tileset with tileWidth/tileHeight and a width/height that are multiples of them; frames then animate tiles.', schema.createAssetInput.omit({ sourceAssetId: true }), input => detailSummary(store.createAsset(input)));
  tool('get_asset', 'Read current revision, palette indices, layers, frames, tags, style and validation. Set includePixels only when the whole raster is needed (frameIds limits it to some frames); use read_pixels for regions and inspect_asset to look at the image.', assetIdInput.extend({ includePixels: z.boolean().optional(), frameIds: z.array(identifier).min(1).max(MAX_FRAMES).optional() }), input => {
    const detail = store.getAsset(input.assetId);
    if (!input.frameIds) return detailSummary(detail, input.includePixels);
    const { document } = detail.revision;
    const missing = input.frameIds.find(id => !document.frames.some(frame => frame.id === id));
    if (missing) throw new AppError('UNKNOWN_FRAME', `Frame ${missing} does not exist.`);
    return detailSummary({ ...detail, revision: { ...detail.revision, document: { ...document, frames: document.frames.filter(frame => input.frameIds!.includes(frame.id)) } } }, input.includePixels);
  }, true);
  tool('apply_operations', 'Atomically draw exact integer pixel operations. Layer order is bottom-to-top. Use editScope.layerIds and optional rect to protect all other raster data. In animations every drawing operation targets one frame: give frameId, or a single editScope.frameIds entry; editScope.frameIds protects all other frames. Frame structure (add_frame, duplicate_frame, remove_frame, reorder_frames, frame_duration, set_tags) needs every layer in scope and allowFrameChanges. stamp copies a region from any layer/frame (sourceLayerId, sourceFrameId, rect, dx, dy; mode over skips transparent source pixels) to reuse poses. Global palette edits need allowPaletteChanges, every layer in scope, no rect, and an unlocked palette; palette maxColors (1..32) changes the color budget of the asset, which is otherwise fixed at creation. Metadata edits need allowLayerChanges and full scope. Prefer rows for raster blocks: one string per row, "." transparent, 1-9 and a-w for palette indices 1-32; mode=over keeps existing pixels under ".". duplicate_layer inserts an independent copy above layerId with new id/name, retaining visibility and lock. Fill defaults to contiguous=true and reference=layer; reference=composite samples visible layers but writes only the target, and contiguous=false fills all matching indices within scope. Never redraw the whole asset for a local request. Reuse requestId only for an identical retry. Shapes and polygons use palette indices; filled defaults true. editScope.mask (one string per rect row, "#" writable, "." protected) restricts writes to an irregular region inside rect; fill, replace and outline stay inside it. outline accepts rect, reference=composite (outline around all visible layers, written to the target layer) and corners=false (no diagonal neighbors). merge_layers combines visible layers into the lowest of them; visible layers in between must be merged too. resize_canvas sets width/height and places old content at offsetX/offsetY (negative values crop); it needs allowLayerChanges and full scope, moves the pivot and rejects clipping a locked layer. palette remap=nearest moves every pixel to the closest color of the new palette instead of keeping indices. Tilesets (allowLayerChanges, full scope): tileset sets tileWidth/tileHeight (canvas must be a multiple; a new size drops tile metadata), terrainMode corner|edge|mixed and up to 8 terrains {name,color}; tile_properties sets per tile id (row by row) name, type, probability, collision rectangles in tile pixels and terrain, nine values in Tiled Wang order top, top-right, right, bottom-right, bottom, bottom-left, left, top-left plus center (0 unset, n = terrains[n-1]); null clears a field; remove_tileset drops the grid. autotile completes a template eight tiles wide from five hand-drawn key tiles in its first row (single, horizontal, vertical, cross, fill; edge needs only the first four): blob = 47 tiles (mixed), edge = 16 (edge), corner = keys plus 15 corner tiles (corner); x/y give the template origin in tiles; it labels the generated tiles with terrain (default 1) and needs even tile sizes. shift offsets a layer or rect with wrap-around to move tile edges into view. The response is compact (new revisionId, diff, validation, layers); pass response=full for the complete asset and revision summary.', schema.applyRequest.extend({ assetId: identifier, response: z.enum(['compact', 'full']).optional() }), ({ assetId, response, ...request }) => {
    const result = store.apply(assetId, { ...request, actor: 'agent' });
    return response === 'full' ? { ...detailSummary(result), diff: result.diff } : compactApplyResult(result);
  });
  tool('read_pixels', `Read exact palette indices of a region as compact rows, the same encoding the rows operation writes. Omit layerId for the visible composite and frameId for the first frame. Use before precise local edits instead of get_asset includePixels. At most ${MAX_READ_CELLS} cells per call.`, assetIdInput.extend({ revisionId: identifier.optional(), frameId: identifier.optional(), layerId: identifier.optional(), rect: schema.rect.optional() }), input => {
    const revision = store.getRevision(input.assetId, input.revisionId); const { document } = revision;
    const area = input.rect ?? { x: 0, y: 0, width: document.width, height: document.height };
    if (area.x + area.width > document.width || area.y + area.height > document.height) throw new AppError('INVALID_RECT', 'The area must lie inside the canvas.');
    if (area.width * area.height > MAX_READ_CELLS) throw new AppError('REGION_TOO_LARGE', `At most ${MAX_READ_CELLS} cells per call. Choose a smaller rect.`);
    const frameId = input.frameId ?? document.frames[0].id;
    return { assetId: input.assetId, revisionId: revision.id, frameId, source: input.layerId ?? 'composite', ...area, legend: rowLegend(document.palette), rows: encodeRows(readIndices(document, input.layerId, frameId), document.width, area) };
  }, true);
  const inspectInput = assetIdInput.extend({
    preview: z.enum(['tiles', 'wrap', 'terrain']).optional(), terrain: z.number().int().min(1).max(8).optional(),
    revisionId: identifier.optional(), runId: identifier.optional(),
    scale: z.number().int().min(1).max(32).optional(), scales: z.array(z.number().int().min(1).max(32)).min(1).max(3).optional(),
    frameId: identifier.optional(), frameIds: z.array(identifier).min(1).max(MAX_FRAMES).optional(), tag: z.string().min(1).max(160).optional(),
    layout: z.enum(['frame', 'sheet']).optional(), columns: z.number().int().min(1).max(MAX_FRAMES).optional(),
    onion: z.object({ before: z.number().int().min(0).max(3).optional(), after: z.number().int().min(0).max(3).optional() }).strict().optional(),
    background: hexColor.optional(),
  });
  server.registerTool('inspect_asset', {
    description: 'See the actual PNG rendering, saved asset style and revision metadata. preview shows one frame differently: tiles separates every grid tile by a gutter, wrap repeats the image 3×3 to reveal seams of seamless textures, terrain paints a sample map (islands, rings, single cells, diagonal contacts) with the tiles labeled for one terrain (default 1), magenta cells being combinations without a tile. Current colors come from document.palette, not the original style palette. Pass scales, for example [1, 8], to receive native and enlarged images in one call, then review against the Artist Guide checklist. Animations render as one sprite sheet of all frames (or of frameIds/tag) in timeline order, separated by a gutter color outside the palette; frameId shows a single frame. onion tints previous frames blue and next frames red behind each frame to judge motion. This returns real image content. Pass runId to record delivery of the current revision before record_review; finishing an animation requires an inspection that showed every frame. Transparency is real; grid/checkerboard, gutters and onion tints are not asset pixels. Clients flatten transparency unpredictably (often to white or black), so pass background (#RRGGBB, ideally the game background) to paint it under transparent pixels; check on a dark and a light color when the game background is unknown. Keep enlarged images around 1024 px: clients downscale very large images, which blurs the pixel grid.',
    inputSchema: inspectInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async input => {
    try {
      const revision = store.getRevision(input.assetId, input.revisionId); const { document } = revision;
      const { asset } = store.getAsset(input.assetId);
      const background = input.background ? { background: input.background.toUpperCase() } : {};
      if (input.preview) {
        const frameId = input.frameId ?? document.frames[0].id; const terrain = input.terrain ?? 1;
        const render = (scale: number) => input.preview === 'wrap' ? renderWrapPreview(document, scale, frameId, input.background) : input.preview === 'tiles' ? renderTileSheet(document, scale, frameId, input.background) : renderTerrainPreview(document, terrain, scale, frameId, input.background);
        const native: { png: Buffer; width: number; height: number; gutterColor?: string; map?: { columns: number; rows: number; missing: number } } = render(1);
        const scales = input.scales ?? [input.scale ?? Math.max(1, Math.min(16, Math.floor(512 / Math.max(native.width, native.height))))];
        if (scales.some(scale => native.width * scale * native.height * scale > MAX_INSPECT_PIXELS)) throw new AppError('RENDER_SIZE', 'The inspection image would be too large. Choose a smaller zoom.');
        const images = scales.map(scale => ({ scale, ...(scale === 1 ? native : render(scale)) }));
        if (input.runId) store.inspected(input.runId, input.assetId, revision.id, [frameId]);
        const summary = {
          ...revisionSummary(revision), asset: { id: asset.id, name: asset.name, type: asset.type, style: asset.style },
          artistGuide: { version: ARTIST_GUIDE.version, uri: ARTIST_GUIDE.uri },
          scale: images[0].scale, imageWidth: images[0].width, imageHeight: images[0].height, images: images.map(({ scale, width, height }) => ({ scale, width, height })),
          view: { preview: input.preview, frameId, ...(native.gutterColor ? { gutterColor: native.gutterColor } : {}), ...(native.map ? { terrain, columns: native.map.columns, rows: native.map.rows, missingCells: native.map.missing } : {}), ...background },
        };
        return { content: [...images.map(image => ({ type: 'image' as const, data: image.png.toString('base64'), mimeType: 'image/png' })), { type: 'text' as const, text: JSON.stringify(summary) }], structuredContent: summary };
      }
      const frameIds = input.frameId ? [input.frameId] : input.frameIds ?? framesFor(document, input.tag);
      const layout = input.layout ?? (frameIds.length > 1 ? 'sheet' : 'frame');
      if (layout === 'frame' && frameIds.length !== 1) throw new AppError('INVALID_LAYOUT', 'layout frame shows exactly one frame; use layout sheet for several frames.');
      const sheet = sheetLayout(document, { frameIds, columns: input.columns ?? (layout === 'sheet' ? Math.min(frameIds.length, 8) : 1), gutter: layout === 'sheet' ? 1 : 0, background: input.background });
      const scales = input.scales ?? [input.scale ?? Math.max(1, Math.min(16, Math.floor(512 / Math.max(sheet.width, sheet.height))))];
      if (scales.some(scale => sheet.width * scale * sheet.height * scale > MAX_INSPECT_PIXELS)) throw new AppError('RENDER_SIZE', 'The inspection image would be too large. Choose a smaller zoom, fewer frames or a frameId.');
      const onion = input.onion && (input.onion.before || input.onion.after) ? input.onion : undefined;
      const images = scales.map(scale => ({
        scale, width: sheet.width * scale, height: sheet.height * scale,
        png: layout === 'frame' && !onion ? renderPng(document, scale, frameIds[0], input.background) : renderSheet(document, { frameIds, columns: sheet.columns, gutter: sheet.gutter, scale, onion, background: input.background }).png,
      }));
      if (input.runId) store.inspected(input.runId, input.assetId, revision.id, frameIds);
      const summary = {
        ...revisionSummary(revision), asset: { id: asset.id, name: asset.name, type: asset.type, style: asset.style },
        artistGuide: { version: ARTIST_GUIDE.version, uri: ARTIST_GUIDE.uri },
        scale: images[0].scale, imageWidth: images[0].width, imageHeight: images[0].height,
        images: images.map(({ scale, width, height }) => ({ scale, width, height })),
        view: { layout, frameIds, ...(layout === 'sheet' ? { columns: sheet.columns, rows: sheet.rows, gutter: sheet.gutter, gutterColor: sheet.gutterColor, cells: sheet.cells.map(({ frameId, column, row, x, y, durationMs }) => ({ frameId, column, row, x, y, durationMs })) } : {}), ...(onion ? { onion: { before: onion.before ?? 0, after: onion.after ?? 0, note: 'Blue tints show previous frames, red tints next frames.' } } : {}), ...background },
      };
      return { content: [...images.map(image => ({ type: 'image' as const, data: image.png.toString('base64'), mimeType: 'image/png' })), { type: 'text' as const, text: JSON.stringify(summary) }], structuredContent: summary };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: publicError(error) }) }] }; }
  });
  tool('validate_asset', 'Check dimensions, palette, alpha, bounding box and raster integrity. Isolated pixels and empty canvases are diagnostics, not automatic art-quality judgments. Light, readability and character identity require visual review.', assetIdInput.extend({ revisionId: identifier.optional() }), input => validateDocument(store.getRevision(input.assetId, input.revisionId).document), true);
  tool('list_revisions', 'List immutable revisions. inspect_asset can render a selected revision. Restoring creates a new revision and preserves history.', assetIdInput, input => ({ revisions: store.listRevisions(input.assetId).map(rev => ({ id: rev.id, parentId: rev.parentId, label: rev.label, actor: rev.actor, createdAt: rev.createdAt, validation: rev.validation })) }), true);
  tool('restore_revision', 'Restore an earlier whole-asset state as a new revision. This is a global history operation, not a scoped drawing edit.', schema.restoreInput.extend({ assetId: identifier }), ({ assetId, ...input }) => detailSummary(store.restore(assetId, input)));
  tool('create_variant', 'Duplicate the current asset, retaining indexed raster, style and semantic layers. The new asset records its sourceAssetId.', assetIdInput.extend({ name: z.string().trim().min(1).max(160) }), input => detailSummary(store.createVariant(input.assetId, input.name)));
  tool('export_asset', 'Export to the local exports folder, or with outputDir straight into a game folder: png (one frame, default first, true transparency), json (editable project), unity (the PNG, or for animations the sheet PNG, plus import metadata; animations get one sprite per frame and one clip per tag; tilesets get the tileset PNG with one sprite per tile at one unit per tile), tiled (tileset PNG plus Tiled .tsj and .tsx with collision, names, tile animations and the terrain as Wang set), godot (tileset PNG plus Godot 4 TileSet .tres with terrain set, peering bits, physics polygons and animations; keep both files in one folder); extrude repeats tile edges outward and spacing adds gaps against texture bleeding, sheet (all frames or one tag as a horizontal sprite sheet PNG plus Aseprite-compatible JSON with durations and frame tags), gif (animated preview for sharing; a tag plays in its direction and loop mode). scale enlarges png, sheet and gif by nearest neighbor (the sheet JSON addresses the enlarged image; unity stays 1x). Without outputDir, file names carry asset and revision IDs; with outputDir (an absolute path, created if missing) they stay stable (fileName or the asset name, plus the tag) and overwrite the previous export of the same name, and descriptor files reference the image under that name. pixelsPerUnit sets the Unity value (default 32 for sprites, the tile width for tilesets); use one value for every asset of a game, usually its tile size. No preview overlays; no Unity project is modified.', assetIdInput.extend({ format: z.enum(['png', 'json', 'unity', 'sheet', 'gif', 'tiled', 'godot']).default('png'), frameId: identifier.optional(), tag: z.string().min(1).max(160).optional(), columns: z.number().int().min(1).max(MAX_FRAMES).optional(), scale: z.number().int().min(1).max(16).optional(), extrude: z.number().int().min(0).max(4).optional(), spacing: z.number().int().min(0).max(8).optional(), outputDir: z.string().min(1).max(1000).optional(), fileName: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, 'Use 1-80 letters, digits, _ or -, without extension.').optional(), pixelsPerUnit: z.number().int().min(1).max(4096).optional() }), input => {
    const { asset, revision } = store.getAsset(input.assetId); const { document } = revision;
    if (input.outputDir !== undefined && !isAbsolute(input.outputDir)) throw new AppError('INVALID_PATH', 'outputDir must be an absolute path.');
    const safe = (text: string, length: number) => text.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, length);
    const stem = `${safe(asset.name, 80) || 'asset'}${input.outputDir ? '' : `-${asset.id.slice(-8)}-${revision.id.slice(-8)}`}${input.tag ? `-${safe(input.tag, 40)}` : ''}`;
    const base = input.fileName ?? stem; const dir = input.outputDir ? resolve(input.outputDir) : exportDir;
    const query = new URLSearchParams({ ...(input.frameId ? { frameId: input.frameId } : {}), ...(input.tag ? { tag: input.tag } : {}), ...(input.columns ? { columns: String(input.columns) } : {}), ...(input.scale ? { scale: String(input.scale) } : {}), ...(input.extrude ? { extrude: String(input.extrude) } : {}), ...(input.spacing ? { spacing: String(input.spacing) } : {}), ...(input.pixelsPerUnit ? { pixelsPerUnit: String(input.pixelsPerUnit) } : {}) });
    const url = (format: string) => `${baseUrl}/api/assets/${asset.id}/export?${new URLSearchParams({ format, ...Object.fromEntries(query) })}`;
    const sheet = () => renderSheet(document, { frameIds: framesFor(document, input.tag), columns: input.columns, scale: input.scale });
    const files: { path: string; downloadUrl: string }[] = [];
    // unscaled: Unity textures are written at 1x, so their download link drops scale.
    const write = (filename: string, bytes: Buffer, format: string, unscaled = false) => {
      const path = join(dir, filename); writeFileSync(path, bytes);
      const downloadUrl = new URL(url(format)); if (unscaled) downloadUrl.searchParams.delete('scale');
      files.push({ path, downloadUrl: downloadUrl.href });
    };
    mkdirSync(dir, { recursive: true });
    if (input.format === 'png') write(`${base}.png`, renderPng(document, input.scale ?? 1, input.frameId), 'png');
    else if (input.format === 'gif') write(`${base}.gif`, renderGif(document, { tag: input.tag, scale: input.scale }), 'gif');
    else if (input.format === 'json') write(`${base}.pixelator.json`, Buffer.from(JSON.stringify(store.exportAsset(asset.id), null, 2)), 'json');
    else if (input.format === 'tiled' || input.format === 'godot' || (input.format === 'unity' && document.tileset)) {
      const rendered = renderTilesetImage(document, { extrude: input.extrude, spacing: input.spacing }); const image = `${base}.tileset.png`;
      write(image, rendered.png, 'tileset');
      if (input.format === 'tiled') {
        write(`${base}.tsj`, Buffer.from(JSON.stringify(tiledTileset(document, asset.name, image, rendered.layout), null, 2)), 'tsj');
        write(`${base}.tsx`, Buffer.from(tiledTilesetXml(document, asset.name, image, rendered.layout)), 'tsx');
      } else if (input.format === 'godot') write(`${base}.tres`, Buffer.from(godotTileset(document, image, rendered.layout)), 'tres');
      else write(`${base}.unity.json`, Buffer.from(JSON.stringify(unityTilesetManifest(asset.id, revision.id, asset.name, document, image, rendered.layout, input.pixelsPerUnit), null, 2)), 'unity');
    } else if (input.format === 'unity') {
      // The image comes along at 1x, so the manifest and its texture always match.
      let manifest;
      if (document.frames.length > 1) {
        const rendered = renderSheet(document, { frameIds: framesFor(document, input.tag), columns: input.columns });
        write(`${base}.sheet.png`, rendered.png, 'sheet', true);
        manifest = unitySheetManifest(asset.id, revision.id, asset.name, document, { image: `${base}.sheet.png`, layout: rendered.layout }, input.pixelsPerUnit);
      } else {
        write(`${base}.png`, renderPng(document), 'png', true);
        manifest = unityManifest(asset.id, revision.id, asset.name, document, input.pixelsPerUnit);
      }
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
  tool('list_runs', 'List artist runs, most recently changed first, to find interrupted or unfinished work after a restart or in a new session. Filter by projectId, assetId or status (for example interrupted). Read reviews with get_run; continue an interrupted run with resume_run.', z.object({ projectId: identifier.optional(), assetId: identifier.optional(), status: z.enum(['active', 'completed', 'needs_review', 'cancelled', 'interrupted']).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), input => {
    const runs = store.listRuns().filter(run => (!input.projectId || run.projectId === input.projectId) && (!input.assetId || run.assetId === input.assetId) && (!input.status || run.status === input.status));
    return { total: runs.length, runs: runs.slice(0, input.limit ?? 20).map(runSummary) };
  }, true);
  tool('resume_run', 'Resume a run interrupted by a service restart and return the current Artist Guide. Preserve reviews and batch budget; reload and inspect the current asset before further edits.', runIdInput, input => ({ ...store.resumeRun(input.runId), artistGuide: ARTIST_GUIDE }));
  tool('record_review', 'Record concrete observations against the Artist Guide checklist (readability, clusters/edges, palette/light, style/context, edit fidelity, motion for animations) and remaining issues for the exact current revision delivered by inspect_asset(runId). Maximum one initial review plus three correction reviews. This records the agent assessment; it cannot prove visual understanding.', schema.reviewInput.extend({ runId: identifier }), ({ runId, ...input }) => store.recordReview(runId, input));
  tool('finish_run', 'Finish the task. completed requires a nonempty valid current revision and its latest inspection/review with no remaining issues. Otherwise use needs_review to preserve a useful partial result honestly.', runIdInput.extend({ status: z.enum(['completed', 'needs_review']) }), input => store.finishRun(input.runId, input.status));
  tool('cancel_run', 'Stop a run while preserving every saved revision.', runIdInput, input => store.finishRun(input.runId, 'cancelled'));
  server.registerResource('artist-workflow', 'pixelator://workflow', { mimeType: 'text/markdown', description: 'Portable Pixel Artist workflow for Codex, Claude and Antigravity' }, async uri => ({ contents: [{ uri: uri.href, text: WORKFLOW }] }));
  server.registerResource('artist-guide', ARTIST_GUIDE.uri, { mimeType: 'text/markdown', description: 'Source-backed Pixel Art best practices and visual review checklist for every artist task' }, async uri => ({ contents: [{ uri: uri.href, text: ARTIST_GUIDE.text }] }));
  return server;
}
