import Link from 'next/link';

export type Lane = 'wait' | 'run' | 'paid' | 'stopped';

export interface InboxItem {
  id: string;
  payee: string;
  amount: string;
  lane: Lane;
  /** One line: why it is in this lane. */
  note: string;
  /** The small grey line under it: who, when, or the Arc tx. */
  meta?: React.ReactNode;
  href?: string;
  selected?: boolean;
  /** An illustration, not a real payment: shown with an "example" tag. */
  example?: boolean;
}

const LANES: { lane: Lane; title: string; icon: string; empty: string }[] = [
  { lane: 'wait', title: 'Needs you', icon: '✋', empty: 'Nothing waiting for your signature' },
  { lane: 'run', title: 'Sending', icon: '↻', empty: 'Nothing in flight' },
  { lane: 'paid', title: 'Paid on Arc', icon: '✓', empty: 'No payments yet' },
  { lane: 'stopped', title: 'Stopped', icon: '⊘', empty: 'Nothing stopped' },
];

/** Which lane a payment sits in. Stopped covers everything that ended without money moving. */
export function laneOf(status: string): Lane {
  switch (status) {
    case 'AWAITING_APPROVAL':
      return 'wait';
    case 'PAID':
      return 'paid';
    case 'QUEUED':
    case 'SUBMITTED':
    case 'UNCONFIRMED':
    case 'RECEIVED':
      return 'run';
    default:
      return 'stopped';
  }
}

/** A stable colour per payee, so the same supplier looks the same everywhere. */
function avatarStyle(name: string): React.CSSProperties {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { background: `hsl(${h} 80% 92%)`, color: `hsl(${h} 55% 32%)` };
}

/** The agent inbox: four lanes, newest first, at most `per` cards each. */
export function Inbox({ items, per = 4, empty }: { items: InboxItem[]; per?: number; empty?: Partial<Record<Lane, React.ReactNode>> }) {
  return (
    <div className="board">
      {LANES.map(({ lane, title, icon, empty: emptyText }, li) => {
        const mine = items.filter((i) => i.lane === lane);
        return (
          <div className={`lane lane-${lane}`} key={lane} aria-label={`${title}: ${mine.filter((i) => !i.example).length}`}>
            <h4>
              <span className="lane-t">
                <i aria-hidden="true">{icon}</i>
                {title}
              </span>
              <span className="lane-n">{mine.filter((i) => !i.example).length}</span>
            </h4>
            {mine.length === 0 && (empty?.[lane] ?? <div className="lane-empty">{emptyText}</div>)}
            {mine.slice(0, per).map((i, n) => {
              const name = i.payee.replace(/^"/, '');
              const body = (
                <>
                  <div className="t">
                    <span className="av-s" style={avatarStyle(name)} aria-hidden="true">
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                    <span>{i.payee}</span>
                    <span>
                      {i.amount}
                      <small> USDC</small>
                    </span>
                  </div>
                  <p>{i.note}</p>
                  <div className="m">
                    <span className={`dot ${lane === 'stopped' ? 'block' : lane}`} />
                    {i.meta}
                    {i.example && <span className="ex">example</span>}
                  </div>
                </>
              );
              const cls = `it${lane === 'wait' ? ' hot' : ''}${i.selected ? ' sel' : ''}`;
              const style = { animationDelay: `${(li * 2 + n) * 70}ms` };
              return i.href ? (
                <Link key={i.id} className={cls} style={style} href={i.href} aria-current={i.selected ? 'true' : undefined}>
                  {body}
                </Link>
              ) : (
                <div key={i.id} className={cls} style={style}>
                  {body}
                </div>
              );
            })}
            {mine.length > per && <div className="lane-empty">+{mine.length - per} more</div>}
          </div>
        );
      })}
    </div>
  );
}
