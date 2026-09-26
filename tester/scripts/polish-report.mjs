import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'evaluation');
const results = JSON.parse(readFileSync(path.join(evalDir, 'results.json'), 'utf8'));

const renames = new Map();

for (const s of results.scenarios) {
  s.videos = s.videos.map((v, i) => {
    const old = v.replace(/\.webm$/, '.mp4');
    if (!existsSync(old)) return old;
    const next = path.join(path.dirname(old), `${s.id}-${i + 1}.mp4`);
    if (old !== next && !existsSync(next)) renameSync(old, next);
    renames.set(path.basename(old), path.basename(next));
    return next;
  });
}

for (const m of results.mutations ?? []) {
  if (!m.video) continue;
}

let doc = readFileSync(path.join(evalDir, 'EVALUATION.md'), 'utf8');
// Fix double extension first
doc = doc.replaceAll('.mp4.mp4', '.mp4');
// Apply friendly renames
for (const [from, to] of renames) {
  doc = doc.replaceAll(from, to);
}
writeFileSync(path.join(evalDir, 'EVALUATION.md'), doc);
writeFileSync(path.join(evalDir, 'results.json'), JSON.stringify(results, null, 2));

console.log('renamed', renames.size, 'videos:');
for (const [from, to] of renames) console.log(`  ${from} → ${to}`);
