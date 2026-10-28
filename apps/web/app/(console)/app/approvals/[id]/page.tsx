import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { attempts } from '@twokey-arc/db';
import { auditForPayment, getActiveMandate, getApproval } from '@twokey-arc/core';
import { AutoRefresh } from '@/components/client';
import { PaymentDetail } from '@/components/payment-detail';
import { networkName } from '@/lib/format';
import { cfg, db } from '@/lib/server';
import { pageOwner } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { csrf } = await pageOwner();
  const { id } = await params;
  const found = await getApproval(db(), cfg.orgId, id);
  if (!found) notFound();
  const [attempt] = await db().select().from(attempts).where(eq(attempts.intentId, found.intent.id));
  const mandate = await getActiveMandate(db(), cfg.orgId);
  const feed = await auditForPayment(db(), cfg.orgId, found.intent.id);
  return (
    <>
      <AutoRefresh />
      <div className="head">
        <div>
          <h1>Approval</h1>
          <p>
            {id} · decide on these exact terms
          </p>
        </div>
      </div>
      <div style={{ maxWidth: 620 }}>
        <PaymentDetail
          intent={found.intent}
          approval={found.approval}
          attempt={attempt ?? null}
          feed={feed}
          csrf={csrf}
          treasury={mandate?.source_wallet.address ?? null}
          demoMode={cfg.demoMode}
          networkLabel={`${networkName(cfg.network)} (${cfg.chainId})`}
        />
      </div>
    </>
  );
}
