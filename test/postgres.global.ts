import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

/**
 * One Postgres 16 for the whole integration run: TEST_DATABASE_URL if set, otherwise a
 * Testcontainers instance (needs Docker). Each test file creates its own database inside it.
 */
export default async function setup(project: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    project.provide('pgAdminUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  project.provide('pgAdminUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
