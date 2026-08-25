import type { z } from 'zod';
import { AiError } from '@/lib/ai/types';

/**
 * Shared response handling for every provider.
 *
 * Model output is never trusted: it is parsed, validated against the caller's
 * Zod contract, and only then handed back. Anything that fails becomes an
 * `invalid_output` AiError, which the caller retries once before degrading.
 */

/** Parse model text as JSON and validate it against the caller's schema. */
export function parseAndValidate<T extends z.ZodType>(
  schema: T,
  text: string,
  provider: string,
): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Providers sometimes wrap JSON in prose or a fenced block even when the
    // response format was constrained. Recover the object rather than losing
    // the whole turn.
    const recovered = extractJsonObject(text);
    if (recovered === null) {
      throw new AiError('invalid_output', 'The model response was not valid JSON.', {
        provider,
        retryable: true,
      });
    }
    json = recovered;
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AiError('invalid_output', `Schema validation failed. ${describeIssues(result.error)}`, {
      provider,
      retryable: true,
    });
  }
  return result.data;
}

/** Compact, model-readable description of validation failures. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Pull the first balanced JSON object out of a string.
 *
 * Brace counting is string-aware, so a `{` inside a quoted answer does not
 * throw off the balance.
 */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
