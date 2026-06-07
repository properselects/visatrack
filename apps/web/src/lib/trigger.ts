// Dispatch agent runs to the Trigger.dev `run-agent` task.
//
// Records an `agent_runs` row (best-effort — works without a reachable DB) and
// then POSTs to Trigger.dev's REST API. Guarded by TRIGGER_API_KEY: when it is
// absent (e.g. local dev) the dispatch is a logged no-op so callers can wire
// triggers into request flows without breaking them.
import { randomUUID } from 'node:crypto';
import { db, eq, schema } from '@visa-track/db';

const { agentRuns } = schema;

export type AgentType =
  | 'intake'
  | 'evidence_curator'
  | 'expert_letter_drafter'
  | 'petition_drafter'
  | 'rfe_responder'
  | 'qa_reviewer';

const DEV_TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

export interface TriggerAgentInput {
  agentType: AgentType;
  caseId: string;
  tenantId?: string;
  triggeredByUserId?: string;
  payload?: Record<string, unknown>;
}

export interface TriggerAgentResult {
  agentRunId: string;
  triggerJobId: string | null;
  dispatched: boolean;
}

async function dispatchToTriggerDev(
  payload: {
    agentRunId: string;
    tenantId: string;
    caseId: string;
    agent: AgentType;
    triggeredByUserId?: string;
    payload: Record<string, unknown>;
  },
  apiKey: string,
): Promise<string | null> {
  const apiUrl = process.env.TRIGGER_API_URL ?? 'https://api.trigger.dev';
  try {
    const res = await fetch(`${apiUrl}/api/v1/tasks/run-agent/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[trigger] dispatch failed', res.status, text);
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return data.id ?? null;
  } catch (err) {
    console.error('[trigger] dispatch error', err);
    return null;
  }
}

export async function triggerAgent(input: TriggerAgentInput): Promise<TriggerAgentResult> {
  const tenantId = input.tenantId ?? DEV_TENANT_ID;
  // Existing tRPC path uses TRIGGER_SECRET_KEY; accept either name.
  const apiKey = process.env.TRIGGER_API_KEY ?? process.env.TRIGGER_SECRET_KEY;

  // Persist an agent run row when the DB is reachable; otherwise fall back to a
  // random id so the dispatch payload is still valid.
  let agentRunId: string = randomUUID();
  try {
    const [run] = await db
      .insert(agentRuns)
      .values({
        tenantId,
        caseId: input.caseId,
        agent: input.agentType,
        status: 'queued',
        triggeredByUserId: input.triggeredByUserId,
        input: (input.payload ?? {}) as Record<string, unknown>,
      })
      .returning({ id: agentRuns.id });
    if (run?.id) agentRunId = run.id;
  } catch (err) {
    console.warn('[trigger] could not persist agent run (continuing):', (err as Error).message);
  }

  if (!apiKey) {
    console.log(
      `[trigger] TRIGGER_API_KEY not set — skipping dispatch of ${input.agentType} for case ${input.caseId}`,
    );
    return { agentRunId, triggerJobId: null, dispatched: false };
  }

  const triggerJobId = await dispatchToTriggerDev(
    {
      agentRunId,
      tenantId,
      caseId: input.caseId,
      agent: input.agentType,
      triggeredByUserId: input.triggeredByUserId,
      payload: input.payload ?? {},
    },
    apiKey,
  );

  if (triggerJobId) {
    try {
      await db
        .update(agentRuns)
        .set({ triggerJobId, updatedAt: new Date() })
        .where(eq(agentRuns.id, agentRunId));
    } catch (err) {
      console.warn('[trigger] could not store triggerJobId:', (err as Error).message);
    }
  }

  return { agentRunId, triggerJobId, dispatched: triggerJobId !== null };
}
