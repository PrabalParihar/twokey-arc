/** apps/web never holds Circle credentials. If either is present, the web process refuses to start. */
export const FORBIDDEN_IN_WEB = ['CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET', 'CIRCLE_LIVE_API_KEY', 'CIRCLE_LIVE_ENTITY_SECRET'] as const;

export function assertNoCircleSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const present = FORBIDDEN_IN_WEB.filter((k) => env[k]);
  if (present.length) {
    throw new Error(`apps/web must not hold Circle credentials; found ${present.join(', ')}. They belong to apps/executor only.`);
  }
}
