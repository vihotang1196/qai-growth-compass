#!/usr/bin/env node
/**
 * 构建产物泄密检查(PROGRESS.md 0.17)。
 *
 * 只有 VITE_ 前缀的变量会被 Vite 打进客户端 bundle,而 anon key 本就是公开凭证。
 * 但一次手滑给 secret 加上 VITE_ 前缀,就会把 service role key 或 GHL webhook URL
 * 送进浏览器。这个检查让那种手滑在构建阶段就炸掉,而不是上线后才发现。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

/** 命中即失败。用不含通配的朴素子串,避免误报难排查 */
const FORBIDDEN = [
  'SERVICE_ROLE',
  'service_role',
  'INTERNAL_FN_SECRET',
  'QAI_WEBHOOK_SECRET',
  'SESSION_SECRET',
  'LOGIN_HASH_PEPPER',
  'GHL_PRIVATE_TOKEN',
  'GHL_RESEND_WEBHOOK_URL',
  'services.leadconnectorhq.com',
  'hooks.leadconnectorhq.com',
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`[check-bundle] ${DIST}/ not found — run the build first.`);
  process.exit(1);
}

const hits = [];
for (const file of files) {
  if (!/\.(js|mjs|css|html|map|json)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) hits.push({ file, needle });
  }
}

if (hits.length) {
  console.error('[check-bundle] FAILED — secrets leaked into the client bundle:');
  for (const h of hits) console.error(`  ${h.file}  ←  ${h.needle}`);
  console.error('\nCheck that no secret env var carries a VITE_ prefix. See PROGRESS.md 0.17.');
  process.exit(1);
}

console.log(`[check-bundle] OK — scanned ${files.length} files, no secrets found.`);
