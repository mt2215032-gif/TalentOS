import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '@/lib/config';
import { ANTHROPIC_MODELS, computeCost } from '@/lib/ai/models';
import { parseAndValidate } from '@/lib/ai/parse';
import {
  AiError,
  type AIProvider,
  type ModelTier,
  type StructuredRequest,
  type StructuredResult,
} from '@/lib/ai/types';

/**
 * Anthropic implementation of {@link AIProvider}.
 *
 * Uses the Messages API with `output_config.format` so the model is constrained
 * to the JSON Schema derived from our Zod contract, then validates the parsed
 * result against that same contract before returning it.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly isLlm = true;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      timeout: config.ai.timeoutMs,
      // The SDK retries 408/409/429/5xx on its own; two attempts is enough
      // before the engine's own degradation path takes over.
      maxRetries: 2,
    });
  }

  modelFor(tier: ModelTier): string {
    return config.ai.modelOverrides[tier] ?? ANTHROPIC_MODELS[tier].id;
  }

  async generateStructured<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const spec = ANTHROPIC_MODELS[request.tier];
    const model = this.modelFor(request.tier);
    const started = Date.now();
    const jsonSchema = z.toJSONSchema(request.schema, { target: 'draft-7' });

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: request.maxOutputTokens ?? 8000,
        // The system prompt is the stable prefix; marking it cacheable is what
        // keeps a twelve-question interview from re-billing the full role
        // context on every turn.
        system: [
          { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: request.prompt }],
        output_config: {
          // The Anthropic format takes the schema alone; `schemaName` is carried
          // on the request for providers that require it and for log context.
          format: {
            type: 'json_schema',
            schema: jsonSchema as Record<string, unknown>,
          },
        },
      });

      if (response.stop_reason === 'refusal') {
        throw new AiError('refusal', 'The model declined to produce this output.', {
          provider: this.name,
          retryable: false,
        });
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AiError(
          'invalid_output',
          'The model response was cut off before the object was complete.',
          { provider: this.name, retryable: true },
        );
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!text.trim()) {
        throw new AiError('invalid_output', 'The model returned an empty response.', {
          provider: this.name,
          retryable: true,
        });
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cachedWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
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
    } catch (error) {
      throw normalizeAnthropicError(error, this.name);
    }
  }
}

/** Map SDK exceptions onto the application's error taxonomy. */
function normalizeAnthropicError(error: unknown, provider: string): AiError {
  if (error instanceof AiError) return error;

  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'The AI provider rejected the configured API key.', {
      provider,
      retryable: false,
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError('rate_limit', 'The AI provider rate limit was reached.', {
      provider,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError('timeout', 'The AI provider did not respond in time.', {
      provider,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('network', 'Could not reach the AI provider.', { provider, cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiError('provider_error', 'The AI provider rejected the request.', {
      provider,
      retryable: false,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError('provider_error', `The AI provider returned an error (${error.status}).`, {
      provider,
      retryable: (error.status ?? 500) >= 500,
      cause: error,
    });
  }
  return new AiError('provider_error', 'An unexpected AI provider error occurred.', {
    provider,
    cause: error,
  });
}
