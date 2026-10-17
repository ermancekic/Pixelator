import { createInterface } from 'node:readline';

const url = process.env.PIXELATOR_URL ?? 'http://127.0.0.1:4317/mcp';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('PIXELATOR_URL muss lokal sein.');
const input = createInterface({ input: process.stdin });
let protocolVersion = '2025-11-25';
for await (const line of input) {
  if (!line.trim()) continue;
  let parsed: unknown;
  try { parsed = JSON.parse(line); }
  catch { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })}\n`); continue; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('jsonrpc' in parsed) || parsed.jsonrpc !== '2.0' || !('method' in parsed) || typeof parsed.method !== 'string' || ('id' in parsed && parsed.id !== null && typeof parsed.id !== 'string' && typeof parsed.id !== 'number')) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } })}\n`);
    continue;
  }
  const request = parsed as { id?: string | number | null; method: string };
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocolVersion }, body: line, signal: AbortSignal.timeout(30000) });
    if (response.status === 202 || response.status === 204) continue;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const result = JSON.parse(text);
    if (request.method === 'initialize' && result.result?.protocolVersion) protocolVersion = result.result.protocolVersion;
    if (request.id !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (request.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: `Pixelator-Service nicht erreichbar. npm start ausführen. ${error instanceof Error ? error.message : ''}` } })}\n`);
  }
}
