import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from './config.js';
import { runScenario, type ScenarioResult } from './runner.js';
import { L2_SCENARIOS } from './scenarios2.js';
import { generateL2Report } from './report2.js';
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
  console.log('SentiNEL Level 2 — semantic visual performance & chaos');
  console.log(`app: ${config.appUrl} · api: ${config.apiUrl} · out: ${config.outDir}`);

  const health = (await fetch(`${config.apiUrl}/api/health`).then((r) => r.json())) as { simulator?: string };
  if (health.simulator !== 'connected') throw new Error(`product not healthy: ${JSON.stringify(health)}`);

  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const scenarios: ScenarioResult[] = [];
  const only = process.env.ONLY?.split(',').map((s) => s.trim()).filter(Boolean);

  for (const { meta, fn } of L2_SCENARIOS) {
    if (only && !only.some((id) => meta.id.startsWith(id))) continue;
    await control.resetSim();
    const result = await runScenario(browser, meta, fn);
    const mp4s: string[] = [];
    for (const v of result.videos) mp4s.push(await toMp4(v));
    result.videos = mp4s;
    scenarios.push(result);
  }

  await browser.close();

  const report = await generateL2Report({ generatedAt: new Date().toISOString(), scenarios });
  await writeFile(
    path.join(config.outDir, 'summary2.json'),
    JSON.stringify(
      {
        scenarios: scenarios.length,
        checks: `${scenarios.reduce((n, s) => n + s.checks.filter((c) => c.pass).length, 0)}/${scenarios.reduce((n, s) => n + s.checks.length, 0)} passed`,
        report,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\n=== L2 SUMMARY ===');
  console.log(report);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
