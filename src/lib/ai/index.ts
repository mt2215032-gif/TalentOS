import type { z } from 'zod';
import { config } from '@/lib/config';
import { AnthropicProvider } from '@/lib/ai/providers/anthropic';
import { OpenAiProvider } from '@/lib/ai/providers/openai';
import { GeminiProvider } from '@/lib/ai/providers/gemini';
import { HeuristicProvider } from '@/lib/ai/providers/heuristic';
import { TASK_TIER } from '@/lib/ai/models';
import { recordAiUsage } from '@/lib/ai/usage';
import {
  AiError,
  type AIProvider,
  type AiTask,
  type ModelTier,
  type StructuredRequest,
  type StructuredResult,
} from '@/lib/ai/types';

/**
 * Provider selection and the one call site the rest of the platform uses.
 *
 * Responsibilities that belong here rather than in each provider:
 *   - choosing the configured provider, with the offline engine as fallback
 *   - one retry on malformed output, with the validation errors fed back
 *   - degrading to the offline engine when the LLM path is unavailable
 *   - writing every call to the cost ledger, success or failure
 */

let cachedProvider: AIProvider | null = null;
const offlineProvider = new HeuristicProvider();

export function getProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;

  switch (config.ai.provider) {
    case 'anthropic':
      cachedProvider = new AnthropicProvider(config.ai.anthropicApiKey ?? '');
      break;
    case 'openai':
      cachedProvider = new OpenAiProvider(config.ai.openaiApiKey ?? '');
      break;
    case 'gemini':
      cachedProvider = new GeminiProvider(config.ai.geminiApiKey ?? '');
      break;
    default:
      cachedProvider = offlineProvider;
  }
  return cachedProvider;
}

/** Test seam: swap the provider, e.g. for a stubbed LLM in API tests. */
export function setProviderForTesting(provider: AIProvider | null): void {
  cachedProvider = provider;
}

export function getOfflineProvider(): AIProvider {
  return offlineProvider;
}

export interface GenerateOptions<T extends z.ZodType> {
  task: AiTask;
  system: string;
  prompt: string;
  schema: T;
  schemaName: string;
  /** Structured input for the offline engine. Ignored by LLM providers. */
  context?: unknown;
  maxOutputTokens?: number;
  tier?: ModelTier;
  userId?: string;
  interviewId?: string;
  /**
   * When true, an LLM failure falls back to the offline engine instead of
   * throwing. Used for steps where an interrupted interview is worse than a
   * heuristic answer; false where a wrong result would be misleading.
   */
  allowOfflineFallback?: boolean;
}

/**
 * Run one structured AI call.
 *
 * Every AI interaction in the platform goes through this function, which is why
 * cost tracking and error handling are guaranteed rather than remembered.
 */
export async function generate<T extends z.ZodType>(
  options: GenerateOptions<T>,
): Promise<StructuredResult<z.infer<T>>> {
  const provider = getProvider();
  const tier = options.tier ?? TASK_TIER[options.task] ?? 'standard';

  const request: StructuredRequest<T> = {
    task: options.task,
    tier,
    system: options.system,
    prompt: options.prompt,
    schema: options.schema,
    schemaName: options.schemaName,
    context: options.context,
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.userId !== undefined ? { userId: options.userId } : {}),
    ...(options.interviewId !== undefined ? { interviewId: options.interviewId } : {}),
  };

  try {
    return await attempt(provider, request, options);
  } catch (error) {
    const aiError = error instanceof AiError ? error : new AiError('provider_error', 'AI call failed', { cause: error });

    // Degrade rather than strand a candidate mid-interview.
    if (options.allowOfflineFallback !== false && provider.isLlm && options.context !== undefined) {
      try {
        const result = await offlineProvider.generateStructured(request);
        await recordAiUsage({
          task: options.task,
          meta: result.meta,
          ok: true,
          ...(options.userId !== undefined ? { userId: options.userId } : {}),
          ...(options.interviewId !== undefined ? { interviewId: options.interviewId } : {}),
          errorKind: `degraded_from_${aiError.kind}`,
        });
        return result;
      } catch {
        // The offline path failed too; report the original provider error.
      }
    }
    throw aiError;
  }
}

async function attempt<T extends z.ZodType>(
  provider: AIProvider,
  request: StructuredRequest<T>,
  options: GenerateOptions<T>,
): Promise<StructuredResult<z.infer<T>>> {
  try {
    const result = await provider.generateStructured(request);
    await recordAiUsage({
      task: options.task,
      meta: result.meta,
      ok: true,
      ...(options.userId !== undefined ? { userId: options.userId } : {}),
      ...(options.interviewId !== undefined ? { interviewId: options.interviewId } : {}),
    });
    return result;
  } catch (error) {
    const aiError = error instanceof AiError ? error : new AiError('provider_error', 'AI call failed', { cause: error });

    await recordAiUsage({
      task: options.task,
      meta: {
        provider: provider.name,
        model: provider.modelFor(request.tier),
        usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 },
        costUsd: 0,
        latencyMs: 0,
      },
      ok: false,
      errorKind: aiError.kind,
      ...(options.userId !== undefined ? { userId: options.userId } : {}),
      ...(options.interviewId !== undefined ? { interviewId: options.interviewId } : {}),
    });

    // One retry for malformed output, telling the model exactly what failed.
    if (aiError.kind === 'invalid_output') {
      const retryResult = await provider.generateStructured({
        ...request,
        prompt:
          `${request.prompt}\n\n` +
          `Your previous response was rejected: ${aiError.message}\n` +
          `Return only a JSON object that satisfies the schema exactly.`,
      });
      await recordAiUsage({
        task: options.task,
        meta: retryResult.meta,
        ok: true,
        errorKind: 'recovered_after_invalid_output',
        ...(options.userId !== undefined ? { userId: options.userId } : {}),
        ...(options.interviewId !== undefined ? { interviewId: options.interviewId } : {}),
      });
      return retryResult;
    }

    throw aiError;
  }
}

export { AiError } from '@/lib/ai/types';
export type { AIProvider, AiTask, ModelTier } from '@/lib/ai/types';
