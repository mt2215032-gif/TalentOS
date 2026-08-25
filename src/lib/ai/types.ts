import type { z } from 'zod';

/**
 * Provider-neutral AI contract.
 *
 * Everything above this file — the interview engine, resume analysis, the
 * evaluator — depends only on these types. Swapping Anthropic for OpenAI or
 * Gemini is a configuration change, not a code change.
 */

/**
 * Logical model tiers rather than model names.
 *
 * Callers ask for the capability they need; `src/lib/ai/models.ts` maps the tier
 * onto a concrete model per provider. This is what makes "cheap model for
 * simple tasks, strong model for evaluation" a one-line policy instead of
 * model names scattered through the engine.
 */
export type ModelTier = 'fast' | 'standard' | 'reasoning';

/** The engine steps that spend tokens. Matches ai_usage_events.task. */
export type AiTask =
  | 'resume_analysis'
  | 'job_analysis'
  | 'interview_plan'
  | 'question_generation'
  | 'answer_analysis'
  | 'followup_decision'
  | 'final_evaluation'
  | 'learning_plan';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
}

export interface AiCallMeta {
  provider: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
}

export interface StructuredRequest<T extends z.ZodType> {
  task: AiTask;
  tier: ModelTier;
  /** Stable instructions. Placed first so provider prompt caching can hit. */
  system: string;
  /** The variable part of the prompt. */
  prompt: string;
  schema: T;
  /** Name of the output shape, sent to providers that require one. */
  schemaName: string;
  maxOutputTokens?: number;
  /** Correlation ids for the cost ledger. */
  userId?: string;
  interviewId?: string;
  /**
   * Typed input for the offline heuristic engine.
   *
   * LLM providers ignore this and work from the rendered `prompt`. The
   * heuristic engine cannot parse prose, so callers hand it the same facts in
   * structured form. Keeping it on the request means the engine above has one
   * call site per task regardless of which provider is configured.
   */
  context?: unknown;
}

export interface StructuredResult<T> {
  data: T;
  meta: AiCallMeta;
}

/**
 * Why an AI call failed, in terms the application can act on.
 *
 * `invalid_output` specifically means the provider answered but the response
 * did not satisfy the schema — the engine retries those once with the
 * validation errors fed back, then degrades rather than storing garbage.
 */
export type AiErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'invalid_output'
  | 'refusal'
  | 'provider_error'
  | 'network'
  | 'budget_exceeded'
  | 'unavailable';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;
  readonly provider: string;
  override readonly cause?: unknown;

  constructor(
    kind: AiErrorKind,
    message: string,
    options: { provider?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.provider = options.provider ?? 'unknown';
    this.retryable =
      options.retryable ?? (kind === 'rate_limit' || kind === 'timeout' || kind === 'network');
    this.cause = options.cause;
  }

  /** Message safe to show a candidate — never leaks provider internals. */
  get userMessage(): string {
    switch (this.kind) {
      case 'rate_limit':
        return 'The interview service is busy right now. Please try again in a moment.';
      case 'timeout':
      case 'network':
        return 'The interview service took too long to respond. Please try again.';
      case 'budget_exceeded':
        return 'This interview has reached its processing limit and will now move to evaluation.';
      case 'auth':
      case 'unavailable':
        return 'The interview service is not available right now. Please try again later.';
      default:
        return 'Something went wrong while processing that. Please try again.';
    }
  }
}

/**
 * What every provider must implement.
 *
 * Only structured generation is exposed. The platform never asks a model for
 * free-form prose it then has to parse — every call has a schema, which is what
 * keeps malformed model output out of the database.
 */
export interface AIProvider {
  readonly name: string;
  /** False for the offline engine, which the UI labels explicitly. */
  readonly isLlm: boolean;
  /** Resolve a logical tier to the concrete model this provider will use. */
  modelFor(tier: ModelTier): string;
  generateStructured<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>>;
}
