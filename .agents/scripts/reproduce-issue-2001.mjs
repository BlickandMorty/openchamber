#!/usr/bin/env bun
/**
 * Reproduction script for issue #2001:
 * "Agent settings UI splits YAML frontmatter — description/temperature/steps silently lost"
 *
 * Demonstrates that parseMdFile regex fails on common file formatting,
 * causing non-UI-managed frontmatter fields to be silently lost.
 *
 * Run: bun run .agents/scripts/reproduce-issue-2001.mjs
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';

// ===================== Helpers (copies from shared.js) =====================

function parseMdFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }
  let frontmatter = {};
  try {
    frontmatter = yaml.parse(match[1]) || {};
  } catch {
    frontmatter = {};
  }
  return { frontmatter, body: match[2].trim() };
}

function writeMdFile(filePath, frontmatter, body) {
  const cleaned = Object.fromEntries(
    Object.entries(frontmatter).filter(([, v]) => v != null)
  );
  const yamlStr = yaml.stringify(cleaned);
  const content = `---\n${yamlStr}---\n\n${body}`;
  fs.writeFileSync(filePath, content, 'utf8');
}

// ===================== Simulation =====================

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2001-repro-'));
let allPassed = true;

// --- Test 1: parseMdFile edge cases ---
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  Test 1: parseMdFile regex edge cases                      ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

const testCases = [
  { name: 'BOM at start of file', content: '\uFEFF---\ndescription: foo\n---\n\nBody\n' },
  { name: 'Blank line before ---', content: '\n---\ndescription: foo\n---\n\nBody\n' },
  { name: 'Trailing spaces on closing ---', content: '---\ndescription: foo\n---   \nBody\n' },
  { name: 'Trailing spaces on closing --- (CRLF)', content: '---\ndescription: foo\n---   \r\nBody\n'.replace(/\n/g, '\r\n') },
];

let failures = 0;
for (const { name, content } of testCases) {
  const p = path.join(tmpDir, `test-${name.replace(/[^a-z]+/gi, '-')}.md`);
  fs.writeFileSync(p, content, 'utf8');
  const r = parseMdFile(p);
  const hasFrontmatter = Object.keys(r.frontmatter).length > 0;
  const status = hasFrontmatter ? 'OK' : 'FAIL';
  if (!hasFrontmatter) {
    failures++;
    console.log(`  ✗ ${name} → parse dropped frontmatter entirely`);
  } else {
    console.log(`  ✓ ${name} → frontmatter parsed correctly`);
  }
}

if (failures > 0) {
  console.log(`\n  → ${failures}/${testCases.length} cases cause parseMdFile to return empty frontmatter`);
  console.log('  → This is the trigger: when parse fails, original frontmatter is lost');
}

// --- Test 2: Simulate the exact save flow ---
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  Test 2: Simulate updateAgent with parse failure            ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Use the exact input from the issue
const inputContent = `---
description: My custom agent description
mode: all
model: some/model
temperature: 0.5
steps: 160
color: "#FF0000"
---

# Agent body
You are a helpful assistant.
`;

const agentPath = path.join(tmpDir, 'test-agent.md');

console.log('Input file:');
console.log(inputContent);

// === SCENARIO A: parse succeeds (clean file) ===
fs.writeFileSync(agentPath, inputContent, 'utf8');
const parsedOk = parseMdFile(agentPath);
let frontmatterKeysA = Object.keys(parsedOk.frontmatter);
console.log(`Scenario A (clean file): parse succeeded, ${frontmatterKeysA.length} frontmatter keys`);
console.log(`  Fields: ${frontmatterKeysA.join(', ')}`);

// Simulate updateAgent with the fields the UI sends
const updates = {
  mode: 'all',
  model: 'some/model',
  variant: null,
  temperature: 0.5,
  top_p: null,
  permission: { doom_loop: 'ask', external_directory: { '*': 'ask' } },
  prompt: '# Agent body\nYou are a helpful assistant.',
};

// Apply updates (simplified updateAgent logic)
let mdData = { frontmatter: { ...parsedOk.frontmatter }, body: parsedOk.body };
for (const [field, value] of Object.entries(updates)) {
  if (field === 'prompt') { mdData.body = String(value); continue; }
  if (field === 'permission') { mdData.frontmatter.permission = value; continue; }
  if (value === null) continue;
  mdData.frontmatter[field] = value;
}
writeMdFile(agentPath, mdData.frontmatter, mdData.body);

const outputA = fs.readFileSync(agentPath, 'utf8');
const blocksA = (outputA.match(/^---\r?\n[\s\S]*?\r?\n---/gm) || []).length;
const parsedA = parseMdFile(agentPath);
const missingA = ['description', 'steps', 'color'].filter(k => !(k in parsedA.frontmatter));

console.log(`  → Output: ${blocksA} frontmatter block(s)`);
console.log(`  → Fields preserved: ${Object.keys(parsedA.frontmatter).join(', ')}`);
if (missingA.length > 0) {
  console.log(`  ✗ DATA LOSS: ${missingA.join(', ')} missing`);
  allPassed = false;
} else {
  console.log(`  ✓ All original fields preserved`);
}

// === SCENARIO B: parse fails (trailing spaces on closing ---) ===
const inputWithTrailSpaces = `---
description: My custom agent description
mode: all
model: some/model
temperature: 0.5
steps: 160
color: "#FF0000"
---   
# Agent body
You are a helpful assistant.
`;

fs.writeFileSync(agentPath, inputWithTrailSpaces, 'utf8');
const parsedFail = parseMdFile(agentPath);
let frontmatterKeysB = Object.keys(parsedFail.frontmatter);
console.log(`\nScenario B (trailing spaces): parse ${frontmatterKeysB.length === 0 ? 'FAILED (empty frontmatter)' : 'succeeded'}`);

// Apply updates WITH prompt (normal flow)
mdData = { frontmatter: {}, body: parsedFail.body };
for (const [field, value] of Object.entries(updates)) {
  if (field === 'prompt') { mdData.body = String(value); continue; }
  if (field === 'permission') { mdData.frontmatter.permission = value; continue; }
  if (value === null) continue;
  mdData.frontmatter[field] = value;
}
writeMdFile(agentPath, mdData.frontmatter, mdData.body);

const outputB = fs.readFileSync(agentPath, 'utf8');
const blocksB = (outputB.match(/^---\r?\n[\s\S]*?\r?\n---/gm) || []).length;
const parsedB = parseMdFile(agentPath);
const missingB = ['description', 'steps', 'color'].filter(k => !(k in parsedB.frontmatter));

console.log(`  → Output: ${blocksB} frontmatter block(s)`);
console.log(`  → Fields preserved: ${Object.keys(parsedB.frontmatter).join(', ')}`);
if (missingB.length > 0) {
  console.log(`  ✗ DATA LOSS: ${missingB.join(', ')} missing`);
  allPassed = false;
  console.log(`\n  Output file (${blocksB} block(s)):`);
  console.log(outputB);
} else {
  console.log(`  ✓ All original fields preserved`);
}

// === SCENARIO C: parse fails AND prompt is NOT sent (double blocks) ===
fs.writeFileSync(agentPath, inputWithTrailSpaces, 'utf8');
const parsedFailC = parseMdFile(agentPath);

const updatesNoPrompt = {
  mode: 'all',
  model: 'some/model',
  temperature: 0.5,
  permission: { doom_loop: 'ask', external_directory: { '*': 'ask' } },
};

let mdDataC = { frontmatter: {}, body: parsedFailC.body };
for (const [field, value] of Object.entries(updatesNoPrompt)) {
  if (field === 'permission') { mdDataC.frontmatter.permission = value; continue; }
  if (value === null) continue;
  mdDataC.frontmatter[field] = value;
}
writeMdFile(agentPath, mdDataC.frontmatter, mdDataC.body);

const outputC = fs.readFileSync(agentPath, 'utf8');
const blocksC = (outputC.match(/^---\r?\n[\s\S]*?\r?\n---/gm) || []).length;
console.log(`\nScenario C (parse fail + no prompt update): ${blocksC} frontmatter block(s)`);
if (blocksC > 1) {
  console.log(`  ✓ BUG REPRODUCED: Multiple frontmatter blocks!`);
  console.log(`  This matches the exact output shown in the issue.\n`);
  console.log(outputC);
}

// ===================== Summary =====================
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  Summary                                                    ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');
console.log('Root cause: parseMdFile regex (/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n([\\s\\S]*)$/)');
console.log('fails when the file has:');
console.log('  • BOM at start');
console.log('  • Blank lines before ---');
console.log('  • Trailing whitespace after closing ---');
console.log('');
console.log('When parse fails, updateAgent builds a new frontmatter with only');
console.log('the UI-managed fields (mode, model, temperature, permission).');
console.log('Original frontmatter fields (description, steps, tools, color)');
console.log('are silently lost in the body overwrite.');
console.log('');
console.log('Fix approach: either make parseMdFile more robust (strip BOM,');
console.log('trim whitespace) or make updateAgent preserve the original');
console.log('file content when parse fails.');

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

process.exit(allPassed ? 0 : 1);
