import { NextResponse } from 'next/server';
import { approveFirm } from '@/lib/marketplace-api';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Fail closed: the 'dev-admin' fallback is allowed ONLY outside production, so
  // an unset ADMIN_TOKEN in prod can't grant admin via a known default.
  const adminToken =
    process.env.ADMIN_TOKEN || (process.env.NODE_ENV !== 'production' ? 'dev-admin' : undefined);
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!adminToken || auth !== adminToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const out = await approveFirm(id);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
