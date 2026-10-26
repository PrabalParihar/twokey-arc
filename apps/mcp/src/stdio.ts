#!/usr/bin/env -S npx tsx
// Local MCP (Claude Code, Cursor): TWOKEY_URL + TWOKEY_AGENT_KEY in the environment.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server';

const baseUrl = process.env.TWOKEY_URL;
const agentKey = process.env.TWOKEY_AGENT_KEY;
if (!baseUrl || !agentKey) throw new Error('TWOKEY_URL and TWOKEY_AGENT_KEY are required');
await buildServer({ baseUrl, agentKey }).connect(new StdioServerTransport());
