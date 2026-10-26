import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface InboxEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  /** What the scripted agent "reads" out of the email. Deterministic, for the video. */
  extracted: { payee_id?: string; address?: string; payee_name?: string; amount: string; memo?: string };
  expect: 'executed' | 'pending_approval' | 'blocked';
}

const INBOX = resolve(import.meta.dirname, '../../../fixtures/inbox');

/** Loads fixtures/inbox in order, filling {{BRIGHTLINE}} / {{ATTACKER}} from the demo wallets. */
export function loadInbox(vars: Record<string, string>): InboxEmail[] {
  return readdirSync(INBOX)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      let raw = readFileSync(resolve(INBOX, f), 'utf8');
      for (const [k, v] of Object.entries(vars)) raw = raw.replaceAll(`{{${k}}}`, v);
      return JSON.parse(raw) as InboxEmail;
    });
}
