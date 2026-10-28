import { handle, json } from '@/lib/http';
import { drift } from '@/lib/public-demo';

/** Public demo: the agent changes the amount by one cent; a held or signed approval voids. */
export function POST(req: Request) {
  return handle(async () => json(await drift(req, ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>)));
}
