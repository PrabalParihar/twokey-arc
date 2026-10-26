import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const GET = () => json({ ok: true, service: 'web' });
