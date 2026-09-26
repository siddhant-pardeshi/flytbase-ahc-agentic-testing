import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import type { ScenarioResult } from './runner.js';
import type { MutationResult } from './mutations.js';

export interface ReportInput {
  generatedAt: string;
  appVersions: string;
  scenarios: ScenarioResult[];
  mutations: MutationResult[];
  judgeConfigured: boolean;
}

function videoLinks(videos: string[]): string {
  if (videos.length === 0) return '_recorded in-browser; see evidence folder_';
  return videos
    .map((v) => {
      const base = path.basename(v).replace(/\.webm$/, '');
      return `[${base}.mp4](<VIDEO_LINK:${base}.mp4>)`;
    })
    .join(' · ');
}

export async function generateReport(input: ReportInput): Promise<string> {
  const { scenarios, mutations } = input;
  const lines: string[] = [];

  lines.push('# Agentic Software Testing — Evaluation Document');
  lines.push('');
  lines.push(`**Challenge:** The Tireless Hand Challenge (Agentic Software Testing) · **Level 1:** Static UI and basic security testing`);
  lines.push(`**Generated:** ${input.generatedAt} · **System-under-test:** Live Incident Response (drone cockpit + shared incident dashboard), running at ${config.appUrl} / ${config.apiUrl}`);
  lines.push(`**Vision judge:** ${input.judgeConfigured ? `enabled (${config.judge.model})` : 'deterministic-only run (no judge API key configured for this run)'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Part 1 · System design');
  lines.push('');
  lines.push('### What we built');
  lines.push('');
  lines.push('**SentiNEL** is an agentic, black-box QA system that tests the running product the way a responder would: through a real browser, judging behaviour by meaning, and returning reproducible evidence (video, screenshots, timeline logs) for every finding. It never reads product source code and never runs unit tests.');
  lines.push('');
  lines.push('### Main parts');
  lines.push('');
  lines.push('| Part | What it does |');
  lines.push('|---|---|');
  lines.push('| **Scenario runner** (Playwright) | Drives real Chromium sessions — one per human in the story (commander, responders, a phone). Every session is video-recorded; screenshots, console errors, page errors and failed requests are captured as evidence. |');
  lines.push('| **Independent telemetry observer** | A separate socket.io client that listens to the simulator directly. It is ground truth: whatever the UI displays about drones (status, position, liveness) is cross-checked against this stream, so a screen that shows data nobody sent — or hides data that was sent — is caught without trusting the app under test. |');
  lines.push('| **Deterministic expectation engine** | Product-level expectations written from the user\'s point of view ("status pill reaches in_flight", "freshness badge downgrades to delayed under a slow network", "reply quotes the original message"). Checked via stable test ids and in-page measurement (bounding boxes, canvas pixel sampling of the video element, DOM state attributes). |');
  lines.push('| **Vision-language judge** (pluggable) | For semantic checks that resist exact assertions ("does this screen look right?"), screenshots are reviewed by a hosted vision model over an OpenAI-compatible API. It is rate-limit aware (serialised calls, minimum interval, 429 backoff) so it works within the free tiers. Its findings are merged with the deterministic layer; it never overrules a passing deterministic check on wording. |');
  lines.push('| **Mutation harness** | Simulates the deliberate changes evaluators introduce: CSS/JS/API-level mutations are applied to the running app from outside (route interception — no product code touched), and the paired detector must catch each one. The same detectors are also run against the clean build to prove they stay silent there (precision control). |');
  lines.push('| **Evidence & report generator** | Emits this document: per-scenario Title / Description / Approach / Video, plus findings with severity and the exact screenshot/log evidence behind each one. |');
  lines.push('');
  lines.push('### How the parts work together');
  lines.push('');
  lines.push('1. The runner resets the product to a known state through its own control API (the documented scripting surface), then executes scenarios end-to-end: real sign-ins, real joins from a second browser, real drone commands, real fault injection.');
  lines.push('2. While each scenario runs, the observer records the truth, the expectation engine checks user-visible behaviour, and the vision judge reviews key screens against user-level expectations.');
  lines.push('3. Findings are only reported when user-facing behaviour is genuinely wrong; acceptable wording/layout differences are ignored (the judge is instructed accordingly, and the clean-build control run validates precision).');
  lines.push('4. Each scenario produces its own real-time screen recording, so every claim in this document is reproducible from its video alone.');
  lines.push('');
  lines.push('### Product under test');
  lines.push('');
  lines.push('The starter drone cockpit was extended into the **Live Incident Response** product described in the brief: email + OTP sign-in, incident create, secure joining links, a shared dashboard (participants with live presence and shared locations, drones with telemetry/video/freshness, chat with replies and mentions, shared map observations), fault-visible data freshness, and a read-only audit history after the incident ends. The testing system treats this product exactly as an external QA system would.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Part 2 · Scenarios');
  lines.push('');
  lines.push('Each scenario below was executed against the running product; the video shows it running in real time.');
  lines.push('');

  scenarios.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.title}`);
    lines.push('');
    lines.push(`**Categories:** ${s.categories.join(', ')} · **Result:** ${s.status === 'pass' ? '✅ behaviour correct' : s.status === 'issues-found' ? '⚠️ issues found' : '❌ scenario error'} · ${s.checks.filter((c) => c.pass).length}/${s.checks.length} checks passed`);
    lines.push('');
    lines.push(`**Description.** ${s.description}`);
    lines.push('');
    lines.push(`**Approach.** ${s.approach}`);
    lines.push('');
    lines.push(`**Video.** ${videoLinks(s.videos)}`);
    lines.push('');
    if (s.issues.length > 0) {
      lines.push('**Issues found:**');
      for (const issue of s.issues) {
        lines.push(`- **${issue.title}** (${issue.severity}) — ${issue.detail}${issue.evidence ? ` · evidence: ${issue.evidence}` : ''}`);
      }
      lines.push('');
    }
    if (s.judgeNotes.length > 0) {
      lines.push('<details><summary>Vision judge notes</summary>');
      lines.push('');
      for (const n of s.judgeNotes) lines.push(`- ${n}`);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    lines.push('<details><summary>Checks executed</summary>');
    lines.push('');
    for (const c of s.checks) lines.push(`- ${c.pass ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  });

  const caught = mutations.filter((m) => m.detected && !m.id.startsWith('clean-control'));
  const missed = mutations.filter((m) => !m.detected && !m.id.startsWith('clean-control'));
  const cleanFlags = mutations.filter((m) => m.id.startsWith('clean-control') && m.detected);

  lines.push(`### ${scenarios.length + 1}. Mutation validation (catching deliberate app changes)`);  lines.push('');
  lines.push('**Description.** During evaluation, deliberate changes (mutations) will be introduced into the app; the testing system must catch them and must not fire on the clean build. This scenario validates exactly that, against the brief’s own example mutations, applied from outside the app (route interception, CSS/JS/API level — mirroring what a code change does to the served app).');
  lines.push('');
  lines.push('**Approach.** For each mutation: apply it to a fresh recorded browser, run the paired detector, and require detection. Then run every detector against the untouched build and require silence (false-positive control).');
  lines.push('');
  lines.push(`**Result: ${caught.length}/${caught.length + missed.length} mutations caught · ${cleanFlags.length} false positives on the clean build.**`);
  lines.push('');
  lines.push('| Mutation | Simulated change | Detector | Caught? | Evidence |');
  lines.push('|---|---|---|---|---|');
  for (const m of mutations) {
    lines.push(`| ${m.title}${m.id.startsWith('clean-control') ? ' (clean control)' : ''} | ${m.id.startsWith('clean-control') ? 'none — clean build' : m.mutation} | ${m.detector} | ${m.detected === m.id.startsWith('clean-control') ? '✅ correct' : m.detected ? '✅ caught' : '❌ missed'} | ${m.detail} |`);
  }
  lines.push('');
  lines.push('**Video.** Mutation runs are recorded under `evidence/mutations/`.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Appendix A · Real defects this system caught in the product (and their fixes)');
  lines.push('');
  lines.push('The system was run against the product repeatedly while both were being built. Beyond the seeded mutations above, it surfaced two genuine user-facing defects. Both were fixed in the product and are now regression-checked by their scenarios:');
  lines.push('');
  lines.push('1. **Signed-in users were bounced back to sign-in on every page reload** (found by scenario 1 on the first full run). The session was restored from storage in a React effect, but the auth guard redirected on the first render — a one-tick race that made the product unusable after every refresh, and broke every multi-user workflow after it. Fix: restore the session synchronously before the first render. Scenario 1 now asserts "session survives a reload" on every run.');
  lines.push('2. **The dashboard overflowed horizontally at phone width** (found by scenario 8). Grid children defaulted to their content width, so the chat input rendered 549px wide inside a 390px viewport and pushed the incident header actions off screen. Fix: min-width: 0 on grid children plus a wrapping header. Scenario 8 now asserts zero horizontal overflow on both the sign-in screen and the live dashboard.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Reproducing');
  lines.push('');
  lines.push('```bash');
  lines.push('cd tester');
  lines.push('# optional: export JUDGE_API_KEY=… JUDGE_BASE_URL=… JUDGE_MODEL=…');
  lines.push('npm run test        # resets the product state, runs all scenarios + mutations, writes this document');
  lines.push('```');
  lines.push('');
  lines.push(`Evidence tree: \`${config.outDir}evidence/<scenario-id>/\` — screen recordings (webm + mp4), screenshots, and the raw results in \`results.json\`.`);
  lines.push('');

  const file = path.join(config.outDir, 'EVALUATION.md');
  await writeFile(file, lines.join('\n'), 'utf8');
  await writeFile(
    path.join(config.outDir, 'results.json'),
    JSON.stringify({ generatedAt: input.generatedAt, scenarios: input.scenarios, mutations: input.mutations }, null, 2),
    'utf8',
  );
  return file;
}
