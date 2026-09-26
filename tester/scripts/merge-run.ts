import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from '../src/config.js';
import { generateReport } from '../src/report.js';
import type { MutationResult, ScenarioResult } from '../src/runner.js';

/**
 * Merges a targeted re-run (OUT_DIR=evaluation-09 ONLY=09 …) back into the main
 * evaluation folder and regenerates EVALUATION.md.
 * Usage: npx tsx scripts/merge-run.mjs 09
 */
const idPrefix = process.argv[2];
if (!idPrefix) throw new Error('usage: npx tsx merge-run.ts <scenario-id-prefix>');

async function main(): Promise<void> {
const partialDir = path.resolve('evaluation-' + idPrefix);
const mainDir = config.outDir;

const partial = JSON.parse(readFileSync(path.join(partialDir, 'results.json'), 'utf8')) as { scenarios: ScenarioResult[] };
const main = JSON.parse(readFileSync(path.join(mainDir, 'results.json'), 'utf8')) as { scenarios: ScenarioResult[]; mutations: MutationResult[] };

for (const s of partial.scenarios) {
  // Videos live in the partial folder; move them under the main evidence tree.
  const idx = main.scenarios.findIndex((x) => x.id === s.id);
  if (idx < 0) throw new Error(`scenario ${s.id} not in main results`);
  const newVideos: string[] = [];
  for (const v of s.videos) {
    const relFromPartial = path.relative(partialDir, v);
    const dest = path.join(mainDir, relFromPartial);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(v, dest);
    newVideos.push(dest);
  }
  main.scenarios[idx] = { ...s, videos: newVideos };
  const evidenceSrc = path.join(partialDir, 'evidence', s.id);
  cpSync(evidenceSrc, path.join(mainDir, 'evidence', s.id), { recursive: true });
}

const generatedAt = new Date().toISOString();
writeFileSync(path.join(mainDir, 'results.json'), JSON.stringify({ generatedAt, ...main }, null, 2));
const report = await generateReport({
  generatedAt,
  appVersions: 'starter kit + Live Incident Response extension (working tree)',
  scenarios: main.scenarios,
  mutations: main.mutations,
  judgeConfigured: Boolean(config.judge.apiKey),
});
console.log('merged + regenerated:', report);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
void chromium;
