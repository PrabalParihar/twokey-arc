import { assertNoCircleSecrets } from './lib/boot';

export function register() {
  // Runs once when the server boots, before any route: no Circle credentials in this process.
  assertNoCircleSecrets();
}
