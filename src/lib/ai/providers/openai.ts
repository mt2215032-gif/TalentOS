import { z } from 'zod';
import { config } from '@/lib/config';
import { OPENAI_MODELS, computeCost } from '@/lib/ai/models';
import { parseAndValidate } from '@/lib/ai/parse';
import {
  AiError,
  type AIProvider,
  type ModelTier,
  type StructuredRequest,
  type StructuredResult,
} from '@/lib/ai/types';

/**
 * OpenAI implementation of {@link AIProvider}, over the Chat Completions API.
 *
 * Uses `response_format: json_schema` with `strict: true` so the same Zod-derived
 * schema constrains the output here as it does on Anthropic.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string };
}

export class OpenAiProvider implements AIProvider {
  readonly name = 'openai';
  readonly isLlm = true;

  constructor(private readonly apiKey: string) {}

  modelFor(tier: ModelTier): string {
    return config.ai.modelOverrides[tier] ?? OPENAI_MODELS[tier].id;
  }

  async generateStructured<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const spec = OPENAI_MODELS[request.tier];
    const model = this.modelFor(request.tier);
    const started = Date.now();
    const jsonSchema = z.toJSONSchema(request.schema, { target: 'draft-7' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          max_completion_tokens: request.maxOutputTokens ?? 8000,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: jsonSchema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiError('timeout', 'The AI provider did not respond in time.', {
          provider: this.name,
          cause: error,
        });
      }
      throw new AiError('network', 'Could not reach the AI provider.', {
        provider: this.name,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    const body = (await response.json().catch(() => ({}))) as OpenAiResponse;

    if (!response.ok) {
      throw httpErrorToAiError(response.status, body.error?.message, this.name);
    }

    const choice = body.choices?.[0];
    if (choice?.message?.refusal) {
      throw new AiError('refusal', 'The model declined to produce this output.', {
        provider: this.name,
        retryable: false,
      });
    }
    if (choice?.finish_reason === 'length') {
      throw new AiError('invalid_output', 'The model response was cut off.', {
        provider: this.name,
        retryable: true,
      });
    }

    const text = choice?.message?.content ?? '';
    if (!text.trim()) {
      throw new AiError('invalid_output', 'The model returned an empty response.', {
        provider: this.name,
        retryable: true,
      });
    }

    const cachedRead = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const usage = {
      // OpenAI reports cached tokens inside prompt_tokens, so uncached input is
      // the difference — counting both would double-bill the ledger.
      inputTokens: Math.max(0, (body.usage?.prompt_tokens ?? 0) - cachedRead),
      outputTokens: body.usage?.completion_tokens ?? 0,
      cachedReadTokens: cachedRead,
      cachedWriteTokens: 0,
    };

    return {
      data: parseAndValidate(request.schema, text, this.name),
      meta: {
        provider: this.name,
        model,
        usage,
        costUsd: computeCost(spec, usage),
        latencyMs: Date.now() - started,
      },
    };
  }
}

/** Shared HTTP status mapping for the fetch-based providers. */
export function httpErrorToAiError(status: number, message: string | undefined, provider: string): AiError {
  if (status === 401 || status === 403) {
    return new AiError('auth', 'The AI provider rejected the configured API key.', {
      provider,
      retryable: false,
    });
  }
  if (status === 429) {
    return new AiError('rate_limit', 'The AI provider rate limit was reached.', { provider });
  }
  if (status >= 500) {
    return new AiError('provider_error', `The AI provider returned an error (${status}).`, {
      provider,
      retryable: true,
    });
  }
  return new AiError(
    'provider_error',
    // The provider's own message can echo prompt content, so it is recorded in
    // the error but never surfaced to the candidate (see AiError.userMessage).
    `The AI provider rejected the request (${status}): ${message ?? 'no detail'}`,
    { provider, retryable: false },
  );
}
