'use client';

import { useEffect, useState } from 'react';

/**
 * True once the component has hydrated on the client.
 *
 * Server-rendered forms are interactive-looking before React attaches its
 * handlers. A submit in that window performs a native GET, which navigates away
 * and silently discards everything the user typed. Gating the submit control on
 * this closes that window — the delay is imperceptible on a fast connection and
 * prevents real data loss on a slow one.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
