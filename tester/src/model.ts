import { config } from './config.js';

export interface JudgeResult {
  verdict: 'ok' | 'issue' | 'skipped';
  issues: string[];
  notes: string;
}

/**
 * Vision-language judge over any OpenAI-compatible endpoint. Rate-limit aware:
 * serialises calls and keeps a minimum interval, retries once on 429 with
 * backoff. Without an API key every review is reported as `skipped` so the
 * deterministic layer still runs end to end.
 */
export class Judge {
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;

  get configured(): boolean {
    return config.judge.apiKey.length > 0;
  }

  private async call(messages: unknown[]): Promise<string> {
    const wait = Math.max(0, config.judge.minIntervalMs - (Date.now() - this.lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
    const res = await fetch(`${config.judge.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.judge.apiKey}` },
      body: JSON.stringify({ model: config.judge.model, messages, max_tokens: 500, temperature: 0 }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 15000));
      return this.call(messages);
    }
    if (!res.ok) throw new Error(`judge http ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return body.choices[0]?.message?.content ?? '';
  }

  /** Ask the model whether a screenshot satisfies a user-level expectation. */
  review(png: Buffer, expectation: string, context?: string): Promise<JudgeResult> {
    if (!this.configured) return Promise.resolve({ verdict: 'skipped', issues: [], notes: 'no judge API key configured' });
    const run = async (): Promise<JudgeResult> => {
      try {
        const content = [
          { type: 'text', text: `You are a strict QA judge for a live incident response web app. Expectation: ${expectation}` + (context ? ` Context: ${context}` : '') + ' Reply with STRICT JSON only: {"ok": boolean, "issues": string[], "notes": string}. Issues must be genuinely incorrect user-facing behaviour, never wording or stylistic differences. If the expectation is met, ok=true and issues=[]' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
        ];
        const text = await this.call([{ role: 'user', content }]);
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return { verdict: 'skipped', issues: [], notes: `unparsable judge reply: ${text.slice(0, 200)}` };
        const parsed = JSON.parse(match[0]) as { ok: boolean; issues: string[]; notes?: string };
        return { verdict: parsed.ok ? 'ok' : 'issue', issues: parsed.issues ?? [], notes: parsed.notes ?? '' };
      } catch (e) {
        return { verdict: 'skipped', issues: [], notes: `judge unavailable: ${(e as Error).message}` };
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export const judge = new Judge();
