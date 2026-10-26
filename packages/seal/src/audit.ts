import { canonicalize, sha256Hex } from './hash';

export type ActorType = 'agent' | 'user' | 'system' | 'circle';

/** One audit entry without its hashes. `data` must be JSON-exact: strings, integers, booleans, null. */
export interface AuditBody {
  seq: number;
  at: string;
  actor_type: ActorType;
  actor_id: string;
  verb: string;
  subject_type: string;
  subject_id: string;
  data: Record<string, unknown>;
}

export interface AuditEntry extends AuditBody {
  prev_hash: string;
  entry_hash: string;
}

export const GENESIS_HASH = `sha256:${'0'.repeat(64)}`;

/** entry_hash = sha256(prev_hash || jcs(entry_without_hashes)). */
export const auditEntryHash = (prevHash: string, body: AuditBody): string =>
  `sha256:${sha256Hex(prevHash + canonicalize(body))}`;

export function chainNext(prev: Pick<AuditEntry, 'seq' | 'entry_hash'> | null, body: Omit<AuditBody, 'seq'>): AuditEntry {
  const seq = prev ? prev.seq + 1 : 1;
  const prev_hash = prev ? prev.entry_hash : GENESIS_HASH;
  const full: AuditBody = { ...body, seq };
  return { ...full, prev_hash, entry_hash: auditEntryHash(prev_hash, full) };
}

export type ChainVerdict =
  | { ok: true; length: number; head: string }
  | { ok: false; length: number; head: string; firstBrokenSeq: number };

/** Recomputes every link. The first entry whose seq, prev_hash or entry_hash doesn't hold is reported. */
export function verifyAuditChain(entries: AuditEntry[]): ChainVerdict {
  let prev = GENESIS_HASH;
  for (const [i, e] of entries.entries()) {
    const { prev_hash, entry_hash, ...body } = e;
    if (e.seq !== i + 1 || prev_hash !== prev || entry_hash !== auditEntryHash(prev, body)) {
      return { ok: false, length: entries.length, head: prev, firstBrokenSeq: e.seq };
    }
    prev = entry_hash;
  }
  return { ok: true, length: entries.length, head: prev };
}
