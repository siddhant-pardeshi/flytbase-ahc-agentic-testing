import type { Browser, BrowserContext, Page } from 'playwright';
import { config } from './config.js';
import { apiSignIn, apiCreateIncident, sleep } from './helpers.js';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface MutationResult {
  id: string;
  title: string;
  mutation: string;
  detector: string;
  detected: boolean;
  detail: string;
  video?: string;
}

interface MutationSpec {
  id: string;
  title: string;
  /** What a code-level change introduced by an evaluator would do to the app. */
  mutation: string;
  detector: string;
  apply: (context: BrowserContext) => Promise<void>;
  detect: (page: Page) => Promise<{ caught: boolean; detail: string }>;
}

const tapOtp = `
  (() => {
    if (window.__otpTap) return;
    const orig = window.fetch.bind(window);
    window.__otpTap = true;
    window.fetch = async (...args) => {
      const res = await orig(...args);
      try { if (String(args[0]).includes('/api/auth/otp')) window.__lastOtp = (await res.clone().json()).dev_otp; } catch {}
      return res;
    };
  })()
`;

async function grabFrame(page: Page): Promise<string> {
  return page.evaluate(`
    (() => {
      const v = document.querySelector('[data-testid="video-player"]');
      if (!v || !(v instanceof HTMLVideoElement) || v.readyState < 2) return 'no-frame';
      const c = document.createElement('canvas');
      c.width = 160; c.height = 90;
      c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').slice(-128);
    })()
  `);
}

const SPEC: MutationSpec[] = [
  {
    id: 'M1-signin-button-removed',
    title: 'Sign-in button removed from the login page',
    mutation: 'The submit button is hidden while the email and OTP fields remain, so the user can no longer sign in (the brief’s first example mutation).',
    detector: 'auth-gate: a real user must be able to complete email + OTP sign-in through the UI.',
    apply: async (context) => {
      await context.addInitScript(`
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = '[data-testid="signin-submit"]{display:none!important}';
          document.head.appendChild(style);
        });
      `);
    },
    detect: async (page) => {
      await page.goto(`${config.appUrl}/signin`);
      await page.evaluate(tapOtp);
      await page.getByTestId('signin-email').fill('mut@demo.io');
      await page.getByTestId('signin-otp-request').click();
      await page.getByTestId('signin-otp').waitFor({ state: 'visible' });
      const otp = (await page.evaluate('window.__lastOtp')) as string;
      await page.getByTestId('signin-otp').fill(otp ?? '123456');
      await sleep(400);
      const visible = await page.getByTestId('signin-submit').isVisible().catch(() => false);
      return visible
        ? { caught: false, detail: 'sign-in submit button still reachable — flow can complete' }
        : { caught: true, detail: 'with a valid code entered, no way to submit: sign-in is impossible' };
    },
  },
  {
    id: 'M2-main-action-offscreen-phone',
    title: 'Main drone action pushed off screen at phone width',
    mutation: 'A CSS change pushes the Take off command off the visible area at phone width (the brief’s third example mutation).',
    detector: 'responsive: at 390px the takeoff control must be inside the viewport and usable.',
    apply: async (context) => {
      await context.addInitScript(`
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = '@media(max-width:500px){[data-testid="command-takeoff"]{position:fixed!important;left:-600px!important}}';
          document.head.appendChild(style);
        });
      `);
    },
    detect: async (page) => {
      const token = await apiSignIn('mut2@demo.io', 'Mia');
      await page.context().addInitScript(
        ([t, u]) => {
          localStorage.setItem('incident-session', JSON.stringify({ token: t, user: u }));
        },
        [token, { id: 'seeded', email: 'mut2@demo.io', name: 'Mia' }] as const,
      );
      const created = await apiCreateIncident(token, 'Mutation layout probe', 'storm');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${config.appUrl}/incident/${created.incident.id}`);
      await page.getByTestId('incident-page').waitFor({ state: 'visible', timeout: 15000 });
      await sleep(1500);
      const btn = page.getByTestId('command-takeoff');
      await btn.scrollIntoViewIfNeeded().catch(() => undefined);
      const box = await btn.boundingBox();
      if (!box) return { caught: true, detail: 'takeoff control not rendered at all at phone width' };
      return box.x + box.width <= 0
        ? { caught: true, detail: `takeoff control sits at x=${box.x} — completely off screen on a phone` }
        : { caught: false, detail: `takeoff control visible at x=${box.x}` };
    },
  },
  {
    id: 'M3-auth-guard-removed',
    title: 'Signed-out user can open protected pages',
    mutation: 'The route guard that redirects signed-out users is disabled, letting anyone open operational pages (the brief’s fourth example mutation).',
    detector: 'security: with empty storage, /incidents must redirect to the sign-in page.',
    apply: async (context) => {
      await context.route('**/src/App.tsx*', async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        if (!body.includes('!token')) {
          await route.fulfill({ response });
          return;
        }
        await route.fulfill({ response, body: body.replaceAll('!token', 'false') });
      });
    },
    detect: async (page) => {
      await page.goto(`${config.appUrl}/incidents`);
      await sleep(2500);
      return page.url().includes('/signin')
        ? { caught: false, detail: 'signed-out visit still redirects to sign-in' }
        : { caught: true, detail: `signed-out visit lands on ${page.url()} — protected content exposed` };
    },
  },
  {
    id: 'M4-dead-stream-still-live',
    title: 'A frozen video stream keeps its live label',
    mutation: 'The video tile is changed to always display "live", so a dropped or frozen stream still looks live to the operator.',
    detector: 'video-liveness: while frames are not advancing, the label must not claim the feed is live.',
    apply: async (context) => {
      await context.route('**/src/components/VideoTile.tsx*', async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        // Vite/esbuild serves the module with double quotes.
        const target = `state === "playing" ? "live" : state`;
        if (!body.includes(target)) {
          await route.fulfill({ response });
          return;
        }
        await route.fulfill({ response, body: body.replaceAll(target, `"live"`) });
      });
    },
    detect: async (page) => {
      const token = await apiSignIn('mut4@demo.io', 'Mia');
      await page.context().addInitScript(
        ([t, u]) => {
          localStorage.setItem('incident-session', JSON.stringify({ token: t, user: u }));
        },
        [token, { id: 'seeded', email: 'mut4@demo.io', name: 'Mia' }] as const,
      );
      await page.goto(`${config.appUrl}/incidents`);
      const created = await apiCreateIncident(token, 'Mutation video probe', 'fire');
      await page.goto(`${config.appUrl}/incident/${created.incident.id}`);
      await page.getByTestId('video-state').waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="video-state"]')?.textContent === 'live', undefined, { timeout: 20000 });
      await fetch(`${config.apiUrl}/api/control/fault`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video-freeze', deviceId: 'drone-1', seconds: 16 }),
      });
      // Sample well inside the fault window, after the stream path teardown settles.
      await sleep(6000);
      const f1 = await grabFrame(page);
      await sleep(2500);
      const f2 = await grabFrame(page);
      const label = await page.getByTestId('video-state').textContent();
      await fetch(`${config.apiUrl}/api/control/fault`, { method: 'DELETE' });
      const frozen = f1 === f2 && f1 !== 'no-frame';
      if (frozen && label === 'live') {
        return { caught: true, detail: `frames are frozen but the tile still reads "${label}" — operator would trust a dead feed` };
      }
      return { caught: false, detail: `frozen=${frozen}, label=${label}` };
    },
  },
];

/**
 * Runs every mutation against a fresh recorded browser and asserts the paired
 * detector fires; also runs every detector against the clean build and asserts
 * silence (false-positive control).
 */
export async function runMutationValidation(browser: Browser, evidenceRoot: string): Promise<MutationResult[]> {
  const results: MutationResult[] = [];
  const dir = path.join(evidenceRoot, 'mutations');
  await mkdir(dir, { recursive: true });

  for (const spec of SPEC) {
    console.log(`\n▶ mutation ${spec.id} — ${spec.title}`);
    const context = await browser.newContext({
      viewport: config.viewport,
      recordVideo: { dir, size: config.viewport },
    });
    let detected = false;
    let detail = '';
    let videoDest: string | undefined;
    try {
      await spec.apply(context);
      const page = await context.newPage();
      const video = page.video();
      const outcome = await spec.detect(page);
      detected = outcome.caught;
      detail = outcome.detail;
      if (video) {
        await page.close();
        videoDest = path.join(dir, `${spec.id}.webm`);
        await video.saveAs(videoDest);
      }
    } catch (e) {
      detected = false;
      detail = `detector crashed: ${(e as Error).message}`;
    }
    await context.close().catch(() => undefined);
    console.log(`  ${detected ? '✔ caught' : '✘ MISSED'} — ${detail}`);
    results.push({ id: spec.id, title: spec.title, mutation: spec.mutation, detector: spec.detector, detected, detail, video: videoDest });
  }

  // False-positive control: same detectors, clean build.
  for (const spec of SPEC) {
    const context = await browser.newContext({ viewport: config.viewport });
    let detail = '';
    try {
      const page = await context.newPage();
      const outcome = await spec.detect(page);
      detail = outcome.detail;
      results.push({
        id: `clean-control/${spec.id}`,
        title: `${spec.title} — clean build control`,
        mutation: 'none (clean build)',
        detector: spec.detector,
        detected: outcome.caught,
        detail,
      });
    } catch (e) {
      results.push({
        id: `clean-control/${spec.id}`,
        title: `${spec.title} — clean build control`,
        mutation: 'none (clean build)',
        detector: spec.detector,
        detected: true,
        detail: `detector crashed on the clean build: ${(e as Error).message}`,
      });
    }
    await context.close();
  }
  return results;
}
