import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PNG } from 'pngjs';
import { createApp } from '../src/server.js';
import type { ApplyRequest, ApplyResult, ArtistRun, Asset, AssetDetail, McpStatus, Project } from '../src/types.js';
import { cel } from './helpers.js';

const apps = new Set<FastifyInstance>();
const mcpHeaders = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
  'mcp-protocol-version': '2025-11-25',
};
interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: Record<string, unknown>;
}
async function open() {
  const { app } = await createApp({ databasePath: ':memory:', logger: false });
  // The MCP transport (@hono/node-server) drains a request body Fastify already consumed and, 500 ms later, calls
  // net.Socket#destroySoon. light-my-request's mock socket lacks it, so long tests crashed; real sockets are unaffected.
  app.addHook('onRequest', async request => { const socket = request.raw.socket as { destroySoon?: () => void }; socket.destroySoon ??= () => undefined; });
  apps.add(app);
  return app;
}
async function rpc<T>(app: FastifyInstance, method: string, params: unknown, id = 1): Promise<T> {
  const response = await app.inject({ method: 'POST', url: '/mcp', headers: mcpHeaders, payload: { jsonrpc: '2.0', id, method, params } });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<{ jsonrpc: string; id: number; result: T; error?: unknown }>();
  expect(body).toMatchObject({ jsonrpc: '2.0', id });
  expect(body.error).toBeUndefined();
  return body.result;
}
async function setup(app: FastifyInstance) {
  const projectResponse = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Game assets', preset: 'game-boy' } });
  expect(projectResponse.statusCode).toBe(200);
  const project = projectResponse.json<Project>();
  const assetResponse = await app.inject({
    method: 'POST', url: '/api/assets',
    payload: { projectId: project.id, name: 'Knight', type: 'character', width: 8, height: 8, layers: [{ id: 'body', name: 'Body' }, { id: 'sword', name: 'Sword' }] },
  });
  expect(assetResponse.statusCode).toBe(200);
  return { project, detail: assetResponse.json<AssetDetail>() };
}
function paint(detail: AssetDetail, requestId = 'paint'): ApplyRequest {
  return {
    expectedRevision: detail.revision.id, requestId,
    editScope: { layerIds: ['body'], rect: { x: 1, y: 1, width: 2, height: 1 } },
    operations: [{ op: 'pixels', layerId: 'body', points: [[1, 1, 1], [2, 1, 2]] }],
  };
}
afterEach(async () => {
  await Promise.all([...apps].map(app => app.close()));
  apps.clear();
});

describe('local REST editing', () => {
  it('deletes assets and projects through REST and returns safe errors for removed content', async () => {
    const app = await open(); const { project, detail } = await setup(app);
    const edited = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: paint(detail) });
    expect(edited.statusCode).toBe(200);
    const variant = (await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/variant`, payload: { name: 'Retained variant' } })).json<AssetDetail>();
    const deleted = await app.inject({ method: 'DELETE', url: `/api/assets/${detail.asset.id}` });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({ id: detail.asset.id, projectId: project.id });
    expect((await app.inject(`/api/assets/${variant.asset.id}`)).json<AssetDetail>().asset.sourceAssetId).toBeUndefined();
    expect((await app.inject(`/api/assets?projectId=${project.id}`)).json<Asset[]>()).toHaveLength(1);
    for (const suffix of ['', '/revisions', '/revisions?summary=true', `/revisions/${detail.revision.id}`, '/png', '/thumbnail', '/export']) {
      const missing = await app.inject(`/api/assets/${detail.asset.id}${suffix}`);
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    const replay = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: paint(detail) });
    expect(replay.statusCode).toBe(404);
    const removedProject = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
    expect(removedProject.statusCode, removedProject.body).toBe(200);
    expect(removedProject.json()).toEqual({ id: project.id });
    expect((await app.inject('/api/projects')).json()).toEqual([]);
    expect((await app.inject(`/api/assets/${variant.asset.id}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/assets/${detail.asset.id}` })).statusCode).toBe(404);
  });

  it('serves compact revision summaries and individual history while preserving the full history endpoint', async () => {
    const app = await open(); const { detail } = await setup(app);
    const painted = (await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: paint(detail) })).json<ApplyResult>();
    const response = await app.inject(`/api/assets/${detail.asset.id}/revisions?summary=true`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([painted.revision, detail.revision].map(({ id, assetId, parentId, label, actor, createdAt }) => ({ id, assetId, parentId, label, actor, createdAt })));
    expect((await app.inject(`/api/assets/${detail.asset.id}/revisions/${detail.revision.id}`)).json()).toEqual(detail.revision);
    expect((await app.inject(`/api/assets/${detail.asset.id}/revisions`)).json()).toEqual([painted.revision, detail.revision]);
    expect((await app.inject(`/api/assets/${detail.asset.id}/revisions?summary=false`)).json()).toEqual([painted.revision, detail.revision]);
    expect((await app.inject(`/api/assets/${detail.asset.id}/revisions?summary=invalid`)).statusCode).toBe(400);
    const foreign = (await app.inject({ method: 'POST', url: '/api/assets', payload: { projectId: detail.asset.projectId, name: 'Other', type: 'item' } })).json<AssetDetail>();
    expect((await app.inject(`/api/assets/${foreign.asset.id}/revisions/${detail.revision.id}`)).json()).toMatchObject({ error: { code: 'WRONG_ASSET' } });
  });

  it('serves bounded thumbnails for large assets and the requested historical revision', async () => {
    const app = await open(); const { project, detail: small } = await setup(app);
    const detail = (await app.inject({ method: 'POST', url: '/api/assets', payload: { projectId: project.id, name: 'Wide prop', type: 'prop', width: 384, height: 192 } })).json<AssetDetail>();
    const edited = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: {
      expectedRevision: detail.revision.id, requestId: 'thumbnail-paint', editScope: { layerIds: ['body'] },
      operations: [{ op: 'rect', layerId: 'body', x: 0, y: 0, width: 384, height: 192, color: 1, filled: true }],
    } });
    expect(edited.statusCode, edited.body).toBe(200);
    const response = await app.inject(`/api/assets/${detail.asset.id}/thumbnail`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    const thumbnail = PNG.sync.read(response.rawPayload);
    expect([thumbnail.width, thumbnail.height]).toEqual([96, 48]);
    expect([...thumbnail.data.subarray(0, 4)]).toEqual([15, 56, 15, 255]);
    const original = PNG.sync.read((await app.inject(`/api/assets/${detail.asset.id}/thumbnail?revisionId=${detail.revision.id}`)).rawPayload);
    expect(original.data.every(channel => channel === 0)).toBe(true);
    const native = PNG.sync.read((await app.inject(`/api/assets/${small.asset.id}/thumbnail`)).rawPayload);
    expect([native.width, native.height]).toEqual([8, 8]);
    expect((await app.inject(`/api/assets/${small.asset.id}/thumbnail?revisionId=${detail.revision.id}`)).json()).toMatchObject({ error: { code: 'WRONG_ASSET' } });
  });

  it('shares duplicate layers and composite/global fill through REST, MCP and project import', async () => {
    const app = await open(); const { project, detail } = await setup(app);
    const outline = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: {
      expectedRevision: detail.revision.id, requestId: 'rest-outline',
      editScope: { layerIds: ['sword'] },
      operations: [{ op: 'rect', layerId: 'sword', x: 0, y: 0, width: 5, height: 3, color: 1, filled: false }],
    } });
    expect(outline.statusCode, outline.body).toBe(200);
    const outlined = outline.json<ApplyResult>();
    const operations: ApplyRequest['operations'] = [
      { op: 'duplicate_layer', layerId: 'body', id: 'color-copy', name: 'Color copy' },
      { op: 'fill', layerId: 'color-copy', x: 1, y: 1, color: 2, reference: 'composite', contiguous: true },
      { op: 'fill', layerId: 'color-copy', x: 1, y: 1, color: 3, reference: 'layer', contiguous: false },
    ];
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${address}/mcp`, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'apply_operations', arguments: {
      assetId: detail.asset.id, expectedRevision: outlined.revision.id, requestId: 'mcp-copy-fill',
      editScope: { layerIds: ['body', 'sword'], allowLayerChanges: true }, operations,
    } } }) });
    expect(response.status).toBe(200);
    const edited = (await response.json() as { result: ToolResult }).result;
    expect(edited.isError, JSON.stringify(edited.content)).not.toBe(true);
    const current = (await app.inject(`/api/assets/${detail.asset.id}`)).json<AssetDetail>();
    expect(current.revision.document.layers.map(layer => layer.id)).toEqual(['body', 'color-copy', 'sword']);
    expect(current.revision.document.layers[0]).toEqual(detail.revision.document.layers[0]);
    expect(cel(current.revision.document, 0)).toEqual(cel(detail.revision.document, 0));
    expect(current.revision.document.layers[2]).toEqual(outlined.revision.document.layers[1]);
    expect(cel(current.revision.document, 2)).toEqual(cel(outlined.revision.document, 1));
    expect(cel(current.revision.document, 1).filter(Boolean)).toEqual([3, 3, 3]);
    expect(current.revision.operations).toEqual(operations);
    const bundle = (await app.inject(`/api/projects/${project.id}/export`)).json();
    const imported = await app.inject({ method: 'POST', url: '/api/projects/import', payload: { project: bundle } });
    expect(imported.statusCode, imported.body).toBe(200);
    const assets = (await app.inject(`/api/assets?projectId=${imported.json<Project>().id}`)).json<Asset[]>();
    const copy = (await app.inject(`/api/assets/${assets[0].id}`)).json<AssetDetail>();
    expect(copy.revision.document).toEqual(current.revision.document);
    expect(copy.revision.operations).toEqual(operations);
    const invalid = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: {
      expectedRevision: current.revision.id, requestId: 'invalid-fill-option',
      editScope: { layerIds: ['body'] },
      operations: [{ op: 'fill', layerId: 'body', x: 0, y: 0, color: 1, contiguous: 'false' }],
    } });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject(`/api/assets/${detail.asset.id}`)).json()).toEqual(current);
  });

  it('creates, edits and round-trips larger rectangular assets and project defaults', async () => {
    const app = await open(); const { project } = await setup(app);
    const updated = await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { style: { ...project.style, width: 128, height: 96 } } });
    expect(updated.statusCode, updated.body).toBe(200);
    const created = await app.inject({ method: 'POST', url: '/api/assets', payload: { projectId: project.id, name: 'Large prop', type: 'prop' } });
    expect(created.statusCode, created.body).toBe(200);
    const detail = created.json<AssetDetail>();
    expect(detail.revision.document).toMatchObject({ width: 128, height: 96 });
    const pixels = new Array(128 * 96).fill(0); pixels[80 * 128 + 100] = 1;
    const edited = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: {
      expectedRevision: detail.revision.id, requestId: 'large-patch',
      editScope: { layerIds: ['body'], allowLayerChanges: true },
      operations: [
        { op: 'patch', layerId: 'body', x: 0, y: 0, width: 128, height: 96, pixels },
        { op: 'move', layerId: 'body', dx: -80, dy: -80, rect: { x: 100, y: 80, width: 1, height: 1 } },
        { op: 'pivot', x: 127.5, y: 96 },
      ],
    } });
    expect(edited.statusCode, edited.body).toBe(200);
    const painted = edited.json<ApplyResult>().revision.document;
    expect(cel(painted)[20]).toBe(1);
    expect(cel(painted)[80 * 128 + 100]).toBe(0);
    expect(painted.pivot).toEqual({ x: 127.5, y: 96 });
    const pngResponse = await app.inject(`/api/assets/${detail.asset.id}/export?format=png`);
    expect(pngResponse.statusCode).toBe(200);
    const png = PNG.sync.read(pngResponse.rawPayload);
    expect([png.width, png.height]).toEqual([128, 96]);
    expect([...png.data.subarray(20 * 4, 20 * 4 + 4)]).toEqual([15, 56, 15, 255]);
    const pngImport = await app.inject({ method: 'POST', url: '/api/import', payload: { projectId: project.id, name: 'Imported large prop', type: 'prop', pngBase64: pngResponse.rawPayload.toString('base64') } });
    expect(pngImport.statusCode, pngImport.body).toBe(200);
    expect(cel(pngImport.json<AssetDetail>().revision.document)).toEqual(cel(painted));
    const bundle = (await app.inject(`/api/assets/${detail.asset.id}/export?format=json`)).json();
    const imported = await app.inject({ method: 'POST', url: '/api/projects/import', payload: { project: bundle } });
    expect(imported.statusCode, imported.body).toBe(200);
    const copies = (await app.inject(`/api/assets?projectId=${imported.json<Project>().id}`)).json<Asset[]>();
    expect((await app.inject(`/api/assets/${copies[0].id}`)).json<AssetDetail>().revision.document).toEqual(painted);
  });

  it('rejects repeated search parameters and unknown asset types as invalid input', async () => {
    const app = await open(); const { project, detail } = await setup(app);
    for (const query of ['q=a&q=b', 'type=other', `projectId=${project.id}`]) {
      const response = await app.inject(`/api/assets?projectId=${project.id}&${query}`);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_INPUT');
    }
    const valid = await app.inject(`/api/assets?projectId=${project.id}&q=Knight&type=`);
    expect(valid.statusCode).toBe(200);
    expect(valid.json().map((asset: Asset) => asset.id)).toEqual([detail.asset.id]);
  });

  it('shuts down with an open editor event stream instead of waiting for the browser to disconnect', async () => {
    const app = await open();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP');
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events`, { signal: controller.signal });
    await response.body!.getReader().read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([app.close().then(() => 'closed'), new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 1500); })]);
      expect(result).toBe('closed');
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  });

  it('restores an exported project larger than 16 MiB while keeping the ordinary request limit', async () => {
    const { app, store } = await createApp({ databasePath: ':memory:', logger: false });
    apps.add(app);
    const project = store.createProject({ name: 'Layered project history' });
    let detail: AssetDetail = store.createAsset({
      projectId: project.id, name: 'Layered character', type: 'character', width: 64, height: 64,
      layers: Array.from({ length: 16 }, (_, index) => ({ id: `part_${index}`, name: `Part ${index}` })),
    });
    for (let index = 0; index < 132; index++) {
      detail = store.apply(detail.asset.id, {
        expectedRevision: detail.revision.id, requestId: `history_${index}`,
        editScope: { layerIds: ['part_0'] },
        operations: [{ op: 'pixels', layerId: 'part_0', points: [[0, 0, index % 2 + 1]] }],
      });
    }
    const exported = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` });
    expect(exported.statusCode).toBe(200);
    const payload = JSON.stringify({ project: exported.json() });
    expect(Buffer.byteLength(payload)).toBeGreaterThan(16 * 1024 * 1024);
    expect(Buffer.byteLength(payload)).toBeLessThan(18 * 1024 * 1024);
    const imported = await app.inject({ method: 'POST', url: '/api/projects/import', headers: { 'content-type': 'application/json' }, payload });
    expect(imported.statusCode, imported.body).toBe(200);
    const copy = store.listAssets(imported.json<Project>().id)[0];
    expect(store.getAsset(copy.id).revision.document).toEqual(detail.revision.document);
    expect(store.listRevisions(copy.id)).toHaveLength(133);
    const ordinary = await app.inject({ method: 'POST', url: '/api/projects', headers: { 'content-type': 'application/json' }, payload });
    expect(ordinary.statusCode).toBe(413);
    expect(store.listProjects()).toHaveLength(2);
  }, 20000);

  it('keeps single-asset exports separate from other assets in the project', async () => {
    const app = await open(); const { project, detail } = await setup(app);
    await app.inject({ method: 'POST', url: '/api/assets', payload: { projectId: project.id, name: 'Other asset', type: 'item' } });
    const exported = await app.inject({ method: 'GET', url: `/api/assets/${detail.asset.id}/export?format=json` });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().assets.map((asset: Asset) => asset.id)).toEqual([detail.asset.id]);
    expect(exported.json().revisions.every((rev: { assetId: string }) => rev.assetId === detail.asset.id)).toBe(true);
    const wholeProject = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` });
    expect(wholeProject.json().assets).toHaveLength(2);
  });

  it('returns a client error for malformed JSON without changing stored projects', async () => {
    const app = await open();
    const response = await app.inject({ method: 'POST', url: '/api/projects', headers: { 'content-type': 'application/json' }, payload: '{bad-json' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
    expect((await app.inject('/api/projects')).json()).toEqual([]);
  });

  it('creates a project, persists an atomic revision, replays retries and returns exact transparent PNG pixels', async () => {
    const app = await open();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, name: 'Pixelator', mode: 'external-agent' });
    const { project, detail } = await setup(app);
    expect(detail.asset.style).toEqual({ ...project.style, width: 8, height: 8 });
    const payload = paint(detail);
    const response = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload });
    expect(response.statusCode, response.body).toBe(200);
    const painted = response.json<ApplyResult>();
    expect(painted.revision.id).not.toBe(detail.revision.id);
    expect(painted.diff.changedPixels).toBe(2);
    expect(painted.revision.document.layers[1]).toEqual(detail.revision.document.layers[1]);
    expect(cel(painted.revision.document, 1)).toEqual(cel(detail.revision.document, 1));

    const replay = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(painted);
    const stale = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: { ...payload, requestId: 'stale' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
    const current = await app.inject({ method: 'GET', url: `/api/assets/${detail.asset.id}` });
    expect(current.json<AssetDetail>().revision).toEqual(painted.revision);
    const history = await app.inject({ method: 'GET', url: `/api/assets/${detail.asset.id}/revisions` });
    expect(history.json()).toHaveLength(2);

    const pngResponse = await app.inject({ method: 'GET', url: `/api/assets/${detail.asset.id}/png` });
    expect(pngResponse.statusCode).toBe(200);
    expect(pngResponse.headers['content-type']).toContain('image/png');
    expect([...pngResponse.rawPayload.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = PNG.sync.read(pngResponse.rawPayload);
    expect([png.width, png.height]).toEqual([8, 8]);
    expect([...png.data.subarray((1 * 8 + 1) * 4, (1 * 8 + 1) * 4 + 4)]).toEqual([15, 56, 15, 255]);
    expect([...png.data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it('round-trips project history and editable semantic layers through export/import', async () => {
    const app = await open(); const { project, detail } = await setup(app);
    const edited = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: paint(detail) });
    expect(edited.statusCode).toBe(200);
    const painted = edited.json<ApplyResult>();
    const exported = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toContain('attachment;');
    expect(exported.json()).toMatchObject({ kind: 'pixelator-project', schemaVersion: 2 });
    const imported = await app.inject({ method: 'POST', url: '/api/projects/import', payload: { project: exported.json() } });
    expect(imported.statusCode, imported.body).toBe(200);
    const copy = imported.json<Project>();
    expect(copy.id).not.toBe(project.id);
    expect(copy.style).toEqual(project.style);
    const listing = await app.inject({ method: 'GET', url: `/api/assets?projectId=${copy.id}` });
    const assets = listing.json<Asset[]>();
    expect(assets).toHaveLength(1);
    expect(assets[0].id).not.toBe(detail.asset.id);
    const loaded = await app.inject({ method: 'GET', url: `/api/assets/${assets[0].id}` });
    expect(loaded.json<AssetDetail>().revision.document).toEqual(painted.revision.document);
    const history = await app.inject({ method: 'GET', url: `/api/assets/${assets[0].id}/revisions` });
    expect(history.json()).toHaveLength(2);
  });
});

describe('MCP transport', () => {
  it('creates and edits canvases beyond 4096 pixels per axis and inspects them at a valid default scale', async () => {
    const app = await open(); const { project } = await setup(app);
    const created = await rpc<ToolResult>(app, 'tools/call', { name: 'create_asset', arguments: { projectId: project.id, name: 'Wide prop', type: 'prop', width: 5000, height: 2 } });
    expect(created.isError).not.toBe(true);
    const detail = created.structuredContent as unknown as AssetDetail;
    const points = Array.from({ length: 5000 }, (_, x) => [x, 1, 1]);
    const edited = await rpc<ToolResult>(app, 'tools/call', { name: 'apply_operations', arguments: {
      assetId: detail.asset.id, expectedRevision: detail.revision.id, requestId: 'wide-pixels',
      editScope: { layerIds: ['body'], rect: { x: 0, y: 1, width: 5000, height: 1 } },
      operations: [{ op: 'pixels', layerId: 'body', points }],
    } });
    expect(edited.isError).not.toBe(true);
    expect(edited.structuredContent).toMatchObject({ diff: { changedPixels: 5000 } });
    const inspected = await rpc<ToolResult>(app, 'tools/call', { name: 'inspect_asset', arguments: { assetId: detail.asset.id } });
    expect(inspected.isError).not.toBe(true);
    expect(inspected.structuredContent).toMatchObject({ scale: 1, imageWidth: 5000, imageHeight: 2 });
    const png = PNG.sync.read(Buffer.from(inspected.content.find(content => content.type === 'image')!.data!, 'base64'));
    expect([...png.data.subarray((5000 + 4999) * 4)]).toEqual([15, 56, 15, 255]);
  });

  async function connect(app: FastifyInstance, name: string, protocolVersion = '2025-11-25') {
    const response = await app.inject({ method: 'POST', url: '/mcp', headers: mcpHeaders, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name, version: '1.0.0' } } } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().error).toBeUndefined();
    const sessionId = response.headers['mcp-session-id'];
    expect(sessionId).toEqual(expect.any(String));
    expect(response.json().result.protocolVersion).toBe(protocolVersion);
    return { ...mcpHeaders, 'mcp-protocol-version': protocolVersion, 'mcp-session-id': sessionId as string };
  }

  it('tracks Claude, Codex and Antigravity independently, including multiple sessions and explicit disconnects', async () => {
    const app = await open();
    const claude = await connect(app, 'claude-code');
    const codex = await connect(app, 'codex-mcp-client');
    const secondCodex = await connect(app, 'Codex Desktop');
    const antigravity = await connect(app, 'Antigravity IDE');
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents).toEqual({
      claude: { connected: true, sessions: 1, lastSeenAt: expect.any(String) },
      codex: { connected: true, sessions: 2, lastSeenAt: expect.any(String) },
      antigravity: { connected: true, sessions: 1, lastSeenAt: expect.any(String) },
    });
    const initialized = await app.inject({ method: 'POST', url: '/mcp', headers: codex, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(initialized.statusCode).toBe(202);
    const tools = await app.inject({ method: 'POST', url: '/mcp', headers: codex, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
    expect(tools.statusCode, tools.body).toBe(200);
    expect(tools.json().result.tools.length).toBeGreaterThan(0);
    const { 'content-type': _codexContentType, ...codexDeleteHeaders } = codex;
    const { 'content-type': _secondCodexContentType, ...secondCodexDeleteHeaders } = secondCodex;
    expect((await app.inject({ method: 'DELETE', url: '/mcp', headers: codexDeleteHeaders })).statusCode).toBe(200);
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.codex).toMatchObject({ connected: true, sessions: 1 });
    expect((await app.inject({ method: 'DELETE', url: '/mcp', headers: secondCodexDeleteHeaders })).statusCode).toBe(200);
    const disconnected = (await app.inject('/api/mcp/status')).json<McpStatus>().agents;
    expect(disconnected.codex).toMatchObject({ connected: false, sessions: 0, lastSeenAt: expect.any(String) });
    expect(disconnected.claude.connected).toBe(true);
    expect(disconnected.antigravity.connected).toBe(true);
    const { 'content-type': _antigravityContentType, ...antigravityDeleteHeaders } = antigravity;
    expect((await app.inject({ method: 'DELETE', url: '/mcp', headers: antigravityDeleteHeaders })).statusCode).toBe(200);
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.antigravity).toMatchObject({ connected: false, sessions: 0, lastSeenAt: expect.any(String) });
    expect((await app.inject({ method: 'POST', url: '/api/mcp/stop' })).json<McpStatus>().agents.claude.connected).toBe(false);
    await app.inject({ method: 'POST', url: '/api/mcp/start' });
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.claude.connected).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/mcp', headers: claude, payload: { jsonrpc: '2.0', id: 3, method: 'tools/list' } })).statusCode).toBe(404);
  });

  it.each(['2024-11-05', '2025-03-26', '2025-06-18'])('serves workflow, resources and PNG images to Antigravity over MCP %s', async protocolVersion => {
    const app = await open(); const { detail } = await setup(app);
    const headers = await connect(app, 'antigravity', protocolVersion);
    const initialized = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(initialized.statusCode).toBe(202);
    const tools = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
    expect(tools.json().result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'get_workflow' }), expect.objectContaining({ name: 'inspect_asset' })]));
    const workflow = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_workflow', arguments: {} } } });
    expect(workflow.json().result.isError).not.toBe(true);
    expect(JSON.parse(workflow.json().result.content[0].text).artistGuide.uri).toBe('pixelator://artist-guide');
    const resource = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'pixelator://workflow' } } });
    expect(resource.json().result.contents[0]).toMatchObject({ uri: 'pixelator://workflow', text: expect.stringContaining('Pixel Artist') });
    const inspected = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'inspect_asset', arguments: { assetId: detail.asset.id, scale: 1 } } } });
    expect(inspected.json().result.isError).not.toBe(true);
    const image = inspected.json().result.content.find((content: ToolResult['content'][number]) => content.type === 'image');
    expect(image.mimeType).toBe('image/png');
    expect(PNG.sync.read(Buffer.from(image.data, 'base64'))).toMatchObject({ width: 8, height: 8 });
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.antigravity).toMatchObject({ connected: true, sessions: 1 });
    await app.inject({ method: 'POST', url: '/api/mcp/stop' });
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.antigravity).toMatchObject({ connected: false, sessions: 0 });
  });

  it('expires idle client sessions and refreshes the timeout on subsequent requests', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const start = Date.now(); const app = await open();
      const headers = await connect(app, 'codex_cli_rs');
      vi.setSystemTime(start + 299_000);
      expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.codex.connected).toBe(true);
      await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 2, method: 'ping' } });
      vi.setSystemTime(start + 598_000);
      expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.codex.connected).toBe(true);
      vi.setSystemTime(start + 599_000);
      expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.codex).toMatchObject({ connected: false, sessions: 0 });
      expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 3, method: 'ping' } })).statusCode).toBe(404);
    } finally { vi.useRealTimers(); }
  });

  it('does not mark an unknown client or a rejected initialization as a supported agent', async () => {
    const app = await open();
    await connect(app, 'another-client');
    await app.inject({ method: 'POST', url: '/mcp', headers: mcpHeaders, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } } });
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents).toEqual({
      claude: { connected: false, sessions: 0, lastSeenAt: null }, codex: { connected: false, sessions: 0, lastSeenAt: null },
      antigravity: { connected: false, sessions: 0, lastSeenAt: null },
    });
  });

  it('streams the initial status, in-flight requests and start/stop changes to the editor', async () => {
    const app = await open();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP');
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffered = '';
    const nextStatus = async (): Promise<McpStatus> => {
      while (true) {
        const end = buffered.indexOf('\n\n');
        if (end < 0) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('Event stream closed before status arrived');
          buffered += decoder.decode(chunk.value, { stream: true });
          continue;
        }
        const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2);
        if (frame.startsWith('data: ')) {
          const event = JSON.parse(frame.slice(6));
          expect(event.type).toBe('mcp');
          return event.status;
        }
      }
    };
    try {
      expect(await nextStatus()).toMatchObject({ running: true, requests: 0, activeRequests: 0 });
      await rpc(app, 'tools/list', {});
      expect(await nextStatus()).toMatchObject({ requests: 1, activeRequests: 1 });
      expect(await nextStatus()).toMatchObject({ requests: 1, activeRequests: 0 });
      await app.inject({ method: 'POST', url: '/api/mcp/stop' });
      expect(await nextStatus()).toMatchObject({ running: false });
      await app.inject({ method: 'POST', url: '/api/mcp/start' });
      expect(await nextStatus()).toMatchObject({ running: true, requests: 1 });
    } finally { controller.abort(); }
  });

  it('reports real request statistics and stops MCP without stopping the editor or losing data', async () => {
    const app = await open(); const { project } = await setup(app);
    const initialResponse = await app.inject('/api/mcp/status');
    expect(initialResponse.headers['cache-control']).toBe('no-store');
    const initial = initialResponse.json<McpStatus>();
    expect(initial).toEqual({ running: true, endpoint: 'http://127.0.0.1:4317/mcp', startedAt: expect.any(String), requests: 0, toolCalls: 0, activeRequests: 0, lastRequestAt: null, agents: { claude: { connected: false, sessions: 0, lastSeenAt: null }, codex: { connected: false, sessions: 0, lastSeenAt: null }, antigravity: { connected: false, sessions: 0, lastSeenAt: null } } });
    await rpc(app, 'tools/list', {});
    await rpc(app, 'tools/call', { name: 'list_projects', arguments: {} });
    const beforeStop = (await app.inject('/api/mcp/status')).json<McpStatus>();
    expect(beforeStop).toMatchObject({ running: true, requests: 2, toolCalls: 1, activeRequests: 0, lastRequestAt: expect.any(String) });

    const stopped = await app.inject({ method: 'POST', url: '/api/mcp/stop' });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toEqual({ ...beforeStop, running: false, startedAt: null });
    const blocked = await app.inject({ method: 'POST', url: '/mcp', headers: mcpHeaders, payload: { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'create_project', arguments: { name: 'Blocked' } } } });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json()).toMatchObject({ jsonrpc: '2.0', id: 42, error: { code: -32000 } });
    expect((await app.inject('/api/projects')).json()).toEqual([project]);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/mcp/stop' })).json()).toEqual(stopped.json());

    const restarted = await app.inject({ method: 'POST', url: '/api/mcp/start' });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json()).toMatchObject({ running: true, startedAt: expect.any(String), requests: 2, toolCalls: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/mcp/start' })).json()).toEqual(restarted.json());
    await rpc(app, 'tools/call', { name: 'list_projects', arguments: {} });
    expect((await app.inject('/api/mcp/status')).json()).toMatchObject({ running: true, requests: 3, toolCalls: 2, activeRequests: 0 });
    expect((await app.inject({ method: 'POST', url: '/api/mcp/restart' })).statusCode).toBe(400);
    expect((await app.inject('/api/mcp/status')).json()).toMatchObject({ running: true, requests: 3 });
  });

  it('delivers the same current Artist Guide through workflow, resource and new or resumed artist runs', async () => {
    const app = await open(); const { project, detail } = await setup(app);
    const workflow = await rpc<ToolResult>(app, 'tools/call', { name: 'get_workflow', arguments: {} });
    expect(workflow.isError).not.toBe(true);
    const guide = workflow.structuredContent!.artistGuide as { version: string; uri: string; text: string };
    expect(guide).toMatchObject({ version: expect.any(String), uri: 'pixelator://artist-guide', text: expect.any(String) });
    expect(guide.text.length).toBeGreaterThan(100);
    const resources = await rpc<{ resources: { uri: string }[] }>(app, 'resources/list', {});
    expect(resources.resources.map(resource => resource.uri)).toContain(guide.uri);
    const resource = await rpc<{ contents: { uri: string; text: string }[] }>(app, 'resources/read', { uri: guide.uri });
    expect(resource.contents).toEqual([{ uri: guide.uri, text: guide.text }]);
    const run = await rpc<ToolResult>(app, 'tools/call', { name: 'start_run', arguments: { projectId: project.id, assetId: detail.asset.id, prompt: 'Improve the silhouette' } });
    expect(run.isError).not.toBe(true);
    expect(run.structuredContent).toMatchObject({ status: 'active', artistGuide: guide });
    const storedRun = await rpc<ToolResult>(app, 'tools/call', { name: 'get_run', arguments: { runId: run.structuredContent!.id } });
    expect(storedRun.structuredContent).not.toHaveProperty('artistGuide');
    const bundle = (await app.inject(`/api/projects/${project.id}/export`)).json();
    const imported = await app.inject({ method: 'POST', url: '/api/projects/import', payload: { project: bundle } });
    expect(imported.statusCode).toBe(200);
    const interrupted = (await app.inject('/api/runs')).json<ArtistRun[]>().find(r => r.projectId === imported.json<Project>().id)!;
    expect(interrupted.status).toBe('interrupted');
    const resumed = await rpc<ToolResult>(app, 'tools/call', { name: 'resume_run', arguments: { runId: interrupted.id } });
    expect(resumed.isError).not.toBe(true);
    expect(resumed.structuredContent).toMatchObject({ id: interrupted.id, status: 'active', artistGuide: guide });
  });

  it('initializes, advertises agent tools and delivers the actual inspected revision as PNG image content', async () => {
    const app = await open(); const { detail } = await setup(app);
    const edited = await app.inject({ method: 'POST', url: `/api/assets/${detail.asset.id}/operations`, payload: paint(detail) });
    const painted = edited.json<ApplyResult>();
    const initialized = await rpc<{ protocolVersion: string; serverInfo: { name: string } }>(app, 'initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pixelator-integration-test', version: '1.0.0' },
    });
    expect(initialized).toMatchObject({ protocolVersion: '2025-11-25', serverInfo: { name: 'pixelator' } });
    const listing = await rpc<{ tools: { name: string }[] }>(app, 'tools/list', {}, 2);
    expect(listing.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['get_workflow', 'apply_operations', 'inspect_asset', 'record_review']));
    const inspected = await rpc<ToolResult>(app, 'tools/call', { name: 'inspect_asset', arguments: { assetId: detail.asset.id, revisionId: painted.revision.id, scale: 2 } }, 3);
    expect(inspected.isError).not.toBe(true);
    expect(inspected.structuredContent).toMatchObject({ id: painted.revision.id, asset: { id: detail.asset.id, name: 'Knight', style: detail.asset.style }, artistGuide: { uri: 'pixelator://artist-guide' }, scale: 2, imageWidth: 16, imageHeight: 16 });
    const image = inspected.content.find(content => content.type === 'image');
    expect(image).toMatchObject({ mimeType: 'image/png' });
    expect(typeof image?.data).toBe('string');
    const png = PNG.sync.read(Buffer.from(image!.data!, 'base64'));
    expect([png.width, png.height]).toEqual([16, 16]);
    expect([...png.data.subarray((2 * 16 + 2) * 4, (2 * 16 + 2) * 4 + 4)]).toEqual([15, 56, 15, 255]);
    expect(png.data[3]).toBe(0);
  });

  it('reads compact rows that the rows operation reproduces exactly and bounds the region size', async () => {
    const app = await open(); const { project, detail } = await setup(app);
    const drawn = await rpc<ToolResult>(app, 'tools/call', { name: 'apply_operations', arguments: {
      assetId: detail.asset.id, expectedRevision: detail.revision.id, requestId: 'draw-rows', editScope: { layerIds: ['body', 'sword'] },
      operations: [{ op: 'rows', layerId: 'body', x: 1, y: 2, rows: ['121', '.3.'] }, { op: 'pixels', layerId: 'sword', points: [[2, 3, 4]] }],
    } });
    expect(drawn.isError, JSON.stringify(drawn.content)).not.toBe(true);
    const composite = await rpc<ToolResult>(app, 'tools/call', { name: 'read_pixels', arguments: { assetId: detail.asset.id, rect: { x: 0, y: 2, width: 4, height: 2 } } });
    expect(composite.structuredContent).toMatchObject({ source: 'composite', x: 0, y: 2, width: 4, height: 2, rows: ['.121', '..4.'], legend: { '.': 'transparent', 1: '#0F380F' } });
    const layer = await rpc<ToolResult>(app, 'tools/call', { name: 'read_pixels', arguments: { assetId: detail.asset.id, layerId: 'body' } });
    expect(layer.structuredContent!.rows).toEqual(['........', '........', '.121....', '..3.....', '........', '........', '........', '........']);
    const copy = (await rpc<ToolResult>(app, 'tools/call', { name: 'create_asset', arguments: { projectId: project.id, name: 'Copy', type: 'item', width: 8, height: 8 } })).structuredContent as unknown as AssetDetail;
    await rpc<ToolResult>(app, 'tools/call', { name: 'apply_operations', arguments: {
      assetId: copy.asset.id, expectedRevision: copy.revision.id, requestId: 'replay-rows', editScope: { layerIds: ['body'] },
      operations: [{ op: 'rows', layerId: 'body', x: 0, y: 0, rows: layer.structuredContent!.rows }],
    } });
    const original = cel((await app.inject(`/api/assets/${detail.asset.id}`)).json<AssetDetail>().revision.document);
    expect(cel((await app.inject(`/api/assets/${copy.asset.id}`)).json<AssetDetail>().revision.document)).toEqual(original);
    const wide = (await rpc<ToolResult>(app, 'tools/call', { name: 'create_asset', arguments: { projectId: project.id, name: 'Wide', type: 'prop', width: 200, height: 100 } })).structuredContent as unknown as AssetDetail;
    const tooLarge = await rpc<ToolResult>(app, 'tools/call', { name: 'read_pixels', arguments: { assetId: wide.asset.id } });
    expect(tooLarge.isError).toBe(true);
    expect(JSON.parse(tooLarge.content[0].text!)).toMatchObject({ error: { code: 'REGION_TOO_LARGE' } });
    const outside = await rpc<ToolResult>(app, 'tools/call', { name: 'read_pixels', arguments: { assetId: detail.asset.id, rect: { x: 7, y: 0, width: 2, height: 1 } } });
    expect(JSON.parse(outside.content[0].text!)).toMatchObject({ error: { code: 'INVALID_RECT' } });
    const unknown = await rpc<ToolResult>(app, 'tools/call', { name: 'read_pixels', arguments: { assetId: detail.asset.id, layerId: 'cape' } });
    expect(JSON.parse(unknown.content[0].text!)).toMatchObject({ error: { code: 'UNKNOWN_LAYER' } });
  });

  it('answers apply_operations compactly by default and in full on request', async () => {
    const app = await open(); const { detail } = await setup(app);
    const compact = await rpc<ToolResult>(app, 'tools/call', { name: 'apply_operations', arguments: { assetId: detail.asset.id, ...paint(detail) } });
    const current = (await app.inject(`/api/assets/${detail.asset.id}`)).json<AssetDetail>();
    expect(compact.structuredContent).toEqual({
      assetId: detail.asset.id, revisionId: current.revision.id, parentId: detail.revision.id, label: 'Pixel bearbeitet',
      diff: { changedPixels: 2, changedLayers: ['body'], changedFrames: ['frame-1'], boundingBox: { x: 1, y: 1, width: 2, height: 1 } },
      validation: { valid: true, colorCount: 2, opaquePixels: 2, boundingBox: { x: 1, y: 1, width: 2, height: 1 }, isolatedPixels: 0, issues: [] },
      layers: [{ id: 'body', visible: true, locked: false }, { id: 'sword', visible: true, locked: false }],
      frames: [{ id: 'frame-1', durationMs: 100 }], tags: [],
    });
    expect(JSON.stringify(compact.structuredContent)).not.toContain('palette');
    const full = await rpc<ToolResult>(app, 'tools/call', { name: 'apply_operations', arguments: {
      assetId: detail.asset.id, ...paint(current, 'full'), response: 'full',
      operations: [{ op: 'pixels', layerId: 'body', points: [[1, 1, 3]] }],
    } });
    expect(full.structuredContent).toMatchObject({ asset: { id: detail.asset.id }, revision: { parentId: current.revision.id, document: { palette: current.revision.document.palette } }, diff: { changedPixels: 1 } });
  });

  it('returns native and enlarged inspection images in one call and rejects oversized renders', async () => {
    const app = await open(); const { detail } = await setup(app);
    const inspected = await rpc<ToolResult>(app, 'tools/call', { name: 'inspect_asset', arguments: { assetId: detail.asset.id, scales: [1, 8] } });
    expect(inspected.isError).not.toBe(true);
    const images = inspected.content.filter(content => content.type === 'image').map(image => PNG.sync.read(Buffer.from(image.data!, 'base64')));
    expect(images.map(png => [png.width, png.height])).toEqual([[8, 8], [64, 64]]);
    expect(inspected.structuredContent).toMatchObject({ scale: 1, imageWidth: 8, images: [{ scale: 1, width: 8, height: 8 }, { scale: 8, width: 64, height: 64 }] });
    const huge = (await app.inject({ method: 'POST', url: '/api/assets', payload: { projectId: detail.asset.projectId, name: 'Huge', type: 'prop', width: 130, height: 130 } })).json<AssetDetail>();
    const rejected = await rpc<ToolResult>(app, 'tools/call', { name: 'inspect_asset', arguments: { assetId: huge.asset.id, scales: [1, 32] } });
    expect(JSON.parse(rejected.content[0].text!)).toMatchObject({ error: { code: 'RENDER_SIZE' } });
  });

  it('creates, inspects as one sheet, reviews, finishes and exports an animation through MCP', async () => {
    const app = await open(); const { project } = await setup(app);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await rpc<ToolResult>(app, 'tools/call', { name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return result;
    };
    const run = (await call('start_run', { projectId: project.id, prompt: 'Two-frame bounce' })).structuredContent as unknown as ArtistRun;
    const created = (await call('create_asset', { projectId: project.id, runId: run.id, name: 'Slime', type: 'character', width: 4, height: 3, frames: [{ id: 'up', durationMs: 150 }, { id: 'down' }], animationTags: [{ name: 'bounce', from: 0, to: 1, direction: 'pingpong' }] })).structuredContent as unknown as AssetDetail;
    expect(created.revision.document).toMatchObject({ frames: [{ id: 'up', durationMs: 150 }, { id: 'down', durationMs: 100 }], tags: [{ name: 'bounce', from: 0, to: 1, direction: 'pingpong', loop: true }] });
    expect(JSON.stringify(created.revision.document)).not.toContain('cels');
    const drawn = (await call('apply_operations', { assetId: created.asset.id, expectedRevision: created.revision.id, requestId: 'slime-up', runId: run.id, editScope: { layerIds: ['body'], frameIds: ['up'] }, operations: [{ op: 'rows', layerId: 'body', x: 0, y: 0, rows: ['.11.', '1221', '1111'] }] })).structuredContent!;
    expect(drawn).toMatchObject({ diff: { changedFrames: ['up'] }, validation: { issues: [{ code: 'EMPTY_FRAME' }] }, frames: [{ id: 'up' }, { id: 'down' }] });
    const squashed = (await call('apply_operations', { assetId: created.asset.id, expectedRevision: drawn.revisionId, requestId: 'slime-down', runId: run.id, editScope: { layerIds: ['body'], frameIds: ['down'] }, operations: [
      { op: 'stamp', layerId: 'body', sourceFrameId: 'up', rect: { x: 0, y: 1, width: 4, height: 2 } },
      { op: 'rows', layerId: 'body', x: 0, y: 0, rows: ['....'] },
    ] })).structuredContent!;
    const frameRead = (await call('read_pixels', { assetId: created.asset.id, frameId: 'down' })).structuredContent!;
    expect(frameRead).toMatchObject({ frameId: 'down', rows: ['....', '1221', '1111'] });

    const partial = await call('inspect_asset', { assetId: created.asset.id, runId: run.id, frameId: 'down', scales: [1] });
    expect(partial.structuredContent).toMatchObject({ imageWidth: 4, imageHeight: 3, view: { layout: 'frame', frameIds: ['down'] } });
    await call('record_review', { runId: run.id, revisionId: squashed.revisionId, observations: 'Only the squashed frame was checked.', issues: [] });
    const blocked = await rpc<ToolResult>(app, 'tools/call', { name: 'finish_run', arguments: { runId: run.id, status: 'completed' } });
    expect(JSON.parse(blocked.content[0].text!)).toMatchObject({ error: { code: 'REVIEW_REQUIRED' } });

    const sheet = await call('inspect_asset', { assetId: created.asset.id, runId: run.id, scales: [1, 4], onion: { before: 1 } });
    const images = sheet.content.filter(content => content.type === 'image').map(image => PNG.sync.read(Buffer.from(image.data!, 'base64')));
    expect(images.map(png => [png.width, png.height])).toEqual([[9, 3], [36, 12]]);
    expect(sheet.structuredContent).toMatchObject({ view: { layout: 'sheet', frameIds: ['up', 'down'], columns: 2, rows: 1, gutter: 1, gutterColor: '#FF00FF', cells: [{ frameId: 'up', x: 0, durationMs: 150 }, { frameId: 'down', x: 5, durationMs: 100 }], onion: { before: 1, after: 0 } } });
    expect([...images[0].data.subarray(4 * 4, 4 * 4 + 4)]).toEqual([255, 0, 255, 255]);
    expect([...images[0].data.subarray(6 * 4, 6 * 4 + 4)]).toEqual([48, 96, 255, 255]);
    await call('record_review', { runId: run.id, revisionId: squashed.revisionId, observations: 'Both frames read as the same slime; the squash keeps the base on the pivot line.', issues: [] });
    expect((await call('finish_run', { runId: run.id, status: 'completed' })).structuredContent).toMatchObject({ status: 'completed', inspectedFrameIds: ['up', 'down'] });

    const filtered = (await call('get_asset', { assetId: created.asset.id, includePixels: true, frameIds: ['down'] })).structuredContent as unknown as AssetDetail;
    expect(filtered.revision.document.frames.map(frame => frame.id)).toEqual(['down']);
    expect(filtered.revision.document.frames[0].cels.body).toEqual([0, 0, 0, 0, 1, 2, 2, 1, 1, 1, 1, 1]);
    const unknown = await rpc<ToolResult>(app, 'tools/call', { name: 'get_asset', arguments: { assetId: created.asset.id, frameIds: ['side'] } });
    expect(JSON.parse(unknown.content[0].text!)).toMatchObject({ error: { code: 'UNKNOWN_FRAME' } });

    const exported = (await call('export_asset', { assetId: created.asset.id, format: 'sheet' })).structuredContent as { files: { path: string; downloadUrl: string }[] };
    expect(exported.files.map(file => file.path.split(/[\\/]/).at(-1))).toEqual([expect.stringMatching(/^Slime-.*\.sheet\.png$/), expect.stringMatching(/^Slime-.*\.sheet\.json$/)]);
    expect(exported.files[1].downloadUrl).toContain('format=sheet-json');
    const png = PNG.sync.read((await app.inject(`/api/assets/${created.asset.id}/export?format=sheet`)).rawPayload);
    expect([png.width, png.height]).toEqual([8, 3]);
    const aseprite = (await app.inject(`/api/assets/${created.asset.id}/export?format=sheet-json&tag=bounce`)).json();
    expect(aseprite).toMatchObject({ frames: [{ frame: { x: 0, y: 0, w: 4, h: 3 }, duration: 150 }, { frame: { x: 4, y: 0, w: 4, h: 3 }, duration: 100 }], meta: { frameTags: [{ name: 'bounce', from: 0, to: 1, direction: 'pingpong' }] } });
    const unity = (await app.inject(`/api/assets/${created.asset.id}/export?format=unity`)).json();
    expect(unity).toMatchObject({ textureImporter: { spriteMode: 'Multiple' }, sprites: [{ name: 'Slime_up' }, { name: 'Slime_down' }], clips: [{ name: 'bounce', direction: 'pingpong' }] });
    const single = PNG.sync.read((await app.inject(`/api/assets/${created.asset.id}/export?format=png&frameId=down`)).rawPayload);
    expect([...single.data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect((await app.inject(`/api/assets/${created.asset.id}/export?format=gifv`)).statusCode).toBe(400);
    expect((await app.inject(`/api/assets/${created.asset.id}/export?format=sheet&tag=missing`)).json()).toMatchObject({ error: { code: 'UNKNOWN_TAG' } });
  });

  it('requires a frame for drawing in animations and rejects a frame layout for several frames', async () => {
    const app = await open(); const { project } = await setup(app);
    const created = (await rpc<ToolResult>(app, 'tools/call', { name: 'create_asset', arguments: { projectId: project.id, name: 'Coin', type: 'item', width: 2, height: 2, frames: [{ id: 'a' }, { id: 'b' }] } })).structuredContent as unknown as AssetDetail;
    const missing = await rpc<ToolResult>(app, 'tools/call', { name: 'apply_operations', arguments: { assetId: created.asset.id, expectedRevision: created.revision.id, requestId: 'no-frame', editScope: { layerIds: ['body'] }, operations: [{ op: 'pixels', layerId: 'body', points: [[0, 0, 1]] }] } });
    expect(JSON.parse(missing.content[0].text!)).toMatchObject({ error: { code: 'FRAME_REQUIRED' } });
    const layout = await rpc<ToolResult>(app, 'tools/call', { name: 'inspect_asset', arguments: { assetId: created.asset.id, layout: 'frame' } });
    expect(JSON.parse(layout.content[0].text!)).toMatchObject({ error: { code: 'INVALID_LAYOUT' } });
  });

  it('returns safe tool errors for malformed input and engine rejection without adding a revision', async () => {
    const app = await open(); const { detail } = await setup(app);
    const malformed = await rpc<ToolResult>(app, 'tools/call', {
      name: 'apply_operations', arguments: { assetId: detail.asset.id, ...paint(detail), operations: [{ op: 'pixels', layerId: 'body', points: [[1, 1, 999]] }] },
    });
    expect(malformed.isError).toBe(true);
    expect(JSON.stringify(malformed)).not.toMatch(/node_modules|\bat [A-Za-z_$]+\s*\(/);
    const rejected = await rpc<ToolResult>(app, 'tools/call', {
      name: 'apply_operations', arguments: { assetId: detail.asset.id, ...paint(detail, 'outside'), operations: [{ op: 'pixels', layerId: 'body', points: [[9, 1, 1]] }] },
    }, 2);
    expect(rejected.isError).toBe(true);
    const message = rejected.content.find(content => content.type === 'text')!.text!;
    expect(JSON.parse(message)).toMatchObject({ error: { code: 'OUT_OF_BOUNDS', status: 400 } });
    expect(message).not.toMatch(/node_modules|engine\.ts|store\.ts/);
    const current = await app.inject({ method: 'GET', url: `/api/assets/${detail.asset.id}` });
    expect(current.json()).toEqual(detail);
    const history = await app.inject({ method: 'GET', url: `/api/assets/${detail.asset.id}/revisions` });
    expect(history.json()).toHaveLength(1);
  });
});

describe('loopback request guards', () => {
  it.each([
    { headers: { host: 'attacker.example' }, code: 'HOST_DENIED' },
    { headers: { origin: 'https://attacker.example' }, code: 'ORIGIN_DENIED' },
    { headers: { origin: 'null' }, code: 'ORIGIN_DENIED' },
  ])('rejects $code before a REST or MCP write', async ({ headers, code }) => {
    const app = await open();
    const rest = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Rejected' } });
    expect(rest.statusCode).toBe(403);
    expect(rest.json()).toMatchObject({ error: { code } });
    const mcp = await app.inject({
      method: 'POST', url: '/mcp', headers: { ...mcpHeaders, ...headers },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_project', arguments: { name: 'Rejected' } } },
    });
    expect(mcp.statusCode).toBe(403);
    expect(mcp.json()).toMatchObject({ error: { code } });
    const stop = await app.inject({ method: 'POST', url: '/api/mcp/stop', headers });
    expect(stop.statusCode).toBe(403);
    expect(stop.json()).toMatchObject({ error: { code } });
    expect((await app.inject('/api/mcp/status')).json()).toMatchObject({ running: true, requests: 0 });
    const projects = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(projects.json()).toEqual([]);
  });
});
