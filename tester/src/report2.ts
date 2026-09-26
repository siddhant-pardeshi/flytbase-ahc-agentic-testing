import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import type { ScenarioResult } from './runner.js';

export interface L2ReportInput {
  generatedAt: string;
  scenarios: ScenarioResult[];
}

export async function generateL2Report(input: L2ReportInput): Promise<string> {
  const { scenarios } = input;
  const lines: string[] = [];

  lines.push('# Agentic Software Testing — Level 2: Semantic Visual Performance & Chaos');
  lines.push('');
  lines.push(`**Challenge:** The Tireless Hand Challenge · **Level 2:** Getting into your domain (performance testing)`);
  lines.push(`**Generated:** ${input.generatedAt} · **System-under-test:** Live Incident Response at ${config.appUrl} / ${config.apiUrl}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Part 1 · System design');
  lines.push('');
  lines.push('### The angle: perceived frontend performance, not backend latency');
  lines.push('');
  lines.push('Standard load testing (k6, JMeter) hammers APIs and reports server latency. That is exactly the wrong instrument for this product. Live Incident Response is a **real-time visual cockpit**: its failure modes are the ones backend load tests cannot see —');
  lines.push('');
  lines.push('- the render loop starving while the API reports 20 ms responses;');
  lines.push('- a participants panel that duplicates rows after a reconnect storm;');
  lines.push('- a chat that swallows messages on screen while the API accepted every one;');
  lines.push('- an interface that stays "healthy" on the wire but stops being *usable* on glass.');
  lines.push('');
  lines.push('So this level of **SentiNEL** measures performance where the user experiences it: in the rendered browser, under real protocol-level load, with an AI judge deciding whether what is on screen is still *usable to a responder*.');
  lines.push('');
  lines.push('### Main parts');
  lines.push('');
  lines.push('| Part | What it does |');
  lines.push('|---|---|');
  lines.push('| **Load generation via documented surfaces** | No product code is touched. The control API adds **real simulator drones** (each a full state machine: position 2 Hz + heartbeat/battery/flight/attitude 1 Hz), simulation speed multiplies every tick (the avalanche knob), a **server-side socket-kick** drops every connection at once (the herd trigger), and chat floods use the same REST API the UI uses. |');
  lines.push('| **In-page probes** | Injected into the page under test: requestAnimationFrame **FPS sampler**, `PerformanceObserver` **long-task** tracking, live **DOM node count**, **JS heap** usage. These measure the browser\'s actual ability to keep painting. |');
  lines.push('| **Time-to-Glass instrumentation** | End-to-end latency from the user\'s point of view: *command click → alert toast visible on screen*, and *API return → device row rendered*. Glass latency includes backend, socket fan-out, store updates and paint — the number a responder actually feels. |');
  lines.push('| **Vision judge** | Screenshots taken under load are reviewed by a vision-language model (OpenAI-compatible API, rate-limit aware): is the map still functional? are panel rows duplicated or ghosted? is the flooded chat visually broken? The judge evaluates *usability*, not beauty. |');
  lines.push('| **Evidence pipeline** | Every scenario records the screen (video), captures screenshots at each load tier, and emits structured checks and readings — the same evidence discipline as Level 1. |');
  lines.push('');
  lines.push('### How the parts work together');
  lines.push('');
  lines.push('1. The product is reset to a known state, then load is escalated in **tiers** (fleet size, sim speed, connection count, message volume) so degradation can be *localized* to a tier.');
  lines.push('2. During each tier, in-page probes sample rendering health, Time-to-Glass probes measure user-felt latency, and screenshots freeze the visual state for the judge.');
  lines.push('3. Chaos events (the socket-kick herd) are injected server-side, and recovery is measured on glass — not on the wire.');
  lines.push('4. Findings are separated honestly: **defects** (user-visible breakage) vs **scalability findings** (measured growth that should drive future work, e.g. missing list virtualization) — precision over drama.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Part 2 · Scenarios');
  lines.push('');

  scenarios.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.title}`);
    lines.push('');
    lines.push(`**Categories:** ${s.categories.join(', ')} · **Result:** ${s.status === 'pass' ? '✅ behaviour held up' : s.status === 'issues-found' ? '⚠️ issues found' : '❌ scenario error'} · ${s.checks.filter((c) => c.pass).length}/${s.checks.length} checks passed`);
    lines.push('');
    lines.push(`**Description.** ${s.description}`);
    lines.push('');
    lines.push(`**Approach.** ${s.approach}`);
    lines.push('');
    const vids = s.videos.map((v) => {
      const base = path.basename(v);
      return `[${base}](<VIDEO_LINK:${base}>)`;
    });
    lines.push(`**Video.** ${vids.length ? vids.join(' · ') : '_recorded; see evidence folder_'}`);
    lines.push('');
    if (s.issues.length > 0) {
      lines.push('**Issues found:**');
      for (const issue of s.issues) lines.push(`- **${issue.title}** (${issue.severity}) — ${issue.detail}${issue.evidence ? ` · evidence: ${issue.evidence}` : ''}`);
      lines.push('');
    }
    lines.push('<details><summary>Vision judge notes</summary>');
    lines.push('');
    for (const n of s.judgeNotes) lines.push(`- ${n}`);
    if (s.judgeNotes.length === 0) lines.push('- no judge API key configured for this run');
    lines.push('');
    lines.push('</details>');
    lines.push('');
    lines.push('<details open><summary>Checks & measurements executed</summary>');
    lines.push('');
    for (const c of s.checks) lines.push(`- ${c.pass ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    lines.push('');
    for (const n of s.notes) if (/baseline|after|final|post|heap|flood/i.test(n)) lines.push(`- 📈 ${n}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push('## Why traditional load testing misses all of this');
  lines.push('');
  lines.push('| Failure this framework can catch | What k6/JMeter would report |');
  lines.push('|---|---|');
  lines.push('| Render loop starvation at 24 drones × 6× speed | "p95 latency 22 ms — all good" |');
  lines.push('| Duplicated/ghost participants after a reconnect storm | "0 errors on reconnection endpoints" |');
  lines.push('| Command-to-glass latency growing under flood | "API accepted the command in 15 ms" |');
  lines.push('| DOM bloat and broken chat scroll in long sessions | Not measured at all |');
  lines.push('| A live video tile labelled "live" showing a frozen frame | Not measured at all |');
  lines.push('');
  lines.push('The user does not feel the server\'s p95. The user feels the glass.');
  lines.push('');
  lines.push('## Reproducing');
  lines.push('');
  lines.push('```bash');
  lines.push('cd tester');
  lines.push('OUT_DIR="$(pwd)/evaluation2" node --env-file=- -e "1" 2>/dev/null; OUT_DIR="$(pwd)/evaluation2" npx tsx src/main2.ts');
  lines.push('```');
  lines.push('');

  const file = path.join(config.outDir, 'EVALUATION2.md');
  await writeFile(file, lines.join('\n'), 'utf8');
  await writeFile(path.join(config.outDir, 'results2.json'), JSON.stringify(input, null, 2), 'utf8');
  return file;
}
