import { z } from 'zod';
import { config } from '@/lib/config';
import { GEMINI_MODELS, computeCost } from '@/lib/ai/models';
import { parseAndValidate } from '@/lib/ai/parse';
import { httpErrorToAiError } from '@/lib/ai/providers/openai';
import {
  AiError,
  type AIProvider,
  type ModelTier,
  type StructuredRequest,
  type StructuredResult,
} from '@/lib/ai/types';

/**
 * Google Gemini implementation of {@link AIProvider}.
 *
 * Gemini's `responseSchema` is a restricted dialect of JSON Schema: it rejects
 * `additionalProperties`, `$schema` and `const`, and requires `nullable` rather
 * than a union with null. {@link toGeminiSchema} performs that translation so
 * the rest of the platform keeps one schema definition.
 */

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { message?: string };
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  readonly isLlm = true;

  constructor(private readonly apiKey: string) {}

  modelFor(tier: ModelTier): string {
    return config.ai.modelOverrides[tier] ?? GEMINI_MODELS[tier].id;
  }

  async generateStructured<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const spec = GEMINI_MODELS[request.tier];
    const model = this.modelFor(request.tier);
    const started = Date.now();
    const schema = toGeminiSchema(z.toJSONSchema(request.schema, { target: 'draft-7' }));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Header auth keeps the key out of URLs, which get logged.
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              maxOutputTokens: request.maxOutputTokens ?? 8000,
            },
          }),
          signal: controller.signal,
        },
      );
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

    const body = (await response.json().catch(() => ({}))) as GeminiResponse;

    if (!response.ok) {
      throw httpErrorToAiError(response.status, body.error?.message, this.name);
    }

    const candidate = body.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
      throw new AiError('refusal', 'The model declined to produce this output.', {
        provider: this.name,
        retryable: false,
      });
    }
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new AiError('invalid_output', 'The model response was cut off.', {
        provider: this.name,
        retryable: true,
      });
    }

    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    if (!text.trim()) {
      throw new AiError('invalid_output', 'The model returned an empty response.', {
        provider: this.name,
        retryable: true,
      });
    }

    const cachedRead = body.usageMetadata?.cachedContentTokenCount ?? 0;
    const usage = {
      inputTokens: Math.max(0, (body.usageMetadata?.promptTokenCount ?? 0) - cachedRead),
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
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

type JsonSchemaNode = Record<string, unknown>;

/**
 * Translate standard JSON Schema into Gemini's `responseSchema` dialect.
 *
 * Handles the three incompatibilities that matter for our contracts:
 * unsupported keywords are dropped, `type: [T, "null"]` becomes
 * `type: T, nullable: true`, and `anyOf` unions with a null branch collapse the
 * same way.
 */
export function toGeminiSchema(node: unknown): JsonSchemaNode {
  if (typeof node !== 'object' || node === null) return {};
  const input = node as JsonSchemaNode;
  const output: JsonSchemaNode = {};

  // Gemini rejects these outright.
  const dropped = new Set(['$schema', 'additionalProperties', 'const', 'default', '$id']);

  for (const [key, value] of Object.entries(input)) {
    if (dropped.has(key)) continue;

    if (key === 'type' && Array.isArray(value)) {
      const concrete = value.filter((entry) => entry !== 'null');
      output['type'] = concrete[0] ?? 'string';
      if (concrete.length !== value.length) output['nullable'] = true;
      continue;
    }

    if (key === 'anyOf' && Array.isArray(value)) {
      const branches = value.filter(
        (branch) => !(typeof branch === 'object' && branch !== null && (branch as JsonSchemaNode)['type'] === 'null'),
      );
      const collapsed = toGeminiSchema(branches[0] ?? {});
      Object.assign(output, collapsed);
      if (branches.length !== value.length) output['nullable'] = true;
      continue;
    }

    if (key === 'properties' && typeof value === 'object' && value !== null) {
      output['properties'] = Object.fromEntries(
        Object.entries(value as JsonSchemaNode).map(([prop, sub]) => [prop, toGeminiSchema(sub)]),
      );
      continue;
    }

    if (key === 'items') {
      output['items'] = toGeminiSchema(value);
      continue;
    }

    output[key] = value;
  }

  return output;
}
