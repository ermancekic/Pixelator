import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store, AppError } from './store.js';
import { createMcpServer, publicError } from './mcp.js';
import { STYLE_PRESETS } from './engine.js';
import { renderPng, importPng, unityManifest } from './images.js';
import * as schema from './contracts.js';
import type { McpStatus } from './types.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function createApp(options: { databasePath?: string; dataDir?: string; port?: number; logger?: boolean } = {}) {
  const dataDir = options.dataDir ?? resolve(process.env.PIXELATOR_DATA_DIR ?? join(root, 'data'));
  const port = options.port ?? 4317;
  const store = new Store(options.databasePath ?? join(dataDir, 'pixelator.sqlite'));
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16 * 1024 * 1024 });
  const clients = new Set<import('node:http').ServerResponse>();
  const mcpStatus: McpStatus = { running: true, endpoint: `http://127.0.0.1:${port}/mcp`, startedAt: new Date().toISOString(), requests: 0, toolCalls: 0, activeRequests: 0, lastRequestAt: null };
  const broadcastMcpStatus = () => { for (const client of clients) client.write(`data: ${JSON.stringify({ type: 'mcp', status: mcpStatus })}\n\n`); };
  app.decorate('pixelatorStore', store);
  app.addHook('onRequest', async (request, reply) => {
    const host = request.hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return reply.code(403).send({ error: { code: 'HOST_DENIED', message: 'Nur lokaler Zugriff ist erlaubt.' } });
    const origin = request.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
        if (!allowedOrigins.includes(parsed.origin)) throw new Error();
      } catch { return reply.code(403).send({ error: { code: 'ORIGIN_DENIED', message: 'Diese Browserherkunft ist nicht erlaubt.' } }); }
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const formatted = publicError(error);
    if (formatted.status === 500) app.log.error(error);
    reply.code(formatted.status).send({ error: { code: formatted.code, message: formatted.message } });
  });
  app.get('/api/health', () => ({ ok: true, name: 'Pixelator', version: '0.1.0', mode: 'external-agent', dataDir }));
  app.get('/api/mcp/status', (_request, reply) => reply.header('Cache-Control', 'no-store').send(mcpStatus));
  app.post('/api/mcp/:action', (request, reply) => {
    const { action } = z.object({ action: z.enum(['start', 'stop']) }).parse(request.params);
    const running = action === 'start';
    if (running !== mcpStatus.running) {
      mcpStatus.running = running;
      mcpStatus.startedAt = running ? new Date().toISOString() : null;
      broadcastMcpStatus();
    }
    return reply.header('Cache-Control', 'no-store').send(mcpStatus);
  });
  app.get('/api/presets', () => STYLE_PRESETS);
  app.get('/api/projects', () => store.listProjects());
  app.post('/api/projects', request => store.createProject(request.body));
  app.patch<{ Params: { id: string } }>('/api/projects/:id', request => store.updateProject(request.params.id, request.body));
  app.get<{ Querystring: { projectId: string; q?: string; type?: string } }>('/api/assets', request => {
    if (!request.query.projectId) throw new AppError('PROJECT_REQUIRED', 'projectId ist erforderlich.');
    const input = schema.assetSearch.parse(request.query);
    return store.listAssets(input.projectId, input.q, input.type);
  });
  app.post('/api/assets', request => store.createAsset(request.body));
  app.get<{ Params: { id: string } }>('/api/assets/:id', request => store.getAsset(request.params.id));
  app.post<{ Params: { id: string } }>('/api/assets/:id/operations', request => store.apply(request.params.id, request.body));
  app.get<{ Params: { id: string } }>('/api/assets/:id/revisions', request => store.listRevisions(request.params.id));
  app.post<{ Params: { id: string } }>('/api/assets/:id/restore', request => store.restore(request.params.id, request.body));
  app.post<{ Params: { id: string } }>('/api/assets/:id/variant', request => {
    const body = z.object({ name: z.string().trim().min(1).max(160) }).strict().parse(request.body);
    return store.createVariant(request.params.id, body.name);
  });
  app.get<{ Params: { id: string }; Querystring: { scale?: string; revisionId?: string } }>('/api/assets/:id/png', (request, reply) => {
    const revision = store.getRevision(request.params.id, request.query.revisionId);
    return reply.type('image/png').header('Cache-Control', 'no-cache').send(renderPng(revision.document, request.query.scale ? Number(request.query.scale) : 1));
  });
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>('/api/assets/:id/export', (request, reply) => {
    const format = z.enum(['png', 'json', 'unity']).parse(request.query.format ?? 'png');
    const { asset, revision } = store.getAsset(request.params.id);
    const name = asset.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'asset';
    reply.header('Content-Disposition', `attachment; filename="${name}.${format === 'png' ? 'png' : format === 'unity' ? 'unity.json' : 'pixelator.json'}"`);
    return format === 'png' ? reply.type('image/png').send(renderPng(revision.document)) : reply.type('application/json').send(format === 'unity' ? unityManifest(asset.id, revision.id, asset.name, revision.document) : store.exportAsset(asset.id));
  });
  app.get<{ Params: { id: string } }>('/api/projects/:id/export', (request, reply) => reply.type('application/json').header('Content-Disposition', 'attachment; filename="project.pixelator.json"').send(store.exportProject(request.params.id)));
  // shortcut: project imports are capped at 128 MiB; use a streaming container for larger histories.
  app.post('/api/projects/import', { bodyLimit: 128 * 1024 * 1024 }, request => {
    const input = z.object({ project: z.unknown() }).strict().parse(request.body);
    return store.importProject(input.project);
  });
  app.post('/api/import', request => {
    const input = schema.importPngInput.parse(request.body);
    const style = store.getProject(input.projectId).style;
    const doc = importPng(input.pngBase64, style.maxColors, style.paletteLocked);
    if (input.type === 'character') doc.pivot = { x: doc.width / 2, y: doc.height };
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
  app.post('/mcp', async (request, reply) => {
    if (!mcpStatus.running) {
      const id = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough().safeParse(request.body);
      return reply.code(503).send({ jsonrpc: '2.0', id: id.success ? id.data.id ?? null : null, error: { code: -32000, message: 'Der MCP-Server ist gestoppt. Starte ihn in Pixelator.' } });
    }
    const mcp = createMcpServer(store, join(dataDir, 'exports'), `http://127.0.0.1:${port}`);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    mcpStatus.requests++;
    if (typeof request.body === 'object' && request.body !== null && 'method' in request.body && request.body.method === 'tools/call') mcpStatus.toolCalls++;
    mcpStatus.activeRequests++;
    mcpStatus.lastRequestAt = new Date().toISOString();
    broadcastMcpStatus();
    try {
      await mcp.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      try { await mcp.close(); }
      finally { mcpStatus.activeRequests--; broadcastMcpStatus(); }
    }
  });
  app.route({ method: ['GET', 'DELETE'], url: '/mcp', handler: (_request, reply) => reply.code(405).header('Allow', 'POST').send({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Stateless MCP verwendet POST.' } }) });
  const webDir = join(root, 'dist', 'web');
  if (existsSync(webDir)) await app.register(fastifyStatic, { root: webDir, index: 'index.html' });
  else app.get('/', (_request, reply) => reply.type('text/html').send('<p>Pixelator läuft. Bitte zuerst <code>npm run build</code> ausführen, um den Editor zu öffnen.</p>'));
  app.addHook('preClose', async () => { for (const client of clients) client.end(); clients.clear(); });
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
