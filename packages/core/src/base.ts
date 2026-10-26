import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '@twokey-arc/db';

export class TwokeyError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string = code,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'TwokeyError';
  }
}

export const newId = (prefix: string): string => `${prefix}_${uuidv7().replaceAll('-', '')}`;
export const newNonce = (): string => randomBytes(16).toString('base64url');

export interface CoreConfig {
  orgId: string;
  network: string;
  chainId: number;
  usdcAddress: string;
  explorerUrl: string;
  defaultFeeEstimateUsdc: string;
  /** Seconds between "approved" and the executor picking it up; a short undo window. 0 in tests. */
  approvalGraceSeconds: number;
  demoMode: boolean;
}

export interface JobOptions {
  startAfterSeconds?: number;
  singletonKey?: string;
}

export type JobName =
  | 'payment.execute'
  | 'attempt.poll'
  | 'attempt.reconcile'
  | 'balance.refresh'
  | 'approval.expire'
  | 'approval.notify'
  | 'webhook.process';

export interface Jobs {
  send(name: JobName, data: Record<string, string>, opts?: JobOptions): Promise<void>;
}

export interface CoreDeps {
  db: Db;
  cfg: CoreConfig;
  jobs: Jobs;
  now?: () => Date;
}

export const nowOf = (deps: { now?: () => Date }): Date => (deps.now ? deps.now() : new Date());

export const explorerTxUrl = (cfg: Pick<CoreConfig, 'explorerUrl'>, txHash: string): string =>
  `${cfg.explorerUrl.replace(/\/$/, '')}/tx/${txHash}`;

/** Drops undefined so JSONB storage and JCS hashing agree byte for byte. */
export const jsonClean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
