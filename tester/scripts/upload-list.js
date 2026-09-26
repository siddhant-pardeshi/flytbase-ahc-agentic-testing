import { fileURLToPath } from "node:url";
# Upload checklist generator (run after `npm test`):
#   node scripts/upload-list.js
# Prints every scenario video that needs a hosted link, in submission order.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'evaluation', 'evidence');
void root;

console.log('Upload every .mp4 below (YouTube unlisted or Google Drive, anyone-with-link),');
console.log('then paste each link into evaluation/EVALUATION.md at the matching [name.mp4] placeholder.\n');

function walk(dir, depth = 0): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory() && depth < 3) files.push(...walk(full, depth + 1));
    else if (entry.endsWith('.mp4')) files.push(full);
  }
  return files;
}

const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'evaluation');
for (const f of walk(evalDir)) {
  const rel = path.relative(evalDir, f);
  const mb = (statSync(f).size / 1024 / 1024).toFixed(1);
  console.log(`${rel}  (${mb} MB)`);
}
