import { io, type Socket } from 'socket.io-client';
import { config } from './config.js';

export interface DeviceTruth {
  id: string;
  name: string;
  type: string;
  connected: boolean | undefined;
  lastPosition: { latitude: number; longitude: number } | null;
  flightStatus: string | undefined;
  lastMessageAt: number;
}

const DRONE_ATTRS = ['heartbeat', 'global_position', 'attitude', 'battery', 'flight_status', 'alerts', 'video'];
const DOCK_ATTRS = ['heartbeat', 'dock'];
const topic = (deviceId: string, attr: string): string => `${config.orgId}/${deviceId}/telemetry/${attr}`;

/**
 * Independent ground-truth observer: joins the same socket broker the browser
 * uses and records what the simulator actually publishes. The tester compares
 * what the UI displays against this stream, so a UI that shows data nobody
 * sent (or hides data that was sent) is caught without trusting the app.
 */
export class Observer {
  private socket: Socket | null = null;
  private truth = new Map<string, DeviceTruth>();

  async start(): Promise<void> {
    this.socket = io(config.apiUrl, { auth: { 'org-id': config.orgId } });
    await new Promise<void>((resolve, reject) => {
      this.socket!.on('connect', () => resolve());
      this.socket!.on('connect_error', (e: Error) => reject(e));
    });
    this.socket.on('devices', (devices: Array<{ id: string; name: string; type: string }>) => {
      for (const d of devices) {
        if (this.truth.has(d.id)) continue;
        this.truth.set(d.id, {
          id: d.id,
          name: d.name,
          type: d.type,
          connected: undefined,
          lastPosition: null,
          flightStatus: undefined,
          lastMessageAt: 0,
        });
        const attrs = d.type === 'drone' ? DRONE_ATTRS : DOCK_ATTRS;
        for (const attr of attrs) {
          this.socket!.emit('Subscribe', { topic: topic(d.id, attr) });
          this.socket!.on(topic(d.id, attr), (payload: unknown) => {
            const t = this.truth.get(d.id);
            if (!t) return;
            t.lastMessageAt = Date.now();
            if (attr === 'heartbeat') {
              t.connected = (payload as { connected?: boolean }).connected;
            } else if (attr === 'global_position') {
              const p = (payload as { position?: { latitude: number; longitude: number } }).position;
              if (p) t.lastPosition = { latitude: p.latitude, longitude: p.longitude };
            } else if (attr === 'flight_status') {
              t.flightStatus = (payload as { flight_status?: string }).flight_status;
            }
          });
        }
      }
    });
    this.socket.emit('Subscribe', { topic: 'devices' });
    // Allow the retained device list and first telemetry to arrive.
    await new Promise((r) => setTimeout(r, 2000));
  }

  snapshot(): DeviceTruth[] {
    return [...this.truth.values()].map((t) => ({ ...t }));
  }

  droneIds(): string[] {
    return [...this.truth.values()].filter((t) => t.type === 'drone').map((t) => t.id);
  }

  stop(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
