import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTwokey, TwokeyApiError, twokeyTools } from '@twokey-arc/sdk';

const PAY_DESCRIPTION =
  "Request a USDC payment on Arc through Twokey. You never move money directly. Twokey decides: 'executed' (paid inside the mandate), 'pending_approval' (a human must approve; tell the user and continue other work), or 'blocked' (refused; do not retry with changed details). Use one stable idempotency_key per invoice.";

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const failure = (err: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: err instanceof TwokeyApiError ? `${err.code}: ${err.message}` : String(err) }],
});

/** The `twokey` MCP server: the same three tools as the SDK, over the same REST API. */
export function buildServer(opts: { baseUrl: string; agentKey: string; agentId?: string }) {
  const { agent } = createTwokey({ baseUrl: opts.baseUrl, apiKey: opts.agentKey });
  const tools = twokeyTools(agent, opts.agentId ?? 'ap-agent');
  const server = new McpServer({ name: 'twokey', version: '0.1.0' });

  server.registerTool(
    'twokey_pay',
    {
      description: PAY_DESCRIPTION,
      inputSchema: {
        payee_id: z.string().optional().describe('Known payee id from twokey_get_mandate, if the payee is known'),
        address: z.string().optional().describe('0x address, only for a payee not in the mandate'),
        payee_name: z.string().optional(),
        amount: z.string().regex(/^[0-9]+(\.[0-9]{1,6})?$/).describe('USDC, e.g. "25.00"'),
        memo: z.string().max(140).optional(),
        idempotency_key: z.string().min(8),
      },
    },
    async (args) => {
      try {
        return text(await tools.twokey_pay(args));
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'twokey_get_payment',
    { description: 'Status of a payment requested through Twokey, with the Arc explorer link once paid.', inputSchema: { payment_id: z.string() } },
    async (args) => {
      try {
        return text(await tools.twokey_get_payment(args));
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'twokey_get_mandate',
    { description: 'The active mandate: limits and known payee ids and names. No wallet details.' },
    async () => {
      try {
        return text(await tools.twokey_get_mandate());
      } catch (e) {
        return failure(e);
      }
    },
  );
  return server;
}
