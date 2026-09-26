import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from './config.js';
import { runScenario, type ScenarioResult } from './runner.js';
import { SCENARIOS } from './scenarios.js';
import { runMutationValidation, type MutationResult } from './mutations.js';
import { generateReport } from './report.js';
import { control } from './helpers.js';

function toMp4(webm: string): Promise<string> {
  const mp4 = webm.replace(/\.webm$/, '.mp4');
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-movflags', '+faststart', mp4], (err) => {
      resolve(err ? webm : mp4);
    });
  });
}

async function main(): Promise<void> {
  await mkdir(config.outDir, { recursive: true });
  console.log(`SentiNEL — agentic testing run`);
  console.log(`app: ${config.appUrl} · api: ${config.apiUrl} · judge: ${config.judge.apiKey ? config.judge.model : 'disabled (deterministic only)'}`);

  const health = (await fetch(`${config.apiUrl}/api/health`).then((r) => r.json())) as { simulator?: string; video?: string };
  if (health.simulator !== 'connected') throw new Error(`product not healthy: ${JSON.stringify(health)}`);
  console.log(`product health: simulator=${health.simulator} video=${health.video}`);

  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const scenarios: ScenarioResult[] = [];

  // ONLY=01,02 runs a subset (used for targeted re-runs; results are merged back
  // by scripts/merge-run.mjs).
  const only = process.env.ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
  const selected = only ? SCENARIOS.filter((s) => only.some((id) => s.meta.id.startsWith(id))) : SCENARIOS;
  if (selected.length === 0) throw new Error(`ONLY=${process.env.ONLY} matched no scenario`);

  for (const { meta, fn } of selected) {
    await control.resetSim();
    const result = await runScenario(browser, meta, fn);
    const mp4s: string[] = [];
    for (const v of result.videos) mp4s.push(await toMp4(v));
    result.videos = mp4s;
    scenarios.push(result);
  }

  if (only) {
    await browser.close();
    await writeFile(path.join(config.outDir, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scenarios, mutations: [] }, null, 2), 'utf8');
    console.log('\n=== TARGETED RUN COMPLETE ===');
    console.log(JSON.stringify(scenarios.map((s) => ({ id: s.id, status: s.status, checks: `${s.checks.filter((c) => c.pass).length}/${s.checks.length}` })), null, 2));
    return;
  }

  console.log('\n▶ mutation validation');
  await control.resetSim();
  const mutations: MutationResult[] = await runMutationValidation(browser, path.join(config.outDir, 'evidence'));
  for (const m of mutations) {
    if (m.video && m.video.endsWith('.webm')) m.video = await toMp4(m.video);
  }

  await browser.close();

  const report = await generateReport({
    generatedAt: new Date().toISOString(),
    appVersions: 'starter kit + Live Incident Response extension (working tree)',
    scenarios,
    mutations,
    judgeConfigured: Boolean(config.judge.apiKey),
  });

  const totalChecks = scenarios.reduce((n, s) => n + s.checks.length, 0);
  const passedChecks = scenarios.reduce((n, s) => n + s.checks.filter((c) => c.pass).length, 0);
  const totalIssues = scenarios.reduce((n, s) => n + s.issues.length, 0);
  const caught = mutations.filter((m) => m.detected && !m.id.startsWith('clean-control')).length;
  const flaggedClean = mutations.filter((m) => m.detected && m.id.startsWith('clean-control')).length;

  const summary = {
    scenarios: scenarios.length,
    checks: `${passedChecks}/${totalChecks} passed`,
    issuesFound: totalIssues,
    mutationsCaught: `${caught} caught, ${flaggedClean} false positives on clean build`,
    report,
  };
  await writeFile(path.join(config.outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\n=== RUN SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
