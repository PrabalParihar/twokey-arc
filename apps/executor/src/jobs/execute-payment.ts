import { executePayment, type ExecutorDeps } from '@twokey-arc/core';
import type { Logger } from 'pino';

/**
 * payment.execute. The guard runs in front of Circle in `executePayment` (packages/core/src/executor.ts):
 * under the org lock it re-reads the balance from Circle, classifies a third time, rebuilds and
 * re-verifies the approval seal, and commits the attempt row. Only then is createTransaction called.
 */
export async function handleExecutePayment(deps: ExecutorDeps, log: Logger, intentId: string): Promise<void> {
  const result = await executePayment(deps, intentId);
  log.info({ intentId, result }, 'payment.execute');
}
