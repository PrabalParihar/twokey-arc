import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Non-secret: Circle wallet ids and Arc Testnet addresses created by circle-setup. */
export interface WalletsFile {
  network: 'ARC-TESTNET';
  walletSetId: string;
  createdAt: string;
  treasury: { id: string; address: string };
  payees: { oceanic: { id: string; address: string }; harbor: { id: string; address: string }; brightline: { id: string; address: string } };
}

export const WALLETS_PATH = process.env.TWOKEY_WALLETS_FILE ?? resolve(import.meta.dirname, '../../config/wallets.arc-testnet.json');
export const readWallets = (): WalletsFile | null => (existsSync(WALLETS_PATH) ? (JSON.parse(readFileSync(WALLETS_PATH, 'utf8')) as WalletsFile) : null);
export const writeWallets = (w: WalletsFile) => writeFileSync(WALLETS_PATH, `${JSON.stringify(w, null, 2)}\n`);

/** The injected "our wallet changed" address in the demo. Not a Circle wallet; it never receives anything. */
export const ATTACKER_ADDRESS = '0xD15ea5E000000000000000000000000000000BAD';
