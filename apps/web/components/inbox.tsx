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
}

const LANES: { lane: Lane; title: string; empty: string }[] = [
  { lane: 'wait', title: 'Needs you', empty: 'Nothing waiting for your signature' },
  { lane: 'run', title: 'Sending', empty: 'Nothing in flight' },
  { lane: 'paid', title: 'Paid on Arc', empty: 'No payments yet' },
  { lane: 'stopped', title: 'Stopped', empty: 'Nothing stopped' },
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

/** The agent inbox: four lanes, newest first, at most `per` cards each. */
export function Inbox({ items, per = 4 }: { items: InboxItem[]; per?: number }) {
  return (
    <div className="board">
      {LANES.map(({ lane, title, empty }) => {
        const mine = items.filter((i) => i.lane === lane);
        return (
          <div className="lane" key={lane} aria-label={`${title}: ${mine.length}`}>
            <h4>
              {title} <span>{mine.length}</span>
            </h4>
            {mine.length === 0 && <div className="lane-empty">{empty}</div>}
            {mine.slice(0, per).map((i) => {
              const body = (
                <>
                  <div className="t">
                    <span>{i.payee}</span>
                    <span>{i.amount}</span>
                  </div>
                  <p>{i.note}</p>
                  {i.meta && (
                    <div className="m">
                      <span className={`dot ${lane === 'stopped' ? 'block' : lane}`} />
                      {i.meta}
                    </div>
                  )}
                </>
              );
              const cls = `it${lane === 'wait' ? ' hot' : ''}${i.selected ? ' sel' : ''}`;
              return i.href ? (
                <Link key={i.id} className={cls} href={i.href} aria-current={i.selected ? 'true' : undefined}>
                  {body}
                </Link>
              ) : (
                <div key={i.id} className={cls}>
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
