import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import type { Session } from '@visa-track/auth';
import {
  isWorkOSConfigured,
  resolveSealedSession,
  workosToSession,
  WORKOS_COOKIE_NAME,
} from '@visa-track/auth/workos';
import { db, type DB } from '@visa-track/db';

export interface TRPCContext {
  session: Session | null;
  req: Request;
  db: DB;
}

const DEV_TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
const DEV_USER_ID = process.env.DEV_USER_ID ?? '00000000-0000-0000-0000-000000000002';

function devSession(): Session {
  return {
    userId: DEV_USER_ID,
    tenantId: DEV_TENANT_ID,
    email: 'dev@visa-track.local',
    fullName: 'Dev User',
    role: 'owner',
  };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export async function createContext({ req }: FetchCreateContextFnOptions): Promise<TRPCContext> {
  // 1. Real WorkOS session resolution: unseal the cookie and re-authenticate.
  if (isWorkOSConfigured()) {
    const sealed = readCookie(req, WORKOS_COOKIE_NAME);
    if (sealed) {
      try {
        const resolved = await resolveSealedSession(sealed);
        if (resolved) {
          return { session: workosToSession(resolved.user), req, db };
        }
      } catch (err) {
        // Mock/placeholder keys or an expired cookie land here — fall through to
        // the dev fallback below rather than failing the request.
        console.error('[trpc.context] WorkOS session resolution failed', err);
      }
    }
  }

  // 2. Dev/preview fallback — keeps the magic-link + console demo working when
  //    WorkOS is absent (or configured with placeholder keys in dev).
  const allowDev = process.env.NODE_ENV !== 'production';
  return { session: allowDev ? devSession() : null, req, db };
}
