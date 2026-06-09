import { NextResponse } from 'next/server';
import { purchaseAddon, purchaseAddonSchema } from '@/lib/marketplace-api';
import { guardCaseOwner } from '@/lib/auth-guards';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await ctx.params;
  const guard = await guardCaseOwner(caseId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const json = await req.json().catch(() => ({}));
  const parsed = purchaseAddonSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const out = await purchaseAddon(caseId, parsed.data);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
