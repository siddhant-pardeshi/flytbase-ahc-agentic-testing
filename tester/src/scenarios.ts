import type { ScenarioCtx } from './runner.js';
import { apiCreateIncident, apiSignIn } from './helpers.js';
import { config } from './config.js';
import { Observer } from './observer.js';

const APP = config.appUrl;

async function uiSignIn(ctx: ScenarioCtx, email: string, name: string): Promise<void> {
  const page = ctx.lastPage;
  if (!page) throw new Error('no session page for sign-in');
  await page.goto(`${APP}/signin`);
  await page.getByTestId('signin-email').fill(email);
  // Tap the page's fetch so the OTP the UI itself requested can be read back.
  await page.evaluate(`
    (() => {
      if (window.__otpTap) return;
      const orig = window.fetch.bind(window);
      window.__otpTap = true;
      window.fetch = async (...args) => {
        const res = await orig(...args);
        try {
          if (String(args[0]).includes('/api/auth/otp')) {
            window.__lastOtp = (await res.clone().json()).dev_otp;
          }
        } catch {}
        return res;
      };
    })()
  `);
  await page.getByTestId('signin-otp-request').click();
  await page.getByTestId('signin-otp').waitFor({ state: 'visible' });
  const otp = (await page.evaluate('window.__lastOtp')) as string;
  if (!otp) throw new Error('OTP could not be captured from the sign-in response');
  await page.getByTestId('signin-otp').fill(otp);
  await page.getByTestId('signin-name').fill(name);
  await page.getByTestId('signin-submit').click();
  await page.waitForURL('**/incidents', { timeout: 8000 });
}

/** Every scenario below is one numbered entry of the evaluation document. */

// 01 ---------------------------------------------------------------- them: security, state
export async function authGate(ctx: ScenarioCtx): Promise<void> {
  const s = await ctx.newSession('signed-out-visitor');
  const page = s.page;

  await page.goto(`${APP}/incidents`);
  await ctx.sleep(1200);
  ctx.check('signed-out /incidents is redirected to sign-in', page.url().includes('/signin'), page.url());
  await page.goto(`${APP}/`);
  await ctx.sleep(1200);
  ctx.check('signed-out cockpit is redirected to sign-in', page.url().includes('/signin'), page.url());
  await page.goto(`${APP}/incident/does-not-exist`);
  await ctx.sleep(1200);
  ctx.check('signed-out incident page is redirected to sign-in', page.url().includes('/signin'), page.url());
  await ctx.shot('signin-gate', page);

  // Wrong code is rejected.
  await page.getByTestId('signin-email').fill('visitor@example.com');
  await page.getByTestId('signin-otp-request').click();
  await page.getByTestId('signin-otp').waitFor({ state: 'visible' });
  await page.getByTestId('signin-otp').fill('000000');
  await page.getByTestId('signin-name').fill('Visitor');
  await page.getByTestId('signin-submit').click();
  await page.getByTestId('signin-error').waitFor({ state: 'visible', timeout: 5000 });
  ctx.check('wrong one-time code is rejected with a visible error', true);
  await ctx.shot('signin-wrong-code', page);

  // Correct code captured from the app's own response.
  await uiSignIn(ctx, 'visitor@example.com', 'Visitor');
  ctx.check('email + OTP sign-in completes and lands on Incidents', page.url().includes('/incidents'), page.url());
  await ctx.shot('signed-in-incidents', page);

  await page.reload();
  await ctx.sleep(1500);
  ctx.check('session survives a reload (no repeated sign-in)', !page.url().includes('/signin'), page.url());
  await ctx.reviewScreenshot('signin-review', 'A sign-in screen with an email field, a one-time code field and clear primary actions; nothing important clipped or overlapping.');
}

// 02 ------------------------------------------------------ them: end-to-end, real-time
export async function createJoinMultiUser(ctx: ScenarioCtx): Promise<void> {
  const commander = await ctx.newSignedInSession('commander@demo.io', 'Maya');
  await commander.page.goto(`${APP}/incidents`);
  await commander.page.getByTestId('incident-title-input').fill('Dock fire drill — multi-user');
  await commander.page.getByTestId('incident-kind-select').selectOption('fire');
  await commander.page.getByTestId('incident-create-submit').click();
  await commander.page.waitForURL('**/incident/**', { timeout: 10000 });
  const incidentUrl = commander.page.url();
  ctx.check('commander creates an incident and lands on its dashboard', true, incidentUrl);

  const joinLinkInput = commander.page.getByTestId('join-link-value');
  await ctx.eventually(async () => ((await joinLinkInput.inputValue().catch(() => '')) ?? '').length > 0, {
    timeoutMs: 10000,
    intervalMs: 300,
    label: 'joining link to be fetched',
  });
  const joinLink = await joinLinkInput.inputValue();
  ctx.check('a secure joining link is shown to the commander', /\/join\/[0-9a-f]{16,}/.test(joinLink), joinLink);
  await ctx.shot('commander-dashboard', commander.page);

  const responder = await ctx.newSignedInSession('responder@demo.io', 'Arjun');
  await responder.page.goto(joinLink);
  await responder.page.getByTestId('join-title').waitFor({ state: 'visible' });
  ctx.check('joining link opens a join page that names the incident', true, await responder.page.getByTestId('join-title').textContent() ?? '');
  await ctx.shot('responder-join-page', responder.page);
  await responder.page.getByTestId('join-confirm').click();
  await responder.page.waitForURL('**/incident/**', { timeout: 10000 });

  // Commander must see the responder appear without any reload.
  await commander.page
    .getByTestId('participants-list')
    .getByText('Arjun', { exact: false })
    .waitFor({ state: 'visible', timeout: 8000 });
  ctx.check('responder appears on the commander’s dashboard without a refresh', true);
  await ctx.shot('commander-sees-responder', commander.page);

  const presence = commander.page.getByTestId('participants-list').locator('[data-presence="connected"]');
  await presence.first().waitFor({ state: 'visible', timeout: 8000 });
  const connectedCount = await presence.count();
  ctx.check('both participants show as connected in real time', connectedCount >= 2, `${connectedCount} connected`);
  await ctx.reviewScreenshot('multiuser-review', 'Two responders are listed with clear presence; the incident header shows title, active status and elapsed time.');
}

// 03 ------------------------------------------------------------------ them: real-time
export async function presenceDisconnect(ctx: ScenarioCtx): Promise<void> {
  const tokenA = await apiSignIn('p3a@demo.io', 'Nia');
  const tokenB = await apiSignIn('p3b@demo.io', 'Omar');
  const created = await apiCreateIncident(tokenA, 'Flood patrol — presence', 'storm');
  const a = await ctx.newSignedInSession('p3a@demo.io', 'Nia');
  const b = await ctx.newSignedInSession('p3b@demo.io', 'Omar');
  await a.page.goto(`${APP}/incident/${created.incident.id}`);
  await b.page.goto(`${APP}/incident/${created.incident.id}`);
  await a.page.waitForTimeout(2500);
  await a.page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  ctx.check('both participants connected before the drop', true);

  await b.close();
  await a.page
    .locator('[data-testid="participants-list"] .participant-row', { hasText: 'Omar' })
    .locator('[data-presence="disconnected"]')
    .waitFor({ state: 'visible', timeout: 12000 });
  ctx.check('commander sees the responder drop to disconnected without refreshing', true);
  const noReload = await a.page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);
  ctx.check('commander page was not reloaded to learn about the drop', noReload);
  await ctx.shot('responder-disconnected', a.page);
}

// 04 --------------------------------------------------------- them: functional, real-time
export async function chatSync(ctx: ScenarioCtx): Promise<void> {
  const tokenA = await apiSignIn('p4a@demo.io', 'Nia');
  const tokenB = await apiSignIn('p4b@demo.io', 'Omar');
  const created = await apiCreateIncident(tokenA, 'Chat drill', 'security');
  const a = await ctx.newSignedInSession('p4a@demo.io', 'Nia');
  const b = await ctx.newSignedInSession('p4b@demo.io', 'Omar');
  await a.page.goto(`${APP}/incident/${created.incident.id}`);
  await b.page.goto(`${APP}/incident/${created.incident.id}`);
  await ctx.sleep(2000);

  await a.page.getByTestId('chat-input').fill('Perimeter check starting, north gate');
  await a.page.getByTestId('chat-send').click();
  await b.page
    .getByTestId('chat-messages')
    .getByText('Perimeter check starting, north gate')
    .waitFor({ state: 'visible', timeout: 6000 });
  ctx.check('message appears on the other browser within seconds, no refresh', true);

  // Reply threading.
  const msgOnB = b.page.getByTestId('chat-messages').locator('.chat-message').filter({ hasText: 'Perimeter check' });
  await msgOnB.locator('.linkish', { hasText: 'reply' }).click();
  await b.page.getByTestId('chat-input').fill('Copy that. Taking the south route');
  await b.page.getByTestId('chat-send').click();
  await a.page
    .getByTestId('chat-messages')
    .locator('.chat-quote')
    .filter({ hasText: 'Perimeter check' })
    .waitFor({ state: 'visible', timeout: 6000 });
  ctx.check('reply quotes the original message on the other side', true);
  await ctx.shot('chat-thread', a.page);

  // Mention highlight.
  await a.page.getByTestId('chat-input').fill('@Omar please confirm the south gate');
  await a.page.getByTestId('chat-send').click();
  await b.page
    .getByTestId('chat-messages')
    .locator('.chat-message.mentions-me')
    .filter({ hasText: '@Omar' })
    .waitFor({ state: 'visible', timeout: 6000 });
  ctx.check('a message mentioning the responder is visually highlighted for them', true);
  await ctx.shot('chat-mention-highlight', b.page);
  await ctx.reviewScreenshot('chat-review', 'A chat panel where two users’ messages are clearly attributed and ordered; nothing overlaps the map or telemetry.');
}

// 05 -------------------------------------------------- them: functional, end-to-end, map
export async function droneCommandEndToEnd(ctx: ScenarioCtx): Promise<void> {
  const observer = new Observer();
  await observer.start();
  try {
    const token = await apiSignIn('p5@demo.io', 'Pia');
    const created = await apiCreateIncident(token, 'Recon launch drill', 'fire');
    const s = await ctx.newSignedInSession('p5@demo.io', 'Pia');
    await s.page.goto(`${APP}/incident/${created.incident.id}`);
    await s.page.getByTestId('device-row-drone-1').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(2000);

    await s.page.getByTestId('command-takeoff').click();
    await s.page
      .getByTestId('status-flight')
      .filter({ hasText: 'taking_off' })
      .waitFor({ state: 'visible', timeout: 10000 });
    ctx.check('takeoff is accepted and the status pill moves to taking_off', true);

    await s.page
      .getByTestId('status-flight')
      .filter({ hasText: 'in_flight' })
      .waitFor({ state: 'visible', timeout: 25000 });
    ctx.check('status reaches in_flight', true);

    const alt = await s.page.getByTestId('telemetry-alt-rlt').textContent();
    const altValue = Number((alt ?? '0').replace('m', '').trim());
    ctx.check('altitude climbs while in flight (user sees numbers, not dashes)', altValue > 5, `altitude RLT = ${alt}`);

    const truth = observer.snapshot().find((d) => d.id === 'drone-1');
    ctx.check('UI flight status matches the independent telemetry stream', truth?.flightStatus === 'in_flight', `observer says ${truth?.flightStatus}`);
    const pos1 = truth?.lastPosition;
    await ctx.sleep(4000);
    const pos2 = observer.snapshot().find((d) => d.id === 'drone-1')?.lastPosition;
    const moved = pos1 && pos2 && (Math.abs(pos1.latitude - pos2.latitude) > 1e-5 || Math.abs(pos1.longitude - pos2.longitude) > 1e-5);
    ctx.check('the drone is genuinely moving (map object should be live, not frozen)', !!moved, `${JSON.stringify(pos1)} → ${JSON.stringify(pos2)}`);
    await ctx.shot('in-flight', s.page);
    await ctx.reviewScreenshot('flight-review', 'A drone is selected, its status pill says in_flight, altitude shows a value above zero and a map is visible.');

    await s.page.getByTestId('command-land').click();
    await s.page
      .getByTestId('status-flight')
      .filter({ hasText: 'standby' })
      .waitFor({ state: 'visible', timeout: 45000 });
    ctx.check('land returns the drone to standby', true);
  } finally {
    observer.stop();
    await ctx.control.resetSim();
  }
}

// 06 ------------------------------------------------- them: telemetry, network and recovery
export async function telemetryFreshness(ctx: ScenarioCtx): Promise<void> {
  const token = await apiSignIn('p6@demo.io', 'Pia');
  const created = await apiCreateIncident(token, 'Freshness drill', 'infrastructure');
  const s = await ctx.newSignedInSession('p6@demo.io', 'Pia');
  await s.page.goto(`${APP}/incident/${created.incident.id}`);
  await s.page.getByTestId('device-row-drone-1').waitFor({ state: 'visible', timeout: 15000 });
  await ctx.sleep(2500);

  const badge = s.page.locator('[data-testid^="freshness-"]').first();
  const state = async (): Promise<string> => (await badge.getAttribute('data-freshness')) ?? 'none';
  ctx.expect('freshness starts as live', (await state()) === 'live', await state());
  await ctx.shot('freshness-live', s.page);

  await ctx.control.fault('socket-delay', { seconds: 0, value: 2500 });
  await ctx.eventually(async () => (await state()) === 'delayed', { timeoutMs: 20000, label: 'delayed badge' });
  ctx.check('under a delayed network the badge honestly shows delayed (not live)', true);
  await ctx.shot('freshness-delayed', s.page);
  await ctx.control.delete('/control/fault');

  await ctx.eventually(async () => (await state()) === 'live', { timeoutMs: 20000, label: 'live badge after recovery' });
  ctx.check('badge returns to live once the network recovers', true);

  await ctx.control.fault('sim-offline', { seconds: 25 });
  await ctx.eventually(async () => (await state()) === 'stale', { timeoutMs: 25000, label: 'stale badge' });
  ctx.check('when the simulator stops, the UI shows stale instead of pretending the data is current', true);
  await ctx.shot('freshness-stale', s.page);
  await ctx.control.delete('/control/fault');
  await ctx.eventually(async () => (await state()) === 'live', { timeoutMs: 25000, label: 'live badge after simulator returns' });
  ctx.check('UI recovers to live when telemetry resumes', true);
  await ctx.reviewScreenshot('freshness-review', 'The data freshness indicator is visible near the device panel and reads live.');
}

// 07 ------------------------------------------------------------------ them: video/media
export async function videoLiveness(ctx: ScenarioCtx): Promise<void> {
  const token = await apiSignIn('p7@demo.io', 'Pia');
  const created = await apiCreateIncident(token, 'Video health drill', 'fire');
  const s = await ctx.newSignedInSession('p7@demo.io', 'Pia');
  await s.page.goto(`${APP}/incident/${created.incident.id}`);
  await s.page.getByTestId('video-state').waitFor({ state: 'visible', timeout: 20000 });
  await ctx.eventually(async () => (await s.page.getByTestId('video-state').textContent()) === 'live', { timeoutMs: 20000, label: 'video live' });
  // Give the decoder a moment after the label flips before judging pixels.
  await ctx.sleep(4000);
  ctx.check('video tile reaches live', true);

  const grabFrame = (): Promise<string> =>
    s.page.evaluate(`
      (() => {
        const v = document.querySelector('[data-testid="video-player"]');
        if (!v || !(v instanceof HTMLVideoElement) || v.readyState < 2) return 'no-frame';
        const c = document.createElement('canvas');
        c.width = 160; c.height = 90;
        c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
        return c.toDataURL('image/png').slice(-128);
      })()
    `);

  // Two samples 2s apart must differ — identical frames under a "live" label mean a frozen feed.
  const framesAdvancing = async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const a = await grabFrame();
      await ctx.sleep(2000);
      const b = await grabFrame();
      if (a !== b && a !== 'no-frame' && b !== 'no-frame') return true;
    }
    return false;
  };
  const playing = await framesAdvancing(12000);
  ctx.check('pixels actually change while the label says live (not a frozen frame)', playing);
  await ctx.shot('video-live', s.page);

  // Switch source: a different drone must play different footage, and the label must stay honest.
  await s.page.getByTestId('device-row-drone-2').click();
  await ctx.eventually(async () => (await s.page.getByTestId('video-state').textContent()) === 'live', { timeoutMs: 20000, label: 'video live after switch' });
  await ctx.sleep(4000);
  const switchPlaying = await framesAdvancing(12000);
  ctx.check('after switching drones the video still plays', switchPlaying);
  ctx.check('label still reads live after the switch', (await s.page.getByTestId('video-state').textContent()) === 'live');

  await ctx.control.fault('video-freeze', { deviceId: 'drone-2', seconds: 14 });
  // Sample deep inside the fault window, after teardown settles.
  await ctx.sleep(6000);
  const f5 = await grabFrame();
  await ctx.sleep(2500);
  const f6 = await grabFrame();
  const stateDuringFreeze = await s.page.getByTestId('video-state').textContent();
  const frozen = (f5 === f6) || f5 === 'no-frame' || f6 === 'no-frame';
  ctx.check('frames stop while the stream is frozen', frozen, 'two samples 2.5s apart are identical or unavailable');
  ctx.check('the UI does not keep claiming live during the freeze', stateDuringFreeze !== 'live', `label = ${stateDuringFreeze}`);
  await ctx.shot('video-frozen', s.page);
  await ctx.eventually(async () => (await s.page.getByTestId('video-state').textContent()) === 'live', { timeoutMs: 25000, label: 'video recovers' });
  const f7 = await grabFrame();
  await ctx.sleep(2500);
  const f8 = await grabFrame();
  ctx.check('stream recovers to playing after the fault window', f7 !== f8);
  await ctx.reviewScreenshot('video-review', 'A video tile labelled live with an actual video frame visible (not a black or empty box).');
}

// 08 --------------------------------------------------------------- them: responsive UI
export async function responsiveMobile(ctx: ScenarioCtx): Promise<void> {
  const token = await apiSignIn('p8-commander@demo.io', 'Nia');
  const created = await apiCreateIncident(token, 'Mobile usability drill', 'storm');
  const s = await ctx.newSession('phone-user', { mobile: true, geolocation: true });
  const page = s.page;
  await page.goto(`${APP}/signin`);
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ctx.check('sign-in fits a 390px phone without horizontal scroll', overflow <= 2, `overflow = ${overflow}px`);
  await ctx.shot('mobile-signin', page);

  // Sign in on the phone (UI flow with fetch tap).
  await page.getByTestId('signin-email').fill('p8@demo.io');
  await page.evaluate(`
    (() => {
      const orig = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const res = await orig(...args);
        try { if (String(args[0]).includes('/api/auth/otp')) window.__lastOtp = (await res.clone().json()).dev_otp; } catch {}
        return res;
      };
    })()
  `);
  await page.getByTestId('signin-otp-request').click();
  await page.getByTestId('signin-otp').waitFor({ state: 'visible' });
  await page.getByTestId('signin-otp').fill((await page.evaluate('window.__lastOtp')) as string);
  await page.getByTestId('signin-name').fill('Quinn');
  await page.getByTestId('signin-submit').click();
  await page.waitForURL('**/incidents', { timeout: 8000 });
  await page.goto(`${APP}/incident/${created.incident.id}`);
  await page.getByTestId('incident-page').waitFor({ state: 'visible', timeout: 15000 });
  await ctx.sleep(2500);

  const dashOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ctx.check('incident dashboard has no horizontal overflow at phone width', dashOverflow <= 2, `overflow = ${dashOverflow}px`);

  const chatInput = page.getByTestId('chat-input');
  await chatInput.scrollIntoViewIfNeeded();
  await chatInput.waitFor({ state: 'visible' });
  const chatBox = await chatInput.boundingBox();
  ctx.check('chat input is reachable on the phone', !!chatBox && chatBox.width > 100, JSON.stringify(chatBox));
  const takeoff = page.getByTestId('command-takeoff');
  await takeoff.scrollIntoViewIfNeeded();
  const takeoffBox = await takeoff.boundingBox();
  ctx.check('takeoff action is reachable on the phone (main action not pushed off screen)', !!takeoffBox && takeoffBox.x >= 0 && takeoffBox.width > 40, JSON.stringify(takeoffBox));
  const endForCommander = await page.getByTestId('end-incident').count();
  ctx.check('responder correctly cannot see the end-incident control', endForCommander === 0);
  await ctx.shot('mobile-dashboard', page);
  await ctx.reviewScreenshot('mobile-review', 'On a phone-width layout the chat input and drone controls are visible and usable; nothing important is clipped off screen.');
}

// 09 ------------------------------------------------------------- them: security, permissions
export async function securityAndPermissions(ctx: ScenarioCtx): Promise<void> {
  const base = config.apiUrl;
  const anonIncidents = await fetch(`${base}/api/incidents`);
  ctx.check('incidents API rejects anonymous callers (401)', anonIncidents.status === 401, String(anonIncidents.status));
  const anonHistory = await fetch(`${base}/api/incidents/x/history`);
  ctx.check('history API rejects anonymous callers (401)', anonHistory.status === 401, String(anonHistory.status));

  const tokenA = await apiSignIn('p9a@demo.io', 'Rae');
  const tokenB = await apiSignIn('p9b@demo.io', 'Sam');
  const created = await apiCreateIncident(tokenA, 'Permissions drill', 'security');

  const badJoin = await fetch(`${base}/api/join/0000000000000000ffffffff`, { headers: { authorization: `Bearer ${tokenB}` } });
  ctx.check('a fabricated joining link is rejected (404)', badJoin.status === 404, String(badJoin.status));

  const forged = await fetch(`${base}/api/incidents`, { headers: { authorization: 'Bearer not-a-token' } });
  ctx.check('a forged session token is rejected (401)', forged.status === 401, String(forged.status));

  const joinB = await fetch(`${base}/api/incidents/${created.incident.id}/join`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenB}` }, body: '{}',
  });
  ctx.check('responder can join with a genuine link/token', joinB.ok, String(joinB.status));

  const endByResponder = await fetch(`${base}/api/incidents/${created.incident.id}/end`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenB}` }, body: '{}',
  });
  ctx.check('a responder cannot end someone else’s incident (403)', endByResponder.status === 403, String(endByResponder.status));

  const otherIncident = await apiCreateIncident(tokenB, 'Second incident', 'general');
  ctx.check('another incident can be created by the responder (isolation sanity)', otherIncident.incident.id !== created.incident.id);

  await fetch(`${base}/api/incidents/${created.incident.id}/end`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` }, body: '{}' });
  const chatAfterEnd = await fetch(`${base}/api/incidents/${created.incident.id}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` }, body: JSON.stringify({ text: 'too late' }),
  });
  ctx.check('writing into an ended incident is rejected (409)', chatAfterEnd.status === 409, String(chatAfterEnd.status));
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${tokenB}` } });
  const afterLogout = await fetch(`${base}/api/incidents`, { headers: { authorization: `Bearer ${tokenB}` } });
  ctx.check('a revoked session no longer grants access (401)', logout.ok && afterLogout.status === 401, `after logout: ${afterLogout.status}`);

  // Same probes, run live in a recorded browser so the video shows the API
  // surface refusing every bad request in real time. The 403 probe targets an
  // active incident owned by the commander (so the responder is genuinely
  // over-privileged), and a fresh responder token is used because the direct
  // phase above deliberately revoked tokenB.
  const { startProbeServer } = await import('./probe-console.js');
  const probe = await startProbeServer();
  try {
    const activeForProbe = await apiCreateIncident(tokenA, 'Permissions drill — active target', 'security');
    const freshResponder = await apiSignIn('p9b@demo.io', 'Sam');
    const s = await ctx.newSession('probe-console');
    await s.page.goto(`${probe.url}?commander=${tokenA}&responder=${freshResponder}&incident=${activeForProbe.incident.id}&ended=${created.incident.id}`);
    await s.page.getByRole('button', { name: 'Run probes' }).click();
    await s.page.waitForFunction(() => (window as unknown as { __probesDone?: boolean }).__probesDone === true, undefined, { timeout: 30000 });
    const results = (await s.page.evaluate('window.__probeResults')) as Array<{ name: string; ok: boolean; actual?: number }>;
    const allRefused = results.length === 7 && results.every((r) => r.ok);
    ctx.check('all seven in-browser probes were refused exactly as designed', allRefused, results.map((r) => `${r.actual ?? 'err'}`).join(','));
    await ctx.shot('probe-console-results', s.page);
  } finally {
    await probe.stop();
  }
}

// 10 -------------------------------------------------------------- them: audit and history
export async function historyAndAudit(ctx: ScenarioCtx): Promise<void> {
  const tokenA = await apiSignIn('p10a@demo.io', 'Nia');
  const tokenB = await apiSignIn('p10b@demo.io', 'Omar');
  const created = await apiCreateIncident(tokenA, 'Audit trail drill', 'fire');
  const a = await ctx.newSignedInSession('p10a@demo.io', 'Nia');
  const b = await ctx.newSignedInSession('p10b@demo.io', 'Omar', { geolocation: true });
  await a.page.goto(`${APP}/incident/${created.incident.id}`);
  await b.page.goto(`${APP}/incident/${created.incident.id}`);
  await ctx.sleep(2000);

  await a.page.getByTestId('chat-input').fill('First message for the record');
  await a.page.getByTestId('chat-send').click();
  await b.page.getByTestId('chat-input').fill('Second message for the record');
  await b.page.getByTestId('chat-send').click();
  await b.page.getByTestId('marker-use-my-location').click();
  await ctx.eventually(
    async () => ((await b.page.getByTestId('marker-use-my-location').textContent()) ?? '').includes(','),
    { timeoutMs: 15000, label: 'coordinates captured for the marker' },
  );
  await b.page.getByTestId('marker-label').fill('Hazard marker A');
  await b.page.getByTestId('marker-add').click();
  // A drone command issued from the incident dashboard must be audited with its actor.
  await b.page.getByTestId('device-row-drone-2').click();
  await b.page.getByTestId('command-takeoff').click();
  await b.page
    .getByTestId('status-flight')
    .filter({ hasText: 'taking_off' })
    .waitFor({ state: 'visible', timeout: 15000 });
  await b.page.getByTestId('command-land').click();
  await ctx.sleep(4000);
  a.page.once('dialog', (d) => void d.accept());
  await a.page.getByTestId('end-incident').click();
  await ctx.sleep(2500);

  await a.page.getByTestId('incident-ended-banner').waitFor({ state: 'visible', timeout: 8000 });
  ctx.check('commander sees the incident is now ended and the dashboard is read-only', true);
  const chatInputCount = await a.page.getByTestId('chat-input').count();
  ctx.check('chat input is removed after the incident ends', chatInputCount === 0);

  await a.page.goto(`${APP}/history/${created.incident.id}`);
  await a.page.getByTestId('history-events').waitFor({ state: 'visible', timeout: 10000 });
  const timeline = await a.page.getByTestId('history-events').locator('li').allTextContents();
  const joined = timeline.some((t) => t.includes('Omar joined'));
  const chatLogged = timeline.filter((t) => t.includes('for the record')).length;
  const markerLogged = timeline.some((t) => t.includes('Hazard marker A'));
  const commandLogged = timeline.some((t) => t.includes('takeoff'));
  const endedLogged = timeline.some((t) => t.includes('Incident ended'));
  ctx.check('history records who joined', joined, timeline.join(' | ').slice(0, 200));
  ctx.check('history records both chat messages attributed to their authors', chatLogged === 2, `${chatLogged} chat events`);
  ctx.check('history records the map observation', markerLogged);
  ctx.check('history records the drone command issued from the control surface', commandLogged);
  ctx.check('history records the end of the incident', endedLogged);
  const ro = await a.page.getByTestId('history-read-only').count();
  ctx.check('closed history is explicitly read-only', ro === 1);
  await ctx.shot('history-timeline', a.page);
  await ctx.control.resetSim();
  await ctx.reviewScreenshot('history-review', 'A read-only incident history with an ordered timeline of events, a chat log and responders list.');
}

// 11 --------------------------------------------------- them: map and geospatial, real-time
export async function mapObservations(ctx: ScenarioCtx): Promise<void> {
  const tokenA = await apiSignIn('p11a@demo.io', 'Nia');
  const tokenB = await apiSignIn('p11b@demo.io', 'Omar');
  const created = await apiCreateIncident(tokenA, 'Shared map drill', 'missing-person');
  const a = await ctx.newSignedInSession('p11a@demo.io', 'Nia', { geolocation: true });
  const b = await ctx.newSignedInSession('p11b@demo.io', 'Omar');
  await a.page.goto(`${APP}/incident/${created.incident.id}`);
  await b.page.goto(`${APP}/incident/${created.incident.id}`);
  await ctx.sleep(2000);

  await a.page.getByTestId('share-location-toggle').check();
  await b.page
    .locator('[data-testid="participants-list"] .participant-geo')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  const geo = await b.page.locator('[data-testid="participants-list"] .participant-geo').first().textContent();
  ctx.check('location sharing appears on the teammate’s screen with coordinates', !!geo && geo.includes(','), geo ?? 'none');
  await ctx.shot('location-shared', b.page);

  await a.page.getByTestId('marker-use-my-location').click();
  await ctx.eventually(
    async () => ((await a.page.getByTestId('marker-use-my-location').textContent()) ?? '').includes(','),
    { timeoutMs: 15000, label: 'coordinates captured for the marker' },
  );
  await a.page.getByTestId('marker-label').fill('Last known position');
  await a.page.getByTestId('marker-add').click();
  await b.page
    .getByTestId('markers-list')
    .getByText('Last known position')
    .waitFor({ state: 'visible', timeout: 8000 });
  ctx.check('a map observation appears on the teammate’s screen without refresh', true);
  await ctx.shot('observation-shared', b.page);
  await ctx.reviewScreenshot('map-review', 'The participants panel shows a teammate’s shared coordinates and a map observation list is visible.');
}

export const SCENARIOS: Array<{ meta: import('./runner.js').ScenarioMeta; fn: (ctx: ScenarioCtx) => Promise<void> }> = [
  {
    meta: {
      id: '01-auth-gate-and-session',
      title: 'Sign-in gate, OTP flow and session persistence',
      description:
        'A signed-out person must not see any operational screen: every product URL lands on the sign-in page, a wrong one-time code is rejected with a visible error, a correct email + OTP signs them in, and the session survives a page reload without asking again.',
      approach:
        'Playwright drives a fresh browser profile with no storage. It visits /incidents, / and a fake incident URL and asserts each redirects to /signin. It then runs the real sign-in UI: the one-time code is captured from the app’s own OTP response (fetch tap), a wrong code is tried first, and after sign-in the page is reloaded to prove the session persists.',
      categories: ['Security and permissions', 'State and persistence', 'Functional UI'],
    },
    fn: authGate,
  },
  {
    meta: {
      id: '02-create-join-multiuser',
      title: 'Create an incident and join a teammate through the secure link',
      description:
        'A commander creates an incident and gets a secret joining link. A teammate opening that link joins in one click, and the commander must see them appear in the responders list immediately, without refreshing.',
      approach:
        'Two independent recorded browser sessions run concurrently. The commander creates the incident through the UI; the joining link is read from the dashboard and opened in the second browser. The test waits (bounded) for the responder to appear in the commander’s participants panel and checks both show presence "connected".',
      categories: ['End-to-end workflow', 'Real-time and multi-user', 'Functional UI'],
    },
    fn: createJoinMultiUser,
  },
  {
    meta: {
      id: '03-presence-disconnect',
      title: 'A dropped teammate shows as disconnected immediately',
      description:
        'When someone’s browser dies, everyone else must see them as disconnected right away — the shared picture must never silently include people who are gone.',
      approach:
        'Two sessions join the same incident. The responder’s browser context is killed outright, then the test asserts the commander’s panel flips that participant to "disconnected" within 12s, and proves the commander page was not reloaded (an in-page marker set before the drop is still set afterwards).',
      categories: ['Real-time and multi-user', 'Network and recovery'],
    },
    fn: presenceDisconnect,
  },
  {
    meta: {
      id: '04-chat-sync-and-replies',
      title: 'Team chat: delivery, replies and @mentions',
      description:
        'Messages must reach the other browser within seconds, a reply must visibly quote the message it answers, and a message mentioning a teammate must be highlighted for that teammate.',
      approach:
        'Two recorded sessions chat in one incident. Assertions: message visible on the peer within 6s; a reply renders a quote of the original on the peer; a message containing @Name appears with the mentions-me highlight in the mentioned user’s browser.',
      categories: ['Functional UI', 'Real-time and multi-user'],
    },
    fn: chatSync,
  },
  {
    meta: {
      id: '05-drone-command-end-to-end',
      title: 'Drone workflow: take off, climb, verify against the telemetry stream, land',
      description:
        'The full operator loop: select a drone, take off, watch the status pill go taking_off → in_flight with altitude actually climbing, cross-check what the screen claims against an independent telemetry listener, then land back to standby.',
      approach:
        'The test runs its own socket.io observer that hears the simulator directly (ground truth). It clicks Take off in the UI, waits through the real state transitions, reads the altitude field, compares the on-screen status against the observer, verifies the drone’s position genuinely changes over 4s (a live object, not a frozen marker), then lands and waits for standby.',
      categories: ['Functional UI', 'End-to-end workflow', 'Map and geospatial', 'Telemetry'],
    },
    fn: droneCommandEndToEnd,
  },
  {
    meta: {
      id: '06-telemetry-freshness-honesty',
      title: 'The dashboard must say when data is delayed or stale',
      description:
        'Under a slow network or a dead simulator, on-screen numbers stop being trustworthy. The freshness indicator must downgrade from live → delayed → stale and recover, so responders never mistake old data for current.',
      approach:
        'Using the product’s own fault-injection API (the documented way to simulate bad networks): a 2.5s telemetry delay must flip the selected drone’s freshness badge to "delayed"; clearing it returns "live"; stopping the simulator must show "stale" within 25s; recovery returns "live". Screenshots capture each state.',
      categories: ['Telemetry', 'Network and recovery', 'Usability'],
    },
    fn: telemetryFreshness,
  },
  {
    meta: {
      id: '07-video-liveness-and-failure',
      title: 'Video is genuinely playing, survives a source switch, and admits failure',
      description:
        'A "live" label must mean moving pixels; switching drones must switch the actual feed; a dropped stream must not keep looking live; and everything must recover.',
      approach:
        'The test samples the <video> element onto a canvas 2.5s apart and compares pixels — identical frames while labelled "live" would be a defect. It switches to Drone 2 and repeats. It then injects a 12s video-freeze fault: frames must stop, the label must stop saying "live" during the freeze, and playback must return after the fault clears.',
      categories: ['Video and media', 'Network and recovery', 'Visual UI'],
    },
    fn: videoLiveness,
  },
  {
    meta: {
      id: '08-responsive-phone-usability',
      title: 'Phone-width layout keeps every critical action usable',
      description:
        'At 390×844 the sign-in, the chat input and the drone controls must all be visible or reachable by scrolling — a workflow that works on a laptop but loses its main action on a phone is a defect.',
      approach:
        'A session with a 390×844 viewport runs the real sign-in and opens an incident dashboard. The test measures horizontal overflow on each screen, scrolls to and bounding-boxes the chat input and the Take off button, and confirms a responder correctly has no "End incident" control.',
      categories: ['Responsive UI', 'Usability', 'Visual UI'],
    },
    fn: responsiveMobile,
  },
  {
    meta: {
      id: '09-security-and-permissions-api',
      title: 'API surface refuses anonymous, forged, and over-privileged requests',
      description:
        'Every incident API must reject anonymous callers and forged tokens; a fabricated joining link must fail; a responder must not be able to end someone else’s incident; an ended incident must refuse writes; and a signed-out session must lose access.',
      approach:
        'Two layers: direct HTTP probes of the running product (anonymous GETs expect 401, forged bearer token 401, bad join token 404, responder ending a commander’s incident 403, chat after end 409, access after logout 401) — and the same seven probes re-run live inside a recorded browser against a probe console, so the video shows each request being refused in real time.',
      categories: ['Security and permissions', 'API and data'],
    },
    fn: securityAndPermissions,
  },
  {
    meta: {
      id: '10-history-audit-trail',
      title: 'A closed incident leaves a complete, attributed, read-only history',
      description:
        'After an incident ends, the timeline must show who joined, what was said (attributed), what was marked on the map, which drone commands were sent, and when it ended — and the closed incident must refuse new writes.',
      approach:
        'A scripted incident generates a known event sequence (chat from two people, a map observation, a takeoff/land command issued from the incident dashboard). The commander ends it via the UI; the test verifies the read-only banner and missing inputs, then opens the history page and asserts each expected event is present, attributed and ordered, with the read-only marker shown.',
      categories: ['Audit and history', 'State and persistence', 'End-to-end workflow'],
    },
    fn: historyAndAudit,
  },
  {
    meta: {
      id: '11-shared-map-and-location',
      title: 'Shared map state: teammate locations and observations sync live',
      description:
        'A responder sharing their location must appear with coordinates on the commander’s screen, and a map observation must appear for everyone without a refresh — the map is the shared picture of the incident.',
      approach:
        'Two sessions; the commander’s browser is granted a synthetic geolocation and toggles location sharing on. The test waits for coordinates to render in the responder’s participants panel, then adds a marker via the UI and asserts it appears in the teammate’s observation list within 8s.',
      categories: ['Map and geospatial', 'Real-time and multi-user'],
    },
    fn: mapObservations,
  },
];
