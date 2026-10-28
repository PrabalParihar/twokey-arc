import { handle, json } from '@/lib/http';
import { demoState } from '@/lib/public-demo';

/** Public demo: this visitor's latest run, plus the demo mandate and treasury balance. */
export function GET() {
  return handle(async () => json(await demoState()));
}
