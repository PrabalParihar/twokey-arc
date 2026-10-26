'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export function NavLinks({ pending }: { pending: number }) {
  const path = usePathname();
  const view = useSearchParams().get('view');
  const on = (cond: boolean) => `nav-i${cond ? ' on' : ''}`;
  return (
    <>
      <Link className={on(path === '/' && view !== 'pending')} href="/" aria-current={path === '/' && view !== 'pending' ? 'page' : undefined}>
        Today
      </Link>
      <Link className={on((path === '/' && view === 'pending') || path.startsWith('/approvals'))} href="/?view=pending">
        Needs you {pending > 0 && <em aria-label={`${pending} waiting`}>{pending}</em>}
      </Link>
      <Link className={on(path === '/mandate')} href="/mandate">
        Mandate
      </Link>
      <Link className={on(path === '/audit')} href="/audit">
        Audit
      </Link>
    </>
  );
}
