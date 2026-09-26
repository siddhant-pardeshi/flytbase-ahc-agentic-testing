import { config } from './config.js';

/** Control-panel API client: the same plain HTTP surface scripts and agents are told to use. */
export class ControlApi {
  private headers = { 'content-type': 'application/json' };

  async post(path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${config.apiUrl}/api${path}`, {
      method: 'POST',
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  }

  async get(path: string): Promise<unknown> {
    const res = await fetch(`${config.apiUrl}/api${path}`);
    return res.json().catch(() => ({}));
  }

  async resetSim(): Promise<void> {
    await this.post('/control/sim', { action: 'reset' });
    await this.post('/control/sim', { action: 'start' });
    await this.delete('/control/fault');
  }

  async command(deviceId: string, type: 'takeoff' | 'land'): Promise<void> {
    await this.post('/control/command', { deviceId, type });
  }

  async fault(kind: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.post('/control/fault', { kind, ...extra });
  }

  async delete(path: string): Promise<void> {
    await fetch(`${config.apiUrl}/api${path}`, { method: 'DELETE' });
  }
}

export const control = new ControlApi();

/** Sign in through the API and return a bearer token (demo OTP rides along by design). */
export async function apiSignIn(email: string, name: string): Promise<string> {
  const otpRes = (await (
    await fetch(`${config.apiUrl}/api/auth/otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  ).json()) as { dev_otp?: string };
  if (!otpRes.dev_otp) throw new Error('no dev otp returned');
  const verify = (await (
    await fetch(`${config.apiUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, otp: otpRes.dev_otp, name }),
    })
  ).json()) as { token?: string };
  if (!verify.token) throw new Error('verify failed');
  return verify.token;
}

export async function apiCreateIncident(
  token: string,
  title: string,
  kind = 'fire',
): Promise<{ incident: { id: string; title: string }; joinToken: string }> {
  const res = await fetch(`${config.apiUrl}/api/incidents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, kind }),
  });
  return (await res.json()) as { incident: { id: string; title: string }; joinToken: string };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function eventually(
  fn: () => Promise<boolean>,
  { timeoutMs = 8000, intervalMs = 250, label = 'condition' }: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}
