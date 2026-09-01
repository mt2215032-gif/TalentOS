import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/db/client';
import { getProvider } from '@/lib/ai';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness.
 *
 * Reports whether the database is reachable and which engine is configured.
 * It exposes no secrets and no user data, so it is safe to leave unauthenticated
 * for a platform health check.
 */
export async function GET(): Promise<NextResponse> {
  const database = await pingDatabase();
  const provider = getProvider();

  const healthy = database.ok;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version: process.env['npm_package_version'] ?? '1.0.0',
      environment: config.env,
      database: { ok: database.ok, latencyMs: database.latencyMs },
      engine: {
        provider: provider.name,
        // The single flag the UI uses to show the offline-mode banner.
        isLlm: provider.isLlm,
        mode: provider.isLlm ? 'llm' : 'offline_heuristic',
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
