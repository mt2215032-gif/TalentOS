import { query, queryOne } from '@/lib/db/client';
import type { AiCallMeta, AiTask } from '@/lib/ai/types';
import { config } from '@/lib/config';

/**
 * The AI cost ledger.
 *
 * Every call — successful, failed or degraded — is recorded here. That makes
 * "cost per interview" a query rather than an estimate, and gives the admin
 * dashboard a real error rate.
 */

export interface RecordUsageInput {
  task: AiTask;
  meta: AiCallMeta;
  ok: boolean;
  errorKind?: string;
  userId?: string;
  interviewId?: string;
}

export async function recordAiUsage(input: RecordUsageInput): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_usage_events
         (user_id, interview_id, task, provider, model,
          input_tokens, output_tokens, cached_read_tokens, cached_write_tokens,
          cost_usd, latency_ms, ok, error_kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.userId ?? null,
        input.interviewId ?? null,
        input.task,
        input.meta.provider,
        input.meta.model,
        input.meta.usage.inputTokens,
        input.meta.usage.outputTokens,
        input.meta.usage.cachedReadTokens,
        input.meta.usage.cachedWriteTokens,
        input.meta.costUsd,
        input.meta.latencyMs,
        input.ok,
        input.errorKind ?? null,
      ],
    );
  } catch (error) {
    // Losing a ledger row must never fail the interview the user is sitting in.
    console.error('[ai] failed to record usage', error instanceof Error ? error.message : error);
  }
}

/** Total spend on one interview so far, in USD. */
export async function interviewCostUsd(interviewId: string): Promise<number> {
  const row = await queryOne<{ total: string | null }>(
    'SELECT sum(cost_usd)::text AS total FROM ai_usage_events WHERE interview_id = $1',
    [interviewId],
  );
  return row?.total ? Number.parseFloat(row.total) : 0;
}

/**
 * Whether an interview has spent its budget.
 *
 * The engine checks this before generating another question; over budget it
 * stops asking and moves to evaluation rather than silently running up cost.
 */
export async function isOverBudget(interviewId: string): Promise<boolean> {
  const spent = await interviewCostUsd(interviewId);
  return spent >= config.ai.maxCostPerInterviewUsd;
}
