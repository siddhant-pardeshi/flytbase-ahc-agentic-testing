import { cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { generateL2Report } from '../src/report2.js';
import type { ScenarioResult } from '../src/runner.js';

/** Merge targeted L2 re-runs (OUT_DIR=evaluation2-rerun ONLY=… ) into evaluation2. Usage: npx tsx scripts/merge-run2.ts <id,id> */
async function main(): Promise<void> {
  const ids = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('usage: npx tsx merge-run2.ts L2-1,L2-3');
  const partialDir = path.resolve('evaluation2-rerun');
  const mainDir = config.outDir;

  const partial = JSON.parse(readFileSync(path.join(partialDir, 'results2.json'), 'utf8')) as { scenarios: ScenarioResult[] };
  const main = JSON.parse(readFileSync(path.join(mainDir, 'results2.json'), 'utf8')) as { scenarios: ScenarioResult[] };

  for (const s of partial.scenarios) {
    if (!ids.some((id) => s.id.startsWith(id))) continue;
    const idx = main.scenarios.findIndex((x) => x.id === s.id);
    if (idx < 0) throw new Error(`scenario ${s.id} not in main results`);
    const newVideos: string[] = [];
    for (const v of s.videos) {
      const rel = path.relative(partialDir, v);
      const dest = path.join(mainDir, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(v, dest);
      newVideos.push(dest);
    }
    main.scenarios[idx] = { ...s, videos: newVideos };
    cpSync(path.join(partialDir, 'evidence', s.id), path.join(mainDir, 'evidence', s.id), { recursive: true });
  }

  const generatedAt = new Date().toISOString();
  writeFileSync(path.join(mainDir, 'results2.json'), JSON.stringify({ generatedAt, scenarios: main.scenarios }, null, 2));
  const report = await generateL2Report({ generatedAt, scenarios: main.scenarios });
  console.log('merged + regenerated:', report);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
