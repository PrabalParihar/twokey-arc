import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@twokey-arc/core';
import { SESSION_COOKIE } from './http';
import { db, ownerReady } from './server';

/** For server components: the signed-in owner, or a redirect to /login. */
export async function pageOwner() {
  await ownerReady();
  const jar = await cookies();
  const s = await getSession(db(), jar.get(SESSION_COOKIE)?.value);
  if (!s) redirect('/login');
  return { user: s.user, csrf: s.csrf };
}
