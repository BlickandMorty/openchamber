#!/usr/bin/env node

/**
 * Reproduction script for issue #1725:
 * `openchamber startup enable` fails on Windows because schtasks /TR
 * argument exceeds the 261-character limit.
 *
 * This script replicates the logic in packages/web/bin/cli.js
 * `enableStartupService()` (lines 2270-2285) and measures the /TR
 * argument length to verify it exceeds schtasks' documented 261-character
 * limit.
 */

const path = require('path');

// Replicate the quoting functions from cli.js
function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function resolveCliEntrypoint() {
  // Simulate what happens with a typical Windows install
  return path.resolve(
    'C:\\Users\\user\\node_modules\\@openchamber\\web\\bin\\cli.js'
  );
}

function buildStartupArgs(options = {}) {
  const args = [
    resolveCliEntrypoint(),
    'serve',
    '--foreground',
    '--port',
    String(options.port || 3000),
  ];
  if (typeof options.host === 'string' && options.host.length > 0) {
    args.push('--host', options.host);
  }
  if (options.apiOnly === true) {
    args.push('--api-only');
  }
  return args;
}

function getDataDir() {
  const dataDir = process.env.OPENCHAMBER_DATA_DIR;
  if (dataDir) return path.resolve(dataDir);
  const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\user';
  return path.join(home, '.config', 'openchamber');
}

function getStartupEnvFilePath() {
  return path.join(getDataDir(), 'startup.env');
}

function simulateWindowsStartupTask(options = {}) {
  const envFilePath = getStartupEnvFilePath();
  const startupArgs = buildStartupArgs(options)
    .map(powershellQuote)
    .join(', ');
  const powerShellCommand = [
    `$envFile=${powershellQuote(envFilePath)}`,
    `if (Test-Path $envFile) { Get-Content $envFile | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { $v=\$matches[2]; if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v=\$v.Substring(1,\$v.Length-2).Replace("'\\''","'") }; [Environment]::SetEnvironmentVariable(\$matches[1], \$v, 'Process') } } }`,
    `& ${powershellQuote(process.execPath)} ${startupArgs}`,
  ].join('; ');
  const taskArgs = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${powerShellCommand.replace(/"/g, '\\"')}"`;
  return taskArgs;
}

// --- Main reproduction ---

const limit = 261;

// Scenario 1: Typical install (node in Program Files, user in home directory)
console.log('=== Scenario 1: Typical Windows Install ===');
const taskArgs1 = simulateWindowsStartupTask();
console.log(`/TR value length: ${taskArgs1.length}`);
console.log(`Limit: ${limit}`);
console.log(`Exceeds limit: ${taskArgs1.length > limit ? 'YES — Bug reproduced!' : 'NO'}`);
console.log(`(Truncated) /TR = ${taskArgs1.substring(0, 200)}...`);
console.log('');

// Scenario 2: With a custom host (adds more characters)
console.log('=== Scenario 2: With --host flag ===');
const taskArgs2 = simulateWindowsStartupTask({ host: '0.0.0.0' });
console.log(`/TR value length: ${taskArgs2.length}`);
console.log(`Exceeds limit: ${taskArgs2.length > limit ? 'YES' : 'NO'}`);
console.log('');

// Measure the component parts
console.log('=== Component lengths ===');
const envFilePathLen = getStartupEnvFilePath().length;
console.log(`envFilePath (${getStartupEnvFilePath()}): ${envFilePathLen}`);

const entrypointLen = resolveCliEntrypoint().length;
console.log(`cli entrypoint (${resolveCliEntrypoint()}): ${entrypointLen}`);

const execPathLen = process.execPath.length;
console.log(`process.execPath (${process.execPath}): ${execPathLen}`);

console.log('');
console.log('=== Summary ===');
console.log(
  `The /TR argument consistently exceeds the ${limit}-character schtasks limit ` +
  `on realistic Windows installs. The inlined PowerShell script + long paths ` +
  `(node.exe in Program Files, cli.js in user profile, startup.env in config ` +
  `dir) produce a command string of ${taskArgs1.length} chars — well over the limit.`
);
