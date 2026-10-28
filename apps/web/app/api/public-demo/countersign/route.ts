import { handle, json } from '@/lib/http';
import { countersign } from '@/lib/public-demo';

/** Public demo: the visitor countersigns the seal they were shown. 409 if the terms moved. */
export function POST(req: Request) {
  return handle(async () => json(await countersign(req, ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>)));
}
