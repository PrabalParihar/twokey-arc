import { handle, json } from '@/lib/http';
import { refuse } from '@/lib/public-demo';

/** Public demo: the visitor refuses the payment; nothing is sent. */
export function POST(req: Request) {
  return handle(async () => json(await refuse(req, ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>)));
}
