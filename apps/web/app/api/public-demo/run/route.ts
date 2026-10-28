import { handle, json } from '@/lib/http';
import { runAgent } from '@/lib/public-demo';

/** Public demo: the scripted agent sends its three bills to the demo org on Arc Testnet. */
export function POST(req: Request) {
  return handle(async () => json(await runAgent(req), 202));
}
