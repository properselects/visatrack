// Authorization guards for case-scoped API routes. These close the IDOR where
// anyone could mutate/read any case by ID. In production a session is required
// and ownership is enforced; in demo mode (non-prod) anonymous clickthrough is
// allowed so the Track-A pilot demo keeps working without forced login.
import { getSession } from './session';
import { store } from './store';

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

// May the caller MUTATE this case (purchase audit/addon, list it)?
// Logged-in artists may act only on their own cases.
export async function guardCaseOwner(caseId: string): Promise<GuardResult> {
  const session = await getSession();
  if (session?.kind === 'artist') {
    const c = await store.getCase(caseId);
    if (!c) return { ok: false, status: 404, error: 'case not found' };
    if (c.artistId !== session.artistId) return { ok: false, status: 403, error: 'forbidden' };
    return { ok: true };
  }
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, status: 401, error: 'login required' };
  }
  return { ok: true }; // demo clickthrough (non-prod only)
}

// May the caller VIEW this case's documents? The owning artist, or a firm that
// has a claim on the case.
export async function guardCaseViewer(caseId: string): Promise<GuardResult> {
  const session = await getSession();
  if (session?.kind === 'artist') {
    const c = await store.getCase(caseId);
    if (c && c.artistId === session.artistId) return { ok: true };
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if (session?.kind === 'firm') {
    const claims = await store.listClaimsForCase(caseId);
    if (claims.some((cl) => cl.firmId === session.firmId)) return { ok: true };
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, status: 401, error: 'login required' };
  }
  return { ok: true }; // demo clickthrough (non-prod only)
}
