#!/usr/bin/env node
// EPISTEMOS (perf doctrine §2.3/§4): gate the embed build's INITIAL payload —
// the gzipped JS+CSS that index.html loads before first paint — against the
// contract in Epistemos docs/perf-budgets.toml [agent_surface]
// pro_web_bundle_kb_max. Lazy-loaded chunks are excluded by design (the
// doctrine mandates code-split heavy panels; growing the eager set is the
// regression this script catches on every upstream merge).
//
// Usage: node scripts/check-embed-bundle-size.mjs [--max-kb 3500]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../packages/web/dist');
const indexHtmlPath = path.join(distDir, 'index.html');

const args = process.argv.slice(2);
const maxKbFlag = args.indexOf('--max-kb');
const maxKb = maxKbFlag !== -1 ? Number(args[maxKbFlag + 1]) : 3500;

if (!fs.existsSync(indexHtmlPath)) {
  console.error(`[bundle-gate] missing ${indexHtmlPath} — build the embed flavor first`);
  process.exit(2);
}

const html = fs.readFileSync(indexHtmlPath, 'utf8');
const assetRefs = new Set();
const patterns = [
  /<script[^>]+src="([^"]+)"/g,
  /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g,
  /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
];
for (const pattern of patterns) {
  for (const match of html.matchAll(pattern)) {
    const ref = match[1];
    if (ref.startsWith('http')) continue;
    assetRefs.add(ref.replace(/^\//, ''));
  }
}

let totalGzipBytes = 0;
const rows = [];
for (const ref of assetRefs) {
  const file = path.join(distDir, ref);
  if (!fs.existsSync(file)) continue;
  const gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
  totalGzipBytes += gz;
  rows.push({ ref, gzKb: gz / 1024 });
}

rows.sort((a, b) => b.gzKb - a.gzKb);
for (const row of rows) {
  console.log(`  ${row.gzKb.toFixed(1).padStart(8)} KB gz  ${row.ref}`);
}
const totalKb = totalGzipBytes / 1024;
console.log(`[bundle-gate] initial payload: ${totalKb.toFixed(1)} KB gz across ${rows.length} assets (budget ${maxKb} KB)`);

if (!Number.isFinite(maxKb) || maxKb <= 0) {
  console.error('[bundle-gate] invalid --max-kb');
  process.exit(2);
}
if (totalKb > maxKb) {
  console.error(`[bundle-gate] FAIL: initial payload exceeds the pro_web_bundle_kb_max contract`);
  process.exit(1);
}
console.log('[bundle-gate] PASS');
