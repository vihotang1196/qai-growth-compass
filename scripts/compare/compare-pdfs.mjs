// Compare before/after PDFs page by page: count, page size, text per page (=> page breaks), first/last line, lowest text line, pixels.
// Usage: node compare-pdfs.mjs <cmpDir> <person> <lang>  -> prints a table, writes diff images to <cmpDir>/diff/<person>/<lang>/
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [dir, person, lang] = process.argv.slice(2);
const load = (side) => JSON.parse(readFileSync(join(dir, side, person, `${lang}-pages`, 'pages.json'), 'utf8'));
const A = load('before');
const B = load('after');
const norm = (t) => t.replace(/[￼\s]+/g, ' ').trim();
const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
const out = join(dir, 'diff', person, lang);
mkdirSync(out, { recursive: true });

const rows = [];
let textSame = true;
for (let i = 0; i < Math.max(A.count, B.count); i++) {
  const a = A.pages[i];
  const b = B.pages[i];
  if (!a || !b) { rows.push({ page: i + 1, note: a ? 'missing after' : 'new page after' }); textSame = false; continue; }
  const same = norm(a.text) === norm(b.text);
  if (!same) textSame = false;
  const d = JSON.parse(execFileSync(join(dir, 'pdftool'), ['diff', join(dir, 'before', person, `${lang}-pages`, `page-${i + 1}.png`), join(dir, 'after', person, `${lang}-pages`, `page-${i + 1}.png`), join(out, `page-${i + 1}.png`)], { encoding: 'utf8' }));
  const la = lines(a.text);
  const lb = lines(b.text);
  rows.push({
    page: i + 1,
    size: a.w === b.w && a.h === b.h ? `${Math.round(a.w)}x${Math.round(a.h)}` : `CHANGED ${a.w}x${a.h} -> ${b.w}x${b.h}`,
    text: same ? 'same' : 'DIFFERENT',
    firstLine: la[0] === lb[0] ? 'same' : `"${la[0]}" -> "${lb[0]}"`,
    lastLine: la.at(-1) === lb.at(-1) ? 'same' : `"${la.at(-1)}" -> "${lb.at(-1)}"`,
    // how far down the page the last text line ends (points from the top; A4 = 842, bottom margin starts at 842 - 34 = 808)
    textBottom: `${a.textBottom.toFixed(1)} -> ${b.textBottom.toFixed(1)} (${(b.textBottom - a.textBottom >= 0 ? '+' : '')}${(b.textBottom - a.textBottom).toFixed(1)})`,
    changedPixels: `${((d.diffPixels / (d.w * d.h)) * 100).toFixed(2)}%`,
  });
}
console.log(`\n== ${person} ${lang}: pages ${A.count} -> ${B.count}; all page text identical: ${textSame}`);
console.table(rows);
