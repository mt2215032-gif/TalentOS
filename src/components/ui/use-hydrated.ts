'use client';

import { useSyncExternalStore } from 'react';

/**
 * True once the component has hydrated on the client.
 *
 * Server-rendered forms look interactive before React attaches its handlers. A
 * submit in that window performs a native GET, which navigates away and
 * silently discards everything the user typed. Gating the submit control on
 * this closes that window — imperceptible on a fast connection, and it prevents
 * real data loss on a slow one.
 *
 * `useSyncExternalStore` is the right tool: the server snapshot is `false` and
 * the client snapshot is `true`, so the transition happens as part of hydration
 * rather than through a state update in an effect, which would cost an extra
 * render pass.
 */

const subscribe = (): (() => void) => () => {};
const getClientSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
