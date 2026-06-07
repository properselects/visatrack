import { NextResponse } from 'next/server';
import {
  authenticateWithCode,
  isWorkOSConfigured,
  WORKOS_COOKIE_NAME,
} from '@visa-track/auth/workos';

export const runtime = 'nodejs';

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

// WorkOS AuthKit callback. Exchanges the authorization code for a sealed
// session and stores it in an httpOnly cookie. Any failure (missing code,
// WorkOS error, exchange failure) redirects to /login rather than throwing.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/login?err=${encodeURIComponent(errorParam)}`, req.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL('/login?err=missing-code', req.url));
  }

  // WorkOS not configured — fall back to the magic-link dev path.
  if (!isWorkOSConfigured()) {
    return NextResponse.redirect(new URL('/login?err=sso-not-configured', req.url));
  }

  try {
    const { sealedSession } = await authenticateWithCode(code);
    const res = NextResponse.redirect(new URL('/pipeline', req.url));
    res.cookies.set(WORKOS_COOKIE_NAME, sealedSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_S,
    });
    return res;
  } catch (err) {
    console.error('[auth/callback] WorkOS code exchange failed', err);
    return NextResponse.redirect(new URL('/login?err=sso-failed', req.url));
  }
}
