import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store, AppError } from './store.js';
import { createMcpServer, publicError } from './mcp.js';
import { STYLE_PRESETS } from './engine.js';
import { documentFromPng, framesFor, renderGif, renderPng, renderSheet, renderThumbnail, sheetLayout, sheetManifest, unityManifest, unitySheetManifest } from './images.js';
import { writePalette } from './palette-formats.js';
import { godotTileset, renderTilesetImage, tiledTileset, tiledTilesetXml, tilesetLayout, unityTilesetManifest } from './tileset-export.js';
import * as schema from './contracts.js';
import type { McpAgent, McpStatus } from './types.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function createApp(options: { databasePath?: string; dataDir?: string; port?: number; logger?: boolean } = {}) {
  const dataDir = options.dataDir ?? resolve(process.env.PIXELATOR_DATA_DIR ?? join(root, 'data'));
  const port = options.port ?? 4317;
  const store = new Store(options.databasePath ?? join(dataDir, 'pixelator.sqlite'));
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16 * 1024 * 1024 });
  const clients = new Set<import('node:http').ServerResponse>();
  const mcpStatus: McpStatus = { running: true, endpoint: `http://127.0.0.1:${port}/mcp`, startedAt: new Date().toISOString(), requests: 0, toolCalls: 0, activeRequests: 0, lastRequestAt: null, agents: { claude: { connected: false, sessions: 0, lastSeenAt: null }, codex: { connected: false, sessions: 0, lastSeenAt: null }, antigravity: { connected: false, sessions: 0, lastSeenAt: null } } };
  type McpSession = { mcp: ReturnType<typeof createMcpServer>; transport: NodeStreamableHTTPServerTransport; agent: McpAgent | null; lastSeen: number; activeRequests: number; streams: number; closing: boolean };
  const sessions = new Map<string, McpSession>();
  const broadcastMcpStatus = () => {
    for (const agent of Object.values(mcpStatus.agents)) { agent.connected = false; agent.sessions = 0; }
    for (const session of sessions.values()) {
      if (!session.agent || session.closing) continue;
      const agent = mcpStatus.agents[session.agent];
      agent.connected = true; agent.sessions++;
      const lastSeen = new Date(session.lastSeen).toISOString();
      if (!agent.lastSeenAt || lastSeen > agent.lastSeenAt) agent.lastSeenAt = lastSeen;
    }
    for (const client of clients) client.write(`data: ${JSON.stringify({ type: 'mcp', status: mcpStatus })}\n\n`);
  };
  const expireSessions = async () => {
    // shortcut: clients without an open stream expire after five idle minutes; their next request must reinitialize.
    await Promise.all([...sessions.values()].filter(session => !session.activeRequests && !session.streams && Date.now() - session.lastSeen >= 300_000).map(session => session.mcp.close()));
  };
  const sessionCleanup = setInterval(() => { void expireSessions().catch(error => app.log.error(error)); }, 10_000);
  sessionCleanup.unref();
  app.decorate('pixelatorStore', store);
  app.addHook('onRequest', async (request, reply) => {
    const host = request.hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return reply.code(403).send({ error: { code: 'HOST_DENIED', message: 'Only local access is allowed.' } });
    const origin = request.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
        if (!allowedOrigins.includes(parsed.origin)) throw new Error();
      } catch { return reply.code(403).send({ error: { code: 'ORIGIN_DENIED', message: 'This browser origin is not allowed.' } }); }
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const formatted = publicError(error);
    if (formatted.status === 500) app.log.error(error);
    reply.code(formatted.status).send({ error: { code: formatted.code, message: formatted.message } });
  });
  app.get('/api/health', () => ({ ok: true, name: 'Pixelator', version: '0.1.0', mode: 'external-agent', dataDir }));
  app.get('/api/mcp/status', async (_request, reply) => { await expireSessions(); return reply.header('Cache-Control', 'no-store').send(mcpStatus); });
  app.post('/api/mcp/:action', async (request, reply) => {
    const { action } = z.object({ action: z.enum(['start', 'stop']) }).parse(request.params);
    const running = action === 'start';
    if (running !== mcpStatus.running) {
      mcpStatus.running = running;
      mcpStatus.startedAt = running ? new Date().toISOString() : null;
      if (!running) {
        for (const session of sessions.values()) session.closing = true;
        await Promise.all([...sessions.values()].filter(session => !session.activeRequests).map(session => session.mcp.close()));
      }
      broadcastMcpStatus();
    }
    return reply.header('Cache-Control', 'no-store').send(mcpStatus);
  });
  app.get('/api/presets', () => STYLE_PRESETS);
  app.get('/api/projects', () => store.listProjects());
  app.get('/api/projects/overview', (_request, reply) => reply.header('Cache-Control', 'no-store').send(store.projectOverview()));
  app.post('/api/projects', request => store.createProject(request.body));
  app.patch<{ Params: { id: string } }>('/api/projects/:id', request => store.updateProject(request.params.id, request.body));
  app.delete<{ Params: { id: string } }>('/api/projects/:id', request => store.deleteProject(request.params.id));
  app.get<{ Querystring: { projectId: string; q?: string; type?: string } }>('/api/assets', request => {
    if (!request.query.projectId) throw new AppError('PROJECT_REQUIRED', 'projectId is required.');
    const input = schema.assetSearch.parse(request.query);
    return store.listAssets(input.projectId, input.q, input.type);
  });
  app.post('/api/assets', request => store.createAsset(request.body));
  app.get<{ Params: { id: string } }>('/api/assets/:id', request => store.getAsset(request.params.id));
  app.patch<{ Params: { id: string } }>('/api/assets/:id', request => store.updateAsset(request.params.id, request.body));
  app.delete<{ Params: { id: string } }>('/api/assets/:id', request => store.deleteAsset(request.params.id));
  app.post<{ Params: { id: string } }>('/api/assets/:id/operations', request => store.apply(request.params.id, request.body));
  app.get<{ Params: { id: string }; Querystring: { summary?: string } }>('/api/assets/:id/revisions', request => {
    const { summary } = z.object({ summary: z.enum(['true', 'false']).optional() }).strict().parse(request.query);
    return summary === 'true' ? store.listRevisionSummaries(request.params.id) : store.listRevisions(request.params.id);
  });
  app.get<{ Params: { id: string; revisionId: string } }>('/api/assets/:id/revisions/:revisionId', request => store.getRevision(request.params.id, request.params.revisionId));
  app.post<{ Params: { id: string } }>('/api/assets/:id/restore', request => store.restore(request.params.id, request.body));
  app.post<{ Params: { id: string } }>('/api/assets/:id/variant', request => {
    const body = z.object({ name: z.string().trim().min(1).max(160) }).strict().parse(request.body);
    return store.createVariant(request.params.id, body.name);
  });
  app.get<{ Params: { id: string }; Querystring: { scale?: string; revisionId?: string; frameId?: string } }>('/api/assets/:id/png', (request, reply) => {
    const revision = store.getRevision(request.params.id, request.query.revisionId);
    return reply.type('image/png').header('Cache-Control', 'no-cache').send(renderPng(revision.document, request.query.scale ? Number(request.query.scale) : 1, request.query.frameId));
  });
  app.get<{ Params: { id: string }; Querystring: { revisionId?: string } }>('/api/assets/:id/thumbnail', (request, reply) => {
    const { revisionId } = z.object({ revisionId: z.string().min(1).max(100).optional() }).strict().parse(request.query);
    const revision = store.getRevision(request.params.id, revisionId);
    return reply.type('image/png').header('Cache-Control', 'no-cache').send(renderThumbnail(revision.document));
  });
  app.get<{ Params: { id: string } }>('/api/assets/:id/export', (request, reply) => {
    const query = z.object({
      format: z.enum(['png', 'json', 'unity', 'sheet', 'sheet-json', 'gif', 'gpl', 'hex', 'pal', 'tileset', 'tsj', 'tsx', 'tres']).default('png'), frameId: z.string().min(1).max(100).optional(), tag: z.string().min(1).max(160).optional(),
      columns: z.coerce.number().int().min(1).max(64).optional(), scale: z.coerce.number().int().min(1).max(16).optional(),
      extrude: z.coerce.number().int().min(0).max(4).optional(), spacing: z.coerce.number().int().min(0).max(8).optional(),
      pixelsPerUnit: z.coerce.number().int().min(1).max(4096).optional(),
    }).strict().parse(request.query);
    const { asset, revision } = store.getAsset(request.params.id); const { document } = revision;
    const name = asset.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'asset';
    // scale enlarges PNG, sheet and GIF by nearest neighbor; sheet-json then addresses the enlarged sheet. Unity metadata stays at 1x.
    const scale = query.scale ?? 1;
    const sheet = (sheetScale = scale) => renderSheet(document, { frameIds: framesFor(document, query.tag), columns: query.columns, scale: sheetScale });
    const extension = { png: 'png', json: 'pixelator.json', unity: 'unity.json', sheet: 'sheet.png', 'sheet-json': 'sheet.json', gif: 'gif', gpl: 'gpl', hex: 'hex', pal: 'pal', tileset: 'tileset.png', tsj: 'tsj', tsx: 'tsx', tres: 'tres' }[query.format];
    // Tileset files reference the image by the name the tileset format downloads under, next to them.
    let layout: ReturnType<typeof tilesetLayout> | undefined; const tileImage = `${name}.tileset.png`;
    const tiles = () => layout ??= tilesetLayout(document, { extrude: query.extrude, spacing: query.spacing });
    if (['tileset', 'tsj', 'tsx', 'tres'].includes(query.format)) tiles();
    reply.header('Content-Disposition', `attachment; filename="${name}.${extension}"`);
    if (query.format === 'tileset') return reply.type('image/png').send(renderTilesetImage(document, { extrude: query.extrude, spacing: query.spacing }).png);
    if (query.format === 'tsj') return reply.type('application/json').send(tiledTileset(document, asset.name, tileImage, tiles()));
    if (query.format === 'tsx') return reply.type('application/xml; charset=utf-8').send(tiledTilesetXml(document, asset.name, tileImage, tiles()));
    if (query.format === 'tres') return reply.type('text/plain; charset=utf-8').send(godotTileset(document, tileImage, tiles()));
    if (query.format === 'png') return reply.type('image/png').send(renderPng(document, scale, query.frameId));
    if (query.format === 'sheet') return reply.type('image/png').send(sheet().png);
    if (query.format === 'gif') return reply.type('image/gif').send(renderGif(document, { tag: query.tag, scale }));
    if (query.format === 'gpl' || query.format === 'hex' || query.format === 'pal') return reply.type('text/plain; charset=utf-8').send(writePalette(document.palette, query.format, asset.name));
    if (query.format === 'sheet-json') return reply.type('application/json').send(sheetManifest(asset.name, `${name}.sheet.png`, document, sheetLayout(document, { frameIds: framesFor(document, query.tag), columns: query.columns }), scale));
    if (query.format === 'unity' && document.tileset) return reply.type('application/json').send(unityTilesetManifest(asset.id, revision.id, asset.name, document, tileImage, tiles(), query.pixelsPerUnit));
    if (query.format === 'unity') return reply.type('application/json').send(document.frames.length > 1 ? unitySheetManifest(asset.id, revision.id, asset.name, document, { image: `${name}.sheet.png`, layout: sheetLayout(document, { frameIds: framesFor(document, query.tag), columns: query.columns }) }, query.pixelsPerUnit) : unityManifest(asset.id, revision.id, asset.name, document, query.pixelsPerUnit));
    return reply.type('application/json').send(store.exportAsset(asset.id));
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/export', (request, reply) => reply.type('application/json').header('Content-Disposition', 'attachment; filename="project.pixelator.json"').send(store.exportProject(request.params.id)));
  // shortcut: project imports are capped at 128 MiB; use a streaming container for larger histories.
  app.post('/api/projects/import', { bodyLimit: 128 * 1024 * 1024 }, request => {
    const input = z.object({ project: z.unknown() }).strict().parse(request.body);
    return store.importProject(input.project);
  });
  app.post('/api/import', request => {
    const input = schema.importPngInput.parse(request.body);
    const doc = documentFromPng(input.pngBase64, store.getProject(input.projectId).style, input);
    return store.importDocument({ projectId: input.projectId, name: input.name, type: input.type }, doc);
  });
  app.get('/api/runs', () => store.listRuns());
  app.get('/api/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    reply.raw.write(': pixelator connected\n\n');
    reply.raw.write(`data: ${JSON.stringify({ type: 'mcp', status: mcpStatus })}\n\n`);
    clients.add(reply.raw);
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 25000);
    reply.raw.on('close', () => { clearInterval(heartbeat); clients.delete(reply.raw); });
  });
  store.on('change', event => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`); });
  app.route({ method: ['POST', 'GET', 'DELETE'], url: '/mcp', handler: async (request, reply) => {
    if (!mcpStatus.running && request.method !== 'DELETE') {
      const id = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough().safeParse(request.body);
      return reply.code(503).send({ jsonrpc: '2.0', id: id.success ? id.data.id ?? null : null, error: { code: -32000, message: 'The MCP server is stopped. Start it in Pixelator.' } });
    }
    await expireSessions();
    const sessionId = request.headers['mcp-session-id'];
    if (sessionId !== undefined && typeof sessionId !== 'string') throw new AppError('INVALID_SESSION', 'Invalid MCP session.');
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (sessionId && (!session || session.closing)) return reply.code(404).send({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'MCP session ended. Please reconnect.' } });
    if (!session && request.method !== 'POST') return reply.code(405).header('Allow', 'POST').send({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Without an MCP session, use POST.' } });
    const method = typeof request.body === 'object' && request.body !== null && 'method' in request.body ? request.body.method : undefined;
    if (!session) {
      const mcp = createMcpServer(store, join(dataDir, 'exports'), `http://127.0.0.1:${port}`);
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: method === 'initialize' ? randomUUID : undefined, enableJsonResponse: true, onsessioninitialized: id => { sessions.set(id, created); } });
      const created: McpSession = { mcp, transport, agent: null, lastSeen: Date.now(), activeRequests: 0, streams: 0, closing: false };
      mcp.server.onclose = () => { if (transport.sessionId) { sessions.delete(transport.sessionId); broadcastMcpStatus(); } };
      try { await mcp.connect(transport); } catch (error) { await mcp.close(); throw error; }
      session = created;
    }
    const current = session;
    const post = request.method === 'POST'; const stream = request.method === 'GET';
    current.lastSeen = Date.now();
    if (post) {
      current.activeRequests++; mcpStatus.requests++; mcpStatus.activeRequests++;
      if (method === 'tools/call') mcpStatus.toolCalls++;
      mcpStatus.lastRequestAt = new Date().toISOString();
    }
    if (stream) current.streams++;
    broadcastMcpStatus();
    try {
      reply.hijack();
      await current.transport.handleRequest(request.raw, reply.raw, request.body);
      if (method === 'initialize') {
        const name = current.mcp.server.getClientVersion()?.name.toLowerCase();
        current.agent = name?.includes('antigravity') ? 'antigravity' : name?.includes('claude') ? 'claude' : name?.includes('codex') ? 'codex' : null;
      }
    } finally {
      if (post) { current.activeRequests--; mcpStatus.activeRequests--; }
      if (stream) current.streams--;
      if (!current.transport.sessionId || !current.mcp.server.getClientVersion() || current.closing && !current.activeRequests) await current.mcp.close();
      broadcastMcpStatus();
    }
  } });
  const webDir = join(root, 'dist', 'web');
  if (existsSync(webDir)) await app.register(fastifyStatic, { root: webDir, index: 'index.html' });
  else app.get('/', (_request, reply) => reply.type('text/html').send('<p>Pixelator is running. Run <code>npm run build</code> first to open the editor.</p>'));
  app.addHook('preClose', async () => { clearInterval(sessionCleanup); for (const client of clients) client.end(); clients.clear(); await Promise.all([...sessions.values()].map(session => session.mcp.close())); });
  app.addHook('onClose', async () => { store.close(); });
  return { app, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = z.coerce.number().int().min(1024).max(65535).parse(process.env.PORT ?? 4317);
  const { app } = await createApp({ port, logger: true });
  try { await app.listen({ host: '127.0.0.1', port }); }
  catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
