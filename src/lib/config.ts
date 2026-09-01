
/**
 * Central, validated view of the process environment.
 *
 * Every server module reads configuration from here rather than touching
 * `process.env` directly, so a missing or malformed value fails once, loudly,
 * at first access — not deep inside a request handler.
 */

type SslMode = 'disable' | 'require';

function str(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(
      `Missing required environment variable ${name}. See .env.example for the full contract.`,
    );
  }
  return raw;
}

function optional(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? undefined : raw;
}

function int(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received "${raw}".`);
  }
  return parsed;
}

function num(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, received "${raw}".`);
  }
  return parsed;
}

function list(name: string): string[] {
  const raw = optional(name);
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

/** Provider identifiers the AI layer knows how to construct. */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'heuristic'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

function resolveAiProvider(): AiProviderName {
  const requested = (optional('AI_PROVIDER') ?? 'anthropic').toLowerCase();

  if (requested === 'none' || requested === 'heuristic') return 'heuristic';

  if (!AI_PROVIDERS.includes(requested as AiProviderName)) {
    throw new Error(
      `AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')} or "none", received "${requested}".`,
    );
  }

  const keyByProvider: Record<string, string | undefined> = {
    anthropic: optional('ANTHROPIC_API_KEY'),
    openai: optional('OPENAI_API_KEY'),
    gemini: optional('GEMINI_API_KEY'),
  };

  // A configured provider with no key is a misconfiguration in production, but
  // in development and CI it simply means "run the offline engine".
  if (!keyByProvider[requested]) {
    if (isProduction) {
      throw new Error(
        `AI_PROVIDER is "${requested}" but no API key is configured. ` +
          `Set the matching key, or set AI_PROVIDER=none to run the offline heuristic engine.`,
      );
    }
    return 'heuristic';
  }

  return requested as AiProviderName;
}

function resolveAuthSecret(): string {
  const secret = optional('AUTH_SECRET');
  if (!secret) {
    if (isProduction) {
      throw new Error('AUTH_SECRET is required in production.');
    }
    // Deterministic development fallback. Sessions signed with it do not
    // survive a restart in production because production refuses to boot.
    return 'talentos-development-only-secret-do-not-use-in-production';
  }
  if (secret.length < 32 && isProduction) {
    throw new Error('AUTH_SECRET must be at least 32 characters.');
  }
  return secret;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProduction,
  isTest,
  appUrl: str('APP_URL', 'http://localhost:3000'),

  database: {
    url: str('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/talentos'),
    ssl: (optional('DATABASE_SSL') ?? 'disable') as SslMode,
    poolMax: int('DATABASE_POOL_MAX', 5),
  },

  auth: {
    secret: resolveAuthSecret(),
    sessionTtlDays: int('AUTH_SESSION_TTL_DAYS', 30),
    cookieName: 'talentos_session',
    adminEmails: list('ADMIN_EMAILS'),
  },

  ai: {
    provider: resolveAiProvider(),
    anthropicApiKey: optional('ANTHROPIC_API_KEY'),
    openaiApiKey: optional('OPENAI_API_KEY'),
    geminiApiKey: optional('GEMINI_API_KEY'),
    modelOverrides: {
      reasoning: optional('AI_MODEL_REASONING'),
      standard: optional('AI_MODEL_STANDARD'),
      fast: optional('AI_MODEL_FAST'),
    },
    maxCostPerInterviewUsd: num('AI_MAX_COST_PER_INTERVIEW_USD', 1.5),
    timeoutMs: int('AI_TIMEOUT_MS', 90_000),
  },

  uploads: {
    maxBytes: int('UPLOAD_MAX_BYTES', 5 * 1024 * 1024),
  },

  rateLimit: {
    backend: (optional('RATE_LIMIT_BACKEND') ?? 'postgres') as 'postgres' | 'memory',
  },

  logLevel: (optional('LOG_LEVEL') ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;

/** True when the platform is running without a real LLM behind it. */
export const isHeuristicMode = config.ai.provider === 'heuristic';
