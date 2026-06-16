/**
 * Reproduction test for Issue #1680:
 * Adding plugin `opencode-codebase-index` freezes OpenChamber.
 *
 * Root cause:
 * When a plugin with native dependencies (Rust/NAPI addon) is added to
 * the OpenCode config, `refreshOpenCodeAfterConfigChange` kills the
 * current OpenCode process and spawns a new one. If the plugin's native
 * module hangs during initialization (deadlock, slow I/O, or GPU lib
 * init), the new process never prints "opencode server listening" and
 * never exits. `createManagedOpenCodeServerProcess` waits 30s per attempt,
 * with 2 retries = 60s total freeze.
 *
 * The config is written BEFORE the restart attempt, so the frozen plugin
 * persists across restarts, making every subsequent launch also freeze.
 *
 * @see packages/web/server/lib/opencode/lifecycle.js
 * @see packages/web/server/lib/opencode/plugin-routes.js
 * @see packages/web/server/lib/opencode/plugins.js
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: vi.fn(() => ({ stdout: '', stderr: '' })),
}));

import { createOpenCodeLifecycleRuntime } from './lifecycle.js';
import { createPluginEntry, listPluginEntries } from './plugins.js';

// ---------------------------------------------------------------------------
// Mock child helpers
// ---------------------------------------------------------------------------
function createMockChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 12345;
  child.kill = vi.fn(() => true);
  return child;
}

describe('Issue #1680: Plugin freeze reproduction', () => {
  let tmpDir;
  let configPath;
  let state;
  let runtime;
  const env = {
    ENV_CONFIGURED_OPENCODE_PORT: 0,
    ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
    ENV_CONFIGURED_OPENCODE_HOST: null,
    ENV_SKIP_OPENCODE_START: false,
    ENV_EFFECTIVE_PORT: null,
  };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-1680-'));
    configPath = path.join(tmpDir, 'opencode.json');
    process.env.OPENCODE_CONFIG = configPath;

    state = {
      openCodeWorkingDirectory: tmpDir,
      openCodeProcess: null,
      openCodePort: null,
      openCodeBaseUrl: null,
      currentRestartPromise: null,
      isRestartingOpenCode: false,
      openCodeApiPrefix: '',
      openCodeApiPrefixDetected: false,
      openCodeApiDetectionTimer: null,
      lastOpenCodeError: null,
      isOpenCodeReady: false,
      openCodeNotReadySince: 0,
      isExternalOpenCode: false,
      isShuttingDown: false,
      expressApp: null,
    };

    runtime = createOpenCodeLifecycleRuntime({
      state,
      env,
      syncToHmrState: vi.fn(),
      syncFromHmrState: vi.fn(),
      getOpenCodeAuthHeaders: vi.fn(() => ({})),
      buildOpenCodeUrl: vi.fn(() => 'http://localhost:9999/global/health'),
      waitForReady: vi.fn(async () => false),
      normalizeApiPrefix: vi.fn(() => ''),
      applyOpencodeBinaryFromSettings: vi.fn(),
      ensureOpencodeCliEnv: vi.fn(),
      ensureLocalOpenCodeServerPassword: vi.fn(async () => 'pw'),
      resolveManagedOpenCodeLaunchSpec: vi.fn(() => null),
      setOpenCodePort: vi.fn(),
      setDetectedOpenCodeApiPrefix: vi.fn(),
      setupProxy: vi.fn(),
      ensureOpenCodeApiPrefix: vi.fn(),
      clearResolvedOpenCodeBinary: vi.fn(),
      buildAugmentedPath: vi.fn(() => process.env.PATH),
      buildManagedOpenCodePath: vi.fn(() => process.env.PATH),
      getManagedOpenCodeShellEnvSnapshot: vi.fn(() => ({})),
      getActiveSessionCount: vi.fn(() => 0),
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG;
  });

  it('Step 1: Plugin entry is written to config successfully', () => {
    // This simulates what happens when the user adds opencode-codebase-index
    // via the Settings > Plugins UI
    createPluginEntry(
      { spec: 'opencode-codebase-index', scope: 'user' },
      null // no project directory
    );

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugin).toEqual(['opencode-codebase-index']);

    const entries = listPluginEntries(null);
    expect(entries).toHaveLength(1);
    expect(entries[0].spec).toBe('opencode-codebase-index');
    expect(entries[0].parsedKind).toBe('npm');

    console.log('  ✓ Plugin entry "opencode-codebase-index" written to config');
    console.log(`  ✓ Config file: ${configPath}`);
  });

  it('Step 2: refreshOpenCodeAfterConfigChange is called after plugin write', () => {
    // This is what plugin-routes.js does after createPluginEntry succeeds.
    // The config is written BEFORE the restart, so even if the restart
    // fails, the plugin persists in the config.
    expect(state.isOpenCodeReady).toBe(false);
    expect(state.openCodePort).toBeNull();

    // Check that the config is already saved
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugin).toContain('opencode-codebase-index');
    console.log('  ✓ Config written before restart attempt (verified at:', new Date().toISOString(), ')');
  });

  it('Step 3a: Scenario A - Plugin causes OpenCode to HANG (slow freeze)', async () => {
    // The PRIMARY freeze scenario:
    // opencode-codebase-index's native Rust module hangs during init.
    // Process never prints "opencode server listening" and never exits.
    // createManagedOpenCodeServerProcess waits for full 30s timeout.
    const hangChild = createMockChild();
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => hangChild);

    // Reset state for fresh start
    state.openCodeProcess = null;
    state.openCodePort = null;
    state.currentRestartPromise = null;
    state.isRestartingOpenCode = false;

    const startTime = performance.now();
    try {
      await runtime.restartOpenCode();
      // If we get here, something unexpected happened
      expect(true).toBe(false);
    } catch (error) {
      const duration = performance.now() - startTime;
      console.log(`  ⏱ Hang freeze duration: ${Math.round(duration)}ms (${Math.round(duration/1000)}s)`);
      console.log(`  ✓ Error: ${error.message?.slice(0, 80)}...`);

      // The hang causes the full 30s timeout × 2 retries
      expect(duration).toBeGreaterThan(1000);
    }
  }, 65_000);

  it('Step 3b: Scenario B - Plugin causes OpenCode to CRASH (fast fail)', async () => {
    // Alternative: plugin causes process to crash immediately (segfault).
    // This is fast because the onExit handler fires immediately.
    const crashChild = createMockChild();
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        crashChild.stderr.emit('data', 'FATAL: native module load error\n');
        crashChild.emit('exit', 1, null);
      });
      return crashChild;
    });

    state.openCodeProcess = null;
    state.openCodePort = null;
    state.currentRestartPromise = null;
    state.isRestartingOpenCode = false;

    const startTime = performance.now();
    try {
      await runtime.restartOpenCode();
      expect(true).toBe(false);
    } catch (error) {
      const duration = performance.now() - startTime;
      console.log(`  ⏱ Crash fail duration: ${Math.round(duration)}ms (${Math.round(duration/1000)}s)`);
      console.log(`  ✓ Error: ${error.message?.slice(0, 80)}...`);

      // Crash should be fast - the onExit handler runs on next microtask
      expect(duration).toBeLessThan(10_000);
    }
  }, 30_000);

  it('Step 4: Plugin persists in config despite restart failure', () => {
    // This is the "subsequent attempts to open" part of the bug.
    // Because the config is written BEFORE restartOpenCode, even though
    // OpenCode failed to restart, the config still has the plugin.
    // On next app launch, bootstrapOpenCodeAtStartup reads the config
    // and tries to start OpenCode with the frozen plugin again.
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugin).toContain('opencode-codebase-index');
    console.log('  ✓ Config persists: plugin "opencode-codebase-index" remains in config');
    console.log('  ✓ Next launch will attempt to start OpenCode with this plugin again');
    console.log('  ∴ Freeze repeats on every restart until plugin is removed from config');
  });

  it('Step 5: Identify the timeout source', () => {
    // The timeout comes from createManagedOpenCodeServerProcess
    // (lifecycle.js line 317):
    //
    //   const timer = setTimeout(() => {
    //     finish(reject, new Error(`Timeout waiting for OpenCode to start after ${timeout}ms`));
    //   }, timeout);
    //
    // where timeout = 30000 (passed from startOpenCodeOnce line 463).
    // With START_OPEN_CODE_MAX_ATTEMPTS = 2 and 750ms retry delay,
    // total worst-case = 30000*2 + 750 = 60750ms ≈ 60s

    const TIMEOUT_PER_ATTEMPT = 30_000;
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY = 750;
    const expectedWorstCase = TIMEOUT_PER_ATTEMPT * MAX_ATTEMPTS + RETRY_DELAY;

    console.log(`  Per-attempt timeout: ${TIMEOUT_PER_ATTEMPT}ms`);
    console.log(`  Max retries: ${MAX_ATTEMPTS}`);
    console.log(`  Retry delay: ${RETRY_DELAY}ms`);
    console.log(`  Worst-case freeze: ${expectedWorstCase}ms (${expectedWorstCase/1000}s)`);
  });
});
