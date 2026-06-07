// WorkOS client wrapper + sealed-session helpers.
//
// The web app uses WorkOS AuthKit for SSO. On callback we exchange the
// authorization code for a *sealed* session string (an encrypted blob keyed by
// WORKOS_COOKIE_PASSWORD) and store it in an httpOnly cookie. On every request
// the tRPC context unseals + re-authenticates that cookie to resolve the user.
//
// All entry points are guarded by `isWorkOSConfigured()` so the magic-link
// fallback path keeps working in dev where WorkOS env is absent.
import { WorkOS } from '@workos-inc/node';
import type { Role } from './rbac';
import type { Session } from './session';

let cached: WorkOS | null = null;

/** Cookie that holds the sealed WorkOS session. */
export const WORKOS_COOKIE_NAME = 'wos-session';

/** True when the minimum WorkOS env is present to attempt real auth. */
export function isWorkOSConfigured(): boolean {
  return Boolean(process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID);
}

export function getWorkOS(): WorkOS {
  if (cached) return cached;
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!apiKey || !clientId) {
    throw new Error('WORKOS_API_KEY and WORKOS_CLIENT_ID must be set');
  }
  cached = new WorkOS(apiKey, { clientId });
  return cached;
}

function clientId(): string {
  const id = process.env.WORKOS_CLIENT_ID;
  if (!id) throw new Error('WORKOS_CLIENT_ID must be set');
  return id;
}

function cookiePassword(): string {
  const pw = process.env.WORKOS_COOKIE_PASSWORD;
  if (!pw || pw.length < 32) {
    throw new Error('WORKOS_COOKIE_PASSWORD must be set and at least 32 characters');
  }
  return pw;
}

export interface WorkOSAuthResult {
  userId: string;
  email: string;
  organizationId: string | null;
  fullName: string | null;
}

// WorkOS user objects are loosely typed across SDK versions; normalize here.
function toAuthResult(
  user: { id: string; email: string; firstName?: string | null; lastName?: string | null },
  organizationId: string | null,
): WorkOSAuthResult {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    userId: user.id,
    email: user.email,
    organizationId,
    fullName: fullName.length > 0 ? fullName : null,
  };
}

/**
 * Build the AuthKit authorization URL to kick off the SSO redirect flow.
 * Used by a login button / route to send the user to WorkOS.
 */
export function getAuthorizationUrl(opts: { state?: string; organizationId?: string } = {}): string {
  const workos = getWorkOS();
  return workos.userManagement.getAuthorizationUrl({
    clientId: clientId(),
    redirectUri:
      process.env.WORKOS_REDIRECT_URI ?? 'http://localhost:3000/api/auth/callback',
    provider: 'authkit',
    state: opts.state,
    organizationId: opts.organizationId,
  });
}

/** Exchange an authorization code for a sealed session + the authenticated user. */
export async function authenticateWithCode(
  code: string,
): Promise<{ sealedSession: string; user: WorkOSAuthResult }> {
  const workos = getWorkOS();
  const res = await workos.userManagement.authenticateWithCode({
    clientId: clientId(),
    code,
    session: { sealSession: true, cookiePassword: cookiePassword() },
  });
  if (!res.sealedSession) {
    throw new Error('WorkOS did not return a sealed session');
  }
  return {
    sealedSession: res.sealedSession,
    user: toAuthResult(res.user, res.organizationId ?? null),
  };
}

/**
 * Resolve a sealed session cookie back into a user. Attempts a silent refresh
 * when the access token has expired; returns a new sealed session string in
 * that case so the caller can re-set the cookie. Returns null if the session is
 * invalid/expired and cannot be refreshed.
 */
export async function resolveSealedSession(
  sealed: string,
): Promise<{ user: WorkOSAuthResult; sealedSession?: string } | null> {
  const workos = getWorkOS();
  const session = workos.userManagement.loadSealedSession({
    sessionData: sealed,
    cookiePassword: cookiePassword(),
  });

  const auth = await session.authenticate();
  if (auth.authenticated) {
    return { user: toAuthResult(auth.user, auth.organizationId ?? null) };
  }

  const refreshed = await session.refresh().catch(() => null);
  if (refreshed?.authenticated) {
    return {
      user: toAuthResult(refreshed.user, refreshed.organizationId ?? null),
      sealedSession: refreshed.sealedSession ?? undefined,
    };
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map a WorkOS authentication into the app's Session shape. WorkOS org ids look
 * like `org_…`, which are not UUIDs; our tenant columns are UUIDs, so we only
 * adopt the org id as tenantId when it is already a UUID, otherwise fall back to
 * the dev tenant. Role defaults to owner (override via WORKOS_DEFAULT_ROLE).
 */
export function workosToSession(auth: WorkOSAuthResult): Session {
  const orgIsUuid = auth.organizationId ? UUID_RE.test(auth.organizationId) : false;
  const tenantId =
    (orgIsUuid ? auth.organizationId! : undefined) ??
    process.env.DEV_TENANT_ID ??
    '00000000-0000-0000-0000-000000000001';
  const role = (process.env.WORKOS_DEFAULT_ROLE as Role | undefined) ?? 'owner';
  return {
    userId: auth.userId,
    tenantId,
    email: auth.email,
    fullName: auth.fullName,
    role,
  };
}
