import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueMagicLink } from '@/lib/marketplace-api';
import { isDemoMode } from '@/lib/session';

export const runtime = 'nodejs';

// 'admin' is intentionally NOT accepted here — admin sessions must not be
// mintable via this public endpoint.
const schema = z.object({
  email: z.string().email(),
  role: z.enum(['artist', 'firm']),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input', details: parsed.error.issues }, { status: 400 });
  }
  const url = await issueMagicLink({ email: parsed.data.email, role: parsed.data.role });
  // The link contains a consumable session token. Returning it in the response
  // would let anyone mint a session for any email without inbox access — an auth
  // bypass. Only expose it in demo mode (no real email delivery); in production
  // it is delivered solely via email.
  return NextResponse.json({ ok: true, ...(isDemoMode() ? { magicLink: url } : {}) });
}
