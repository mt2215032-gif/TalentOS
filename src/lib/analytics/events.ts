import { query } from '@/lib/db/client';

/**
 * Product analytics.
 *
 * Events carry shape, never content: an interview id and a type, never a
 * question or an answer. That keeps the analytics table safe to expose to a BI
 * tool without exposing candidate material.
 */

export interface TrackInput {
  userId?: string | null;
  event: string;
  entityId?: string | null;
  props?: Record<string, string | number | boolean | null>;
}

export async function track(input: TrackInput): Promise<void> {
  try {
    await query(
      'INSERT INTO analytics_events (user_id, event, entity_id, props) VALUES ($1, $2, $3, $4)',
      [
        input.userId ?? null,
        input.event.slice(0, 120),
        input.entityId ?? null,
        JSON.stringify(input.props ?? {}),
      ],
    );
  } catch {
    // Telemetry is never worth failing a user's request over.
  }
}
