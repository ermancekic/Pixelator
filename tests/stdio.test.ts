import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createApp } from '../src/server.js';
import type { McpStatus } from '../src/types.js';

it('rejects invalid envelopes, reconnects expired sessions, wraps HTTP failures and disconnects on exit', async () => {
  const forwarded: { id?: number; method: string; protocolVersion: string | undefined; sessionId: string | undefined }[] = [];
  const disconnected: string[] = []; let initializations = 0; let toolRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'DELETE') { disconnected.push(request.headers['mcp-session-id'] as string); response.end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: number; method: string };
    forwarded.push({ ...input, protocolVersion: request.headers['mcp-protocol-version'] as string | undefined, sessionId: request.headers['mcp-session-id'] as string | undefined });
    response.setHeader('content-type', 'application/json');
    if (input.method === 'initialize') { response.setHeader('mcp-session-id', `session-${++initializations}`); response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1' } } })); }
    else if (input.method === 'notifications/initialized') { response.statusCode = 202; response.end(); }
    else if (++toolRequests === 1) { response.statusCode = 404; response.end('{}'); }
    else { response.statusCode = 503; response.end(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } })); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP server address');
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/stdio.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PIXELATOR_URL: `http://127.0.0.1:${address.port}/mcp` },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const invalid = [null, [], { jsonrpc: '2.0', id: 9 }, { jsonrpc: '1.0', id: 10, method: 'tools/list' }];
  try {
    const exited = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`stdio bridge did not exit: ${stderr}`)); }, 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve(code); });
    });
    child.stdin.end([
      ...invalid,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ].map(message => JSON.stringify(message)).join('\n') + '\n');
    expect(await exited, stderr).toBe(0);
    const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(messages).toHaveLength(invalid.length + 2);
    for (const rejected of messages.slice(0, invalid.length)) expect(rejected).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } });
    expect(messages[invalid.length]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } });
    expect(messages[invalid.length + 1]).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: -32603 } });
    expect(messages[invalid.length + 1].error.message).toContain('HTTP 503');
    expect(forwarded.map(request => ({ id: request.id, method: request.method, protocolVersion: request.protocolVersion, sessionId: request.sessionId }))).toEqual([
      { id: 1, method: 'initialize', protocolVersion: '2025-11-25', sessionId: undefined },
      { id: 2, method: 'tools/list', protocolVersion: '2025-06-18', sessionId: 'session-1' },
      { id: 1, method: 'initialize', protocolVersion: '2025-06-18', sessionId: undefined },
      { id: undefined, method: 'notifications/initialized', protocolVersion: '2025-06-18', sessionId: 'session-2' },
      { id: 2, method: 'tools/list', protocolVersion: '2025-06-18', sessionId: 'session-2' },
    ]);
    expect(disconnected).toEqual(['session-2']);
  } finally {
    child.kill();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 15000);

it('shows a real stdio client as connected and removes its session when stdin closes', async () => {
  const { app } = await createApp({ databasePath: ':memory:' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP');
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/stdio.ts', import.meta.url))], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PIXELATOR_URL: `http://127.0.0.1:${address.port}/mcp` }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  try {
    const initialized = once(lines, 'line', { signal: AbortSignal.timeout(5000) });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } } }) + '\n');
    expect(JSON.parse((await initialized)[0]).result.serverInfo.name).toBe('pixelator');
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.claude).toMatchObject({ connected: true, sessions: 1 });
    const closed = once(child, 'close', { signal: AbortSignal.timeout(5000) });
    child.stdin.end();
    expect((await closed)[0]).toBe(0);
    expect((await app.inject('/api/mcp/status')).json<McpStatus>().agents.claude).toMatchObject({ connected: false, sessions: 0 });
  } finally { lines.close(); child.kill(); await app.close(); }
}, 15000);
