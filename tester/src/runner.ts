import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from './config.js';
import { judge, type JudgeResult } from './model.js';
import { apiSignIn, control, eventually, sleep } from './helpers.js';

export interface Issue {
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
  evidence?: string;
}

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface Session {
  name: string;
  page: Page;
  context: BrowserContext;
  consoleErrors: string[];
  failedRequests: string[];
  close: () => Promise<void>;
}

export interface ScenarioMeta {
  id: string;
  title: string;
  description: string;
  approach: string;
  categories: string[];
}

export interface ScenarioResult extends ScenarioMeta {
  status: 'pass' | 'issues-found' | 'error';
  checks: Check[];
  issues: Issue[];
  notes: string[];
  videos: string[];
  screenshots: string[];
  judgeNotes: string[];
  error?: string;
}

export class ScenarioCtx {
  readonly meta: ScenarioMeta;
  readonly judge = judge;
  readonly control = control;
  readonly sleep = sleep;
  readonly eventually = eventually;
  readonly apiSignIn = apiSignIn;

  private checks: Check[] = [];
  private issues: Issue[] = [];
  private notes: string[] = [];
  private judgeNotes: string[] = [];
  private sessions: Session[] = [];
  private screenshots: string[] = [];
  private shotSeq = 0;

  constructor(
    private browser: Browser,
    meta: ScenarioMeta,
    private evidenceDir: string,
  ) {
    this.meta = meta;
  }

  log(msg: string): void {
    this.notes.push(msg);
    console.log(`      · ${msg}`);
  }

  check(name: string, pass: boolean, detail?: string): void {
    this.checks.push({ name, pass, detail });
    console.log(`      ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  }

  expect(name: string, pass: boolean, detail?: string): void {
    if (!pass) throw new Error(`check failed: ${name}${detail ? ` — ${detail}` : ''}`);
    this.check(name, pass, detail);
  }

  issue(i: Issue): void {
    this.issues.push(i);
    console.log(`      ⚠ ISSUE (${i.severity}): ${i.title}`);
  }

  async shot(name: string, page?: Page): Promise<string> {
    const target = page ?? this.sessions[this.sessions.length - 1]?.page;
    if (!target) throw new Error('no page to screenshot');
    const file = path.join(this.evidenceDir, `${String(++this.shotSeq).padStart(2, '0')}-${name}.png`);
    await target.screenshot({ path: file });
    const rel = path.relative(config.outDir, file);
    this.screenshots.push(rel);
    return rel;
  }

  async reviewScreenshot(name: string, expectation: string, page?: Page): Promise<JudgeResult> {
    const target = page ?? this.sessions[this.sessions.length - 1]?.page;
    if (!target) throw new Error('no page to review');
    const png = await target.screenshot();
    const file = path.join(this.evidenceDir, `${String(++this.shotSeq).padStart(2, '0')}-${name}.png`);
    await writeFile(file, png);
    this.screenshots.push(path.relative(config.outDir, file));
    const result = await this.judge.review(png, expectation, this.meta.description);
    this.judgeNotes.push(`${name}: ${result.verdict} — ${result.notes}${result.issues.length ? ` | issues: ${result.issues.join('; ')}` : ''}`);
    if (result.verdict === 'issue') {
      for (const text of result.issues) {
        this.issue({ title: `Vision judge: ${text}`, detail: `Expectation was: ${expectation}`, severity: 'medium', evidence: path.relative(config.outDir, file) });
      }
    }
    return result;
  }

  /** A fresh recorded browser session ("one responder's laptop"). */
  async newSession(
    name: string,
    opts: { mobile?: boolean; geolocation?: boolean; camera?: boolean } = {},
  ): Promise<Session> {
    const videoDir = path.join(this.evidenceDir, 'video');
    await mkdir(videoDir, { recursive: true });
    const viewport = opts.mobile ? config.mobileViewport : config.viewport;
    const context = await this.browser.newContext({
      viewport,
      recordVideo: { dir: videoDir, size: config.viewport },
      permissions: opts.geolocation ? ['geolocation', ...(opts.camera ? ['camera'] : [])] : opts.camera ? ['camera'] : undefined,
      geolocation: opts.geolocation ? { latitude: 18.5621, longitude: 73.6965 } : undefined,
    });
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    context.on('weberror', (e) => consoleErrors.push(String(e)));
    const session: Session = {
      name,
      context,
      consoleErrors,
      failedRequests,
      page: await context.newPage(),
      close: async () => {
        await context.close();
      },
    };
    session.page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    session.page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    session.page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`));
    session.page.on('response', (r) => {
      if (r.status() >= 500) failedRequests.push(`${r.request().method()} ${r.url()} -> ${r.status()}`);
    });
    this.sessions.push(session);
    return session;
  }

  /** Pre-authenticated session: token is installed into localStorage before load. */
  async newSignedInSession(
    email: string,
    name: string,
    opts: { mobile?: boolean; geolocation?: boolean; camera?: boolean } = {},
  ): Promise<Session> {
    const token = await apiSignIn(email, name);
    const session = await this.newSession(name, opts);
    await session.page.addInitScript(
      ([t, u]) => {
        localStorage.setItem('incident-session', JSON.stringify({ token: t, user: u }));
      },
      [token, { id: 'seeded', email, name }] as const,
    );
    return session;
  }

  results(): Omit<ScenarioResult, 'status'> & { status: ScenarioResult['status'] } {
    const failed = this.checks.filter((c) => !c.pass);
    const status: ScenarioResult['status'] = this.issues.length > 0 ? 'issues-found' : failed.length > 0 ? 'error' : 'pass';
    return {
      ...this.meta,
      status,
      checks: this.checks,
      issues: this.issues,
      notes: this.notes,
      judgeNotes: this.judgeNotes,
      videos: [],
      screenshots: this.screenshots,
    };
  }

  /** The most recently opened page (convenience for helpers outside the class). */
  get lastPage(): Page | undefined {
    return this.sessions[this.sessions.length - 1]?.page;
  }

  async cleanup(): Promise<string[]> {
    const videos: string[] = [];
    let seq = 0;
    for (const s of this.sessions) {
      try {
        const video = s.page.video();
        // Close the page first so the recording ends with this scenario and
        // cannot leak frames from whatever runs afterwards.
        await s.page.close();
        if (video) {
          seq += 1;
          const dest = path.join(this.evidenceDir, 'video', `${s.name.replace(/\W+/g, '-').toLowerCase()}-${seq}.webm`);
          await mkdir(path.dirname(dest), { recursive: true });
          await video.saveAs(dest);
          videos.push(dest);
        }
        await s.context.close();
      } catch {
        // context already gone
      }
    }
    this.sessions = [];
    return videos;
  }
}

/** Run one scenario with full lifecycle management. */
export async function runScenario(
  browser: Browser,
  meta: ScenarioMeta,
  fn: (ctx: ScenarioCtx) => Promise<void>,
): Promise<ScenarioResult> {
  const evidenceDir = path.join(config.outDir, 'evidence', meta.id);
  await mkdir(evidenceDir, { recursive: true });
  console.log(`\n▶ ${meta.id} — ${meta.title}`);
  const ctx = new ScenarioCtx(browser, meta, evidenceDir);
  let result: ScenarioResult;
  try {
    await fn(ctx);
  } catch (e) {
    ctx.check('scenario completed without unexpected errors', false, (e as Error).message);
  }
  const videos = await ctx.cleanup();
  const partial = ctx.results();
  result = { ...partial, videos };
  console.log(`  ▶ ${meta.id} → ${result.status} (${result.checks.filter((c) => c.pass).length}/${result.checks.length} checks, ${result.issues.length} issues)`);
  return result;
}
