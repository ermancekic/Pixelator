import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

it('rejects invalid envelopes without exiting, forwards initialization and wraps HTTP failures in JSON-RPC', async () => {
  const forwarded: { id: number; method: string; protocolVersion: string | undefined }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: number; method: string };
    forwarded.push({ ...input, protocolVersion: request.headers['mcp-protocol-version'] as string | undefined });
    response.setHeader('content-type', 'application/json');
    if (input.method === 'initialize') response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1' } } }));
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
    expect(forwarded.map(request => ({ id: request.id, method: request.method, protocolVersion: request.protocolVersion }))).toEqual([
      { id: 1, method: 'initialize', protocolVersion: '2025-11-25' },
      { id: 2, method: 'tools/list', protocolVersion: '2025-06-18' },
    ]);
  } finally {
    child.kill();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 15000);
