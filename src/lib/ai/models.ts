import type { ModelTier } from '@/lib/ai/types';

/**
 * Model catalogue and pricing.
 *
 * Cost control starts here: each task asks for a tier, and cheap tiers are
 * routed to small models. Prices are USD per million tokens and are used to
 * compute the per-interview cost recorded in ai_usage_events.
 */

export interface ModelSpec {
  id: string;
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cache reads bill at a fraction of the input rate on providers that support it. */
  cachedReadMultiplier: number;
  cachedWriteMultiplier: number;
  contextWindow: number;
}

/**
 * Anthropic catalogue. Verified against the Claude API model reference;
 * `claude-opus-5` is the default for the tasks that decide a candidate's score.
 */
export const ANTHROPIC_MODELS: Record<ModelTier, ModelSpec> = {
  reasoning: {
    id: 'claude-opus-5',
    inputPerMTok: 5,
    outputPerMTok: 25,
    cachedReadMultiplier: 0.1,
    cachedWriteMultiplier: 1.25,
    contextWindow: 1_000_000,
  },
  standard: {
    id: 'claude-sonnet-5',
    inputPerMTok: 2,
    outputPerMTok: 10,
    cachedReadMultiplier: 0.1,
    cachedWriteMultiplier: 1.25,
    contextWindow: 1_000_000,
  },
  fast: {
    id: 'claude-haiku-4-5',
    inputPerMTok: 1,
    outputPerMTok: 5,
    cachedReadMultiplier: 0.1,
    cachedWriteMultiplier: 1.25,
    contextWindow: 200_000,
  },
};

export const OPENAI_MODELS: Record<ModelTier, ModelSpec> = {
  reasoning: {
    id: 'gpt-5',
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    cachedReadMultiplier: 0.1,
    cachedWriteMultiplier: 1,
    contextWindow: 400_000,
  },
  standard: {
    id: 'gpt-5-mini',
    inputPerMTok: 0.25,
    outputPerMTok: 2,
    cachedReadMultiplier: 0.1,
    cachedWriteMultiplier: 1,
    contextWindow: 400_000,
  },
  fast: {
    id: 'gpt-5-nano',
    inputPerMTok: 0.05,
    outputPerMTok: 0.4,
    cachedReadMultiplier: 0.1,
    cachedWriteMultiplier: 1,
    contextWindow: 400_000,
  },
};

export const GEMINI_MODELS: Record<ModelTier, ModelSpec> = {
  reasoning: {
    id: 'gemini-2.5-pro',
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    cachedReadMultiplier: 0.25,
    cachedWriteMultiplier: 1,
    contextWindow: 1_048_576,
  },
  standard: {
    id: 'gemini-2.5-flash',
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    cachedReadMultiplier: 0.25,
    cachedWriteMultiplier: 1,
    contextWindow: 1_048_576,
  },
  fast: {
    id: 'gemini-2.5-flash-lite',
    inputPerMTok: 0.1,
    outputPerMTok: 0.4,
    cachedReadMultiplier: 0.25,
    cachedWriteMultiplier: 1,
    contextWindow: 1_048_576,
  },
};

/**
 * Which tier each engine task runs at.
 *
 * The rule: anything that produces a number a candidate is judged on runs on
 * the reasoning tier. Extraction and routine generation run cheaper.
 */
export const TASK_TIER: Record<string, ModelTier> = {
  resume_analysis: 'standard',
  job_analysis: 'standard',
  interview_plan: 'standard',
  question_generation: 'standard',
  answer_analysis: 'standard',
  followup_decision: 'fast',
  final_evaluation: 'reasoning',
  learning_plan: 'standard',
};

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

/** USD cost of a single call, rounded to the ledger's six decimal places. */
export function computeCost(spec: ModelSpec, usage: CostInput): number {
  const million = 1_000_000;
  const cost =
    (usage.inputTokens / million) * spec.inputPerMTok +
    (usage.outputTokens / million) * spec.outputPerMTok +
    ((usage.cachedReadTokens ?? 0) / million) * spec.inputPerMTok * spec.cachedReadMultiplier +
    ((usage.cachedWriteTokens ?? 0) / million) * spec.inputPerMTok * spec.cachedWriteMultiplier;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
