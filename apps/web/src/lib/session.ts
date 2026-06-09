// Lightweight cookie-based session for the marketplace MVP.
// Stores a JSON blob signed-by-trust (not cryptographically — demo only).
// Two roles: artist (linked to artistAccounts row) and firm (linked to firmProfiles row).
import { cookies } from 'next/headers';

export type Session =
  | { kind: 'artist'; artistId: string; email: string }
  | { kind: 'firm'; firmId: string; email: string };

const COOKIE = 'vt_session';
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

// Demo mode (Track A): non-production. Gates demo-only affordances such as
// returning a magic-link token directly in an API response (so the clickthrough
// demo works without real email delivery). MUST be false in production, where
// leaking the token would be an auth bypass.
export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const raw = c.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as Session;
  } catch {
    return null;
  }
}

export async function setSession(s: Session) {
  const c = await cookies();
  c.set(COOKIE, encodeURIComponent(JSON.stringify(s)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export async function clearSession() {
  const c = await cookies();
  c.delete(COOKIE);
}

export function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
