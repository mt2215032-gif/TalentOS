import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import {
  checkPasswordStrength, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH,
} from '@/lib/auth/password';
import { AppError, normalizeError } from '@/lib/security/errors';
import { AiError } from '@/lib/ai/types';
import { extractJsonObject, parseAndValidate } from '@/lib/ai/parse';
import { computeCost, ANTHROPIC_MODELS } from '@/lib/ai/models';
import { toGeminiSchema } from '@/lib/ai/providers/gemini';
import { skillWeight } from '@/lib/job/service';

describe('password hashing', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct-horse-battery-9');
    expect(await verifyPassword('correct-horse-battery-9', hash)).toBe(true);
    expect(await verifyPassword('wrong-password-entirely', hash)).toBe(false);
  });

  it('produces a different hash each time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-9'), hashPassword('same-password-9')]);
    expect(a).not.toBe(b);
  });

  it('records its cost parameters so they can be raised later', async () => {
    const hash = await hashPassword('parameters-visible-9');
    expect(hash.startsWith('scrypt$65536$8$1$')).toBe(true);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    for (const bad of ['', 'garbage', 'scrypt$notanumber$8$1$aa$bb', 'md5$x$y']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });
});

describe('password policy', () => {
  it('rejects short, common and letters-only passwords', () => {
    expect(checkPasswordStrength('short').ok).toBe(false);
    expect(checkPasswordStrength('password123').ok).toBe(false);
    expect(checkPasswordStrength('aaaaaaaaaaaaaa').ok).toBe(false);
    expect(checkPasswordStrength('onlylettershere').ok).toBe(false);
  });

  it('accepts a long password mixing letters with a number or symbol', () => {
    expect(checkPasswordStrength('correct-horse-9').ok).toBe(true);
    expect(checkPasswordStrength('a'.repeat(MIN_PASSWORD_LENGTH) + '1').ok).toBe(false);
  });
});

describe('error normalisation', () => {
  it('keeps AppError messages, which are written for users', () => {
    const result = normalizeError(new AppError('not_found', 'That interview does not exist.'));
    expect(result.status).toBe(404);
    expect(result.payload.error.message).toBe('That interview does not exist.');
  });

  it('turns Zod issues into one message per field', () => {
    const schema = z.object({ email: z.string().email('Enter a valid email address.') });
    let error: unknown;
    try {
      schema.parse({ email: 'nope' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ZodError);

    const result = normalizeError(error);
    expect(result.status).toBe(422);
    expect(result.payload.error.fields?.['email']).toBe('Enter a valid email address.');
  });

  it('never leaks an unexpected error to the client', () => {
    const secret = new Error('connection to postgres://user:hunter2@db failed');
    const result = normalizeError(secret);

    expect(result.status).toBe(500);
    expect(result.payload.error.message).not.toContain('hunter2');
    expect(result.payload.error.message).not.toContain('postgres');
    // The detail is kept for the server log only.
    expect(result.logDetail).toContain('hunter2');
  });

  it('gives AI failures a candidate-safe message', () => {
    const result = normalizeError(
      new AiError('provider_error', 'model returned 400: invalid prompt content xyz'),
    );
    expect(result.payload.error.message).not.toContain('xyz');
    expect(result.status).toBe(503);
  });
});

describe('AI response parsing', () => {
  const schema = z.object({ name: z.string(), score: z.number() });

  it('accepts clean JSON', () => {
    expect(parseAndValidate(schema, '{"name":"a","score":1}', 'test')).toEqual({ name: 'a', score: 1 });
  });

  it('recovers an object wrapped in prose or a fence', () => {
    expect(parseAndValidate(schema, 'Here you go:\n```json\n{"name":"a","score":1}\n```', 'test'))
      .toEqual({ name: 'a', score: 1 });
  });

  it('is not confused by braces inside strings', () => {
    expect(extractJsonObject('{"name":"a } b","score":1}')).toEqual({ name: 'a } b', score: 1 });
  });

  it('rejects output that does not satisfy the schema', () => {
    expect(() => parseAndValidate(schema, '{"name":"a"}', 'test')).toThrow(AiError);
    expect(() => parseAndValidate(schema, 'not json at all', 'test')).toThrow(AiError);
  });

  it('marks schema failures retryable so the caller can feed the errors back', () => {
    try {
      parseAndValidate(schema, '{"name":123}', 'test');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).kind).toBe('invalid_output');
      expect((error as AiError).retryable).toBe(true);
    }
  });
});

describe('cost accounting', () => {
  it('prices input and output separately', () => {
    const cost = computeCost(ANTHROPIC_MODELS.reasoning, { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBe(ANTHROPIC_MODELS.reasoning.inputPerMTok);
  });

  it('discounts cache reads', () => {
    const cached = computeCost(ANTHROPIC_MODELS.reasoning, {
      inputTokens: 0, outputTokens: 0, cachedReadTokens: 1_000_000,
    });
    expect(cached).toBeLessThan(ANTHROPIC_MODELS.reasoning.inputPerMTok);
    expect(cached).toBeGreaterThan(0);
  });

  it('returns zero for a call that spent nothing', () => {
    expect(computeCost(ANTHROPIC_MODELS.fast, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe('Gemini schema translation', () => {
  it('drops keywords Gemini rejects', () => {
    const translated = toGeminiSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'string' } },
    });
    expect(translated['$schema']).toBeUndefined();
    expect(translated['additionalProperties']).toBeUndefined();
    expect(translated['properties']).toBeDefined();
  });

  it('converts a nullable union into type plus nullable', () => {
    const translated = toGeminiSchema({ type: ['string', 'null'] });
    expect(translated['type']).toBe('string');
    expect(translated['nullable']).toBe(true);
  });

  it('collapses an anyOf that includes null', () => {
    const translated = toGeminiSchema({ anyOf: [{ type: 'number' }, { type: 'null' }] });
    expect(translated['type']).toBe('number');
    expect(translated['nullable']).toBe(true);
  });

  it('recurses into arrays and nested objects', () => {
    const translated = toGeminiSchema({
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { b: { type: ['string', 'null'] } } },
    });
    const items = translated['items'] as Record<string, unknown>;
    const properties = items['properties'] as Record<string, Record<string, unknown>>;
    expect(items['additionalProperties']).toBeUndefined();
    expect(properties['b']?.['nullable']).toBe(true);
  });
});

describe('job skill weighting', () => {
  it('ranks a required critical skill far above a nice-to-have', () => {
    expect(skillWeight('required', 'critical')).toBeGreaterThan(skillWeight('nice_to_have', 'low') * 5);
  });

  it('keeps every weight inside 0..1 as the column constrains', () => {
    for (const requirement of ['required', 'preferred', 'nice_to_have'] as const) {
      for (const importance of ['critical', 'high', 'medium', 'low'] as const) {
        const weight = skillWeight(requirement, importance);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });
});
