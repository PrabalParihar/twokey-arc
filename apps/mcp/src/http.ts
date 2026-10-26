// Remote MCP over Streamable HTTP. Stateless: each POST /mcp builds a server for the caller's own
// agent key (Authorization: Bearer tk_agent_…), so this process holds no credentials of its own.
import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server';

const baseUrl = process.env.TWOKEY_URL ?? 'http://localhost:3000';
const port = Number(process.env.PORT ?? 8090);

createServer(async (req, res) => {
  if (req.url === '/healthz') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"service":"mcp"}');
  if (req.url !== '/mcp' || req.method !== 'POST') return void res.writeHead(405).end();
  const key = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!key?.startsWith('tk_agent_')) return void res.writeHead(401).end('agent key required');
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const server = buildServer({ baseUrl, agentKey: key });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}).listen(port, () => console.log(`twokey MCP on :${port}/mcp`));
