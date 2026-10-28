import Link from 'next/link';

export type DayKind = 'auto' | 'signed' | 'wait' | 'stopped' | 'void';

export interface DayItem {
  id: string;
  at: Date;
  payee: string;
  amount: string;
  kind: DayKind;
  sub: string;
  href?: string;
}

/** Where a payment sits on the day: ran on the mandate, went through your key, or stopped before Circle. */
export function dayKind(status: string, approved: boolean): DayKind {
  switch (status) {
    case 'AWAITING_APPROVAL':
      return 'wait';
    case 'VOIDED':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'void';
    case 'BLOCKED':
    case 'REJECTED':
    case 'FAILED':
    case 'NEEDS_HUMAN':
      return 'stopped';
    default:
      return approved ? 'signed' : 'auto';
  }
}

const HOUR = 3_600_000;
const IST = 19_800_000; // the owner reads times in IST, so hour slots start on IST hours
const SLOTS = 8;
const WIDTH = 20; // a block's width, % of the track
const LANES: { kinds: DayKind[]; name: string; sub: string; icon: string; bg: string }[] = [
  { kinds: ['auto'], name: 'Mandate', sub: 'paid on its own', icon: '✓', bg: 'var(--lime)' },
  { kinds: ['signed', 'wait'], name: 'Your key', sub: 'countersigned', icon: '✍', bg: 'var(--amber-l)' },
  { kinds: ['stopped', 'void'], name: 'Stopped', sub: 'before Circle', icon: '✕', bg: 'var(--red-l)' },
];
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * The last eight hours as three lanes. Payments close together in one lane collapse into the latest,
 * with a count, so a busy demo minute stays readable.
 */
export function AgentDay({ items, now }: { items: DayItem[]; now: Date }) {
  const endShift = Math.ceil((now.getTime() + IST) / HOUR) * HOUR;
  const start = endShift - SLOTS * HOUR - IST;
  const span = SLOTS * HOUR;
  const pos = (d: Date) => ((d.getTime() - start) / span) * 100;
  const inView = items.filter((i) => i.at.getTime() >= start && i.at.getTime() <= now.getTime());

  return (
    <div className="day">
      <div className="day-lanes" aria-hidden="true">
        <span />
        {LANES.map((l) => (
          <div className="day-lane" key={l.name}>
            <i style={{ background: l.bg }}>{l.icon}</i>
            <span>
              {l.name}
              <small>{l.sub}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="day-track">
        <div className="day-hours">
          {Array.from({ length: SLOTS }, (_, i) => {
            const slot = endShift - (SLOTS - i) * HOUR;
            const isNow = i === SLOTS - 1;
            return (
              <span key={i} className={isNow ? 'now' : ''}>
                {isNow ? hhmm(now.getTime() + IST) : hhmm(slot)}
              </span>
            );
          })}
        </div>
        {LANES.map((l) => {
          const lane = inView.filter((i) => l.kinds.includes(i.kind)).sort((a, b) => a.at.getTime() - b.at.getTime());
          // Group by proximity: a new group starts once a block would no longer overlap the group's first.
          const groups: DayItem[][] = [];
          for (const it of lane) {
            const g = groups[groups.length - 1];
            if (g && pos(it.at) - pos(g[0]!.at) < WIDTH * 0.8) g.push(it);
            else groups.push([it]);
          }
          return (
            <div className="day-row" key={l.name} aria-label={`${l.name}: ${lane.length}`}>
              {groups.map((g) => {
                const it = g.some((x) => x.kind === 'wait') ? g.find((x) => x.kind === 'wait')! : g[g.length - 1]!;
                const left = Math.min(100 - WIDTH, Math.max(0, pos(g[0]!.at)));
                const body = (
                  <>
                    {it.payee} {it.amount}
                    <small>
                      {g.length > 1 ? `+${g.length - 1} more · ` : ''}
                      {it.sub}
                    </small>
                  </>
                );
                const style = { left: `${left}%`, width: `${WIDTH}%` };
                return it.href ? (
                  <Link key={it.id} className={`blk ${it.kind}`} style={style} href={it.href} title={`${it.payee} ${it.amount} · ${it.sub}`}>
                    {body}
                  </Link>
                ) : (
                  <div key={it.id} className={`blk ${it.kind}`} style={style} title={`${it.payee} ${it.amount} · ${it.sub}`}>
                    {body}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="day-now" style={{ left: `calc(${pos(now)}% - 1px)` }} />
        {inView.length === 0 && <div className="day-empty">Nothing yet in the last eight hours.</div>}
      </div>
    </div>
  );
}
