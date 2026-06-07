import { NextResponse } from 'next/server';
import { z } from 'zod';
import { triggerAgent } from '@/lib/trigger';

export const runtime = 'nodejs';

const schema = z.object({
  agentType: z.enum([
    'intake',
    'evidence_curator',
    'expert_letter_drafter',
    'petition_drafter',
    'rfe_responder',
    'qa_reviewer',
  ]),
  caseId: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
  triggeredByUserId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
});

// POST { agentType, caseId, tenantId? } — dispatches an agent run to Trigger.dev.
// Returns 202 (no-op) when TRIGGER_API_KEY is not configured (dev mode).
export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid input', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await triggerAgent(parsed.data);

  if (!result.dispatched) {
    return NextResponse.json(
      {
        ok: true,
        agentRunId: result.agentRunId,
        dispatched: false,
        note: 'Trigger.dev not configured — dispatch skipped (no-op in dev)',
      },
      { status: 202 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
