import { useEffect, useState } from 'react';
import type { SocketStatus } from '../socket/socket-client';
import { socketClient } from '../socket/socket-client';

/**
 * Data freshness from the user's point of view: is what I see live, delayed,
 * stale, or has the connection dropped? Based on when payloads actually
 * arrived, how far behind the device's own timestamps are, and the socket
 * state. Deliberately semantic ("is this current?") instead of leaking
 * implementation details like exact message counts.
 */
export type Freshness = 'live' | 'delayed' | 'stale' | 'offline' | 'disconnected' | 'waiting';

/** A device that has not breathed for this long is showing stale data. */
const STALE_AFTER_MS = 4000;
/** Heartbeat timestamps further behind the local clock than this mean delay. */
const DELAYED_BEHIND_MS = 1200;

const lastArrival = new Map<string, number>();

let socketStatus: SocketStatus = 'disconnected';
socketClient.onStatus((s) => {
  socketStatus = s;
});

export function recordArrival(deviceId: string): void {
  lastArrival.set(deviceId, Date.now());
}

export function lastArrivalAt(deviceId: string): number | undefined {
  return lastArrival.get(deviceId);
}

export function computeFreshness(
  deviceId: string,
  heartbeatTimestamp: number | undefined,
  heartbeatConnected: boolean | undefined,
  now: number,
): Freshness {
  if (socketStatus === 'disconnected') return 'disconnected';
  const arrival = lastArrival.get(deviceId);
  if (arrival === undefined) return 'waiting';
  if (heartbeatConnected === false) return 'offline';
  if (now - arrival > STALE_AFTER_MS) return 'stale';
  if (heartbeatTimestamp !== undefined && heartbeatTimestamp > 0 && now - heartbeatTimestamp > DELAYED_BEHIND_MS) {
    return 'delayed';
  }
  return 'live';
}

const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: 'live',
  delayed: 'delayed',
  stale: 'stale',
  offline: 'device offline',
  disconnected: 'disconnected',
  waiting: 'waiting…',
};

export function freshnessLabel(f: Freshness): string {
  return FRESHNESS_LABEL[f];
}

/** Re-renders once a second so freshness badges stay current. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
