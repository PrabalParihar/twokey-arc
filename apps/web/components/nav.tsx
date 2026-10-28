'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export function NavLinks({ pending }: { pending: number }) {
  const path = usePathname();
  const view = useSearchParams().get('view');
  const on = (cond: boolean) => `nav-i${cond ? ' on' : ''}`;
  return (
    <>
      <Link className={on(path === '/app' && view !== 'pending')} href="/app" aria-current={path === '/app' && view !== 'pending' ? 'page' : undefined}>
        Inbox
      </Link>
      <Link className={on((path === '/app' && view === 'pending') || path.startsWith('/app/approvals'))} href="/app?view=pending">
        Needs you {pending > 0 && <em aria-label={`${pending} waiting`}>{pending}</em>}
      </Link>
      <Link className={on(path === '/app/mandate')} href="/app/mandate">
        Mandate
      </Link>
      <Link className={on(path === '/app/audit')} href="/app/audit">
        Audit
      </Link>
    </>
  );
}
