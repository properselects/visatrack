import { NextResponse } from 'next/server';
import { intakeStart, intakeStartSchema } from '@/lib/marketplace-api';
import { isDemoMode } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = intakeStartSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input', details: parsed.error.issues }, { status: 400 });
  }
  const { magicLink, ...rest } = await intakeStart(parsed.data);
  // Don't leak the magic-link token in production (auth bypass) — demo only.
  return NextResponse.json({ ok: true, ...rest, ...(isDemoMode() ? { magicLink } : {}) });
}
