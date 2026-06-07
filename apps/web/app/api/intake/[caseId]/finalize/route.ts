import { NextResponse } from 'next/server';
import { db, schema } from '@visa-track/db';
import { finalizeCase } from '@/lib/marketplace-api';
import { triggerAgent } from '@/lib/trigger';

export const runtime = 'nodejs';

const DEV_TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

// Persist any client-provided evidence URLs as document records (best-effort;
// silently skipped if the DB/FKs are unavailable in the demo).
async function storeEvidenceUrls(caseId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    await db.insert(schema.documents).values(
      urls.map((url, i) => ({
        tenantId: DEV_TENANT_ID,
        caseId,
        kind: 'exhibit' as const,
        title: `Evidence ${i + 1}`,
        storageKey: url,
        metadata: { source: 'intake', url },
      })),
    );
  } catch (err) {
    console.warn('[finalize] could not store evidence urls:', (err as Error).message);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await ctx.params;
  const c = await finalizeCase(caseId);
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Kick off the evidence-curator agent now that intake is finalized.
  // Best-effort: a no-op in dev when Trigger.dev is not configured.
  void triggerAgent({
    agentType: 'evidence_curator',
    caseId,
    payload: { reason: 'intake_finalized', status: c.status },
  }).catch((err) => console.error('[finalize] evidence_curator trigger failed', err));

  // Optionally persist uploaded evidence URLs from the request body.
  const body = (await req.json().catch(() => ({}))) as { evidenceUrls?: unknown };
  const urls = Array.isArray(body.evidenceUrls)
    ? body.evidenceUrls.filter((u): u is string => typeof u === 'string')
    : [];
  if (urls.length > 0) {
    void storeEvidenceUrls(caseId, urls);
  }

  return NextResponse.json({ ok: true, status: c.status });
}
