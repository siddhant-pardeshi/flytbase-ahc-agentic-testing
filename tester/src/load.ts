import { io, type Socket } from 'socket.io-client';
import { config } from './config.js';
import { apiSignIn, sleep } from './helpers.js';

/**
 * Load generation through documented, protocol-level surfaces only:
 *  - `POST /api/control/drones` spins up REAL simulator drone+dock pairs
 *    (each one is a full state machine publishing position at 2 Hz,
 *    heartbeat/battery/flight at 1 Hz — a fleet multiplies the whole stack).
 *  - `POST /api/control/sim { speed }` multiplies simulation time, so every
 *    state machine ticks faster — the avalanche knob.
 *  - Raw socket.io clients speaking the client protocol act as mass users
 *    (join → presence → reconnect storms).
 *  - Chat flooding uses the same REST API the UI uses.
 * No product code is modified anywhere.
 */

export interface LoadUser {
  email: string;
  name: string;
  token: string;
  participantId: string;
}

export class Fleet {
  /** Ids of drones added for the load test, so they can be removed after. */
  added: string[] = [];

  /** Add N real simulator drones and wait until they appear in the devices list. */
  async addDrones(n: number, namePrefix = 'Load'): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const before = new Set(await this.droneIds());
      await fetch(`${config.apiUrl}/api/control/drones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `${namePrefix} ${i + 1}` }),
      });
      const after = await this.droneIds();
      const fresh = after.find((id) => !before.has(id)) ?? `load-${i}`;
      this.added.push(fresh);
      ids.push(fresh);
    }
    return ids;
  }

  private async droneIds(): Promise<string[]> {
    const res = (await (await fetch(`${config.apiUrl}/api/devices`)).json()) as { devices?: Array<{ id: string; type: string }> };
    return (res.devices ?? []).filter((d) => d.type === 'drone').map((d) => d.id);
  }

  async setSpeed(speed: number): Promise<void> {
    await fetch(`${config.apiUrl}/api/control/sim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', speed }),
    });
  }

  /** Kick every cockpit socket at once (the server-side herd trigger). */
  async kickAll(): Promise<void> {
    await fetch(`${config.apiUrl}/api/control/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'socket-kick' }),
    });
  }

  /** Create N signed-in users joined to the incident (REST only). */
  async createUsers(n: number, incidentId: string, prefix = 'swarm'): Promise<LoadUser[]> {
    const users: LoadUser[] = [];
    for (let i = 0; i < n; i++) {
      const email = `${prefix}${i}@load.io`;
      const token = await apiSignIn(email, `${prefix.toUpperCase()}-${i}`);
      const joined = (await (
        await fetch(`${config.apiUrl}/api/incidents/${incidentId}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: '{}',
        })
      ).json()) as { participant: { id: string } };
      users.push({ email, name: `${prefix.toUpperCase()}-${i}`, token, participantId: joined.participant.id });
    }
    return users;
  }

  /**
   * Connect N users as presence-carrying clients (the same handshake the
   * dashboard uses). Returns the sockets; each one auto-reconnects after a
   * server kick, which is exactly what a herd of real dashboards does.
   */
  connectSwarm(users: LoadUser[], incidentId: string): Socket[] {
    return users.map((u) => {
      const s = io(config.apiUrl, {
        auth: {
          'org-id': config.orgId,
          'session-token': u.token,
          'incident-id': incidentId,
          'participant-id': u.participantId,
        },
        reconnection: true,
        reconnectionDelay: 100 + Math.floor(Math.random() * 400),
      });
      s.emit('Subscribe', { topic: `incident/${incidentId}/state` });
      return s;
    });
  }

  /** Flood the incident chat via the normal REST API. */
  async floodChat(users: LoadUser[], incidentId: string, total: number, onProgress?: (n: number) => void): Promise<number> {
    let sent = 0;
    for (let i = 0; i < total; i++) {
      const u = users[i % users.length];
      const res = await fetch(`${config.apiUrl}/api/incidents/${incidentId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${u.token}` },
        body: JSON.stringify({ text: `load-msg-${i + 1}: status report from ${u.name}` }),
      });
      if (res.ok) sent++;
      if (i % 25 === 0) onProgress?.(sent);
      await sleep(8);
    }
    return sent;
  }
}

/** Time-to-Glass: resolve when a toast containing `text` is visible on screen. */
export async function toastGlassLatency(
  page: import('playwright').Page,
  text: string,
  timeoutMs = 15000,
): Promise<number> {
  const start = Date.now();
  await page
    .locator(`[data-testid="alert-toast"]`, { hasText: text })
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs });
  return Date.now() - start;
}
