/**
 * Reproduction test for Issue #1989: Worktrees created by OpenCode don't appear in sidebar
 *
 * Three bugs compound into the visible symptom:
 *
 * Bug 1: `worktrees.length === 0` skip — projects with zero worktrees are not added
 *        to the Map. The store is then OVERWRITTEN with that Map, wiping any
 *        previously-discovered worktrees for those projects from the store and
 *        from localStorage persistence.
 *
 * Bug 2: `discoveredProjectsRef` guards re-discovery by project-set identity.
 *        After attaching, creating, or removing a worktree, the sidebar never
 *        re-runs discovery unless the project list itself changes.
 *
 * Bug 3: If `listProjectWorktrees` throws, the catch silently skips that project
 *        without adding anything to the Map. The store is overwritten with the
 *        partial Map, losing previously-persisted worktree entries for the
 *        failed project.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { WorktreeMetadata } from '@/types/worktree';

// ---------- mock helpers ----------

const listCalls: string[] = [];
const sessionStore = {
  availableWorktreesByProject: new Map<string, WorktreeMetadata[]>(),
  availableWorktrees: [] as WorktreeMetadata[],
};

// Track setState calls to inspect overwrites
const setStateCalls: Array<Record<string, unknown>> = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gitMock: Record<string, any> = {
  worktree: {
    list: mock((directory: string) => {
      listCalls.push(directory);
      return Promise.resolve([]);
    }),
    create: mock(() => Promise.resolve({})),
    remove: mock(() => Promise.resolve({ success: true })),
  },
};

mock.module('@/lib/openchamberConfig', () => ({
  substituteCommandVariables: (command: string) => command,
}));

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  clearWorktreeBootstrapState: mock(),
  markWorktreeBootstrapPending: mock(),
  setWorktreeBootstrapState: mock(),
  startWorktreeBootstrapWatcher: mock(),
}));

mock.module('@/lib/worktrees/worktreeStatus', () => ({
  invalidateResolvedProjectRootCache: mock(),
  resolveProjectRoot: (directory: string) => Promise.resolve(directory),
}));

mock.module('@/lib/gitApi', () => ({
  checkIsGitRepository: () => Promise.resolve(true),
  deleteRemoteBranch: mock(),
  git: gitMock,
}));

// We re-mock per test via beforeEach
let currentMock: typeof sessionStore = sessionStore;

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => currentMock,
    setState: (patch: Partial<typeof currentMock> | ((state: typeof currentMock) => Partial<typeof currentMock>)) => {
      const next = typeof patch === 'function' ? patch(currentMock) : patch;
      setStateCalls.push({ ...next });
      Object.assign(currentMock, next);
    },
  },
}));

// ---------- the actual discovery logic (extracted from SessionSidebar.tsx:429-475) ----------
interface ProjectEntry {
  id: string;
  path: string;
}

// This is the EXACT pattern from SessionSidebar.tsx (lines 429-475)
async function discoverWorktreesBug1(projectEntries: ProjectEntry[]): Promise<void> {
  const worktreesByProject = new Map<string, WorktreeMetadata[]>();
  const allWorktrees: WorktreeMetadata[] = [];

  for (const project of projectEntries) {
    const projectPath = project.path.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!projectPath) continue;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const isGitRepo = true; // assume it's a git repo for the test

    try {
      const { listProjectWorktrees } = await import('./worktreeManager');
      const worktrees = await listProjectWorktrees({ id: project.id, path: projectPath });
      // BUG 1: if (cancelled || worktrees.length === 0) continue;
      //        (this exact line is at SessionSidebar.tsx:460, ElectronMiniChatApp.tsx:188, MobileApp.tsx:2058)
      if (worktrees.length === 0) continue; // <--- THIS IS BUG 1
      worktreesByProject.set(projectPath, worktrees);
      allWorktrees.push(...worktrees);
    } catch {
      // BUG 3: silently skip — project not added to map, store overwritten
      //        (SessionSidebar.tsx:463-465)
    }
  }

  // Store is COMPLETELY OVERWRITTEN (SessionSidebar.tsx:472-475, ElectronMiniChatApp.tsx:197-200, MobileApp.tsx:2068-2071)
  const store = await import('@/sync/session-ui-store').then(m => m.useSessionUIStore);
  store.setState({
    availableWorktrees: allWorktrees,
    availableWorktreesByProject: worktreesByProject,
  });
}

describe('Issue #1989 — worktree discovery bugs reproduction', () => {
  beforeEach(async () => {
    listCalls.length = 0;
    setStateCalls.length = 0;
    currentMock = {
      availableWorktreesByProject: new Map<string, WorktreeMetadata[]>(),
      availableWorktrees: [] as WorktreeMetadata[],
    };
    sessionStore.availableWorktreesByProject = new Map();
    sessionStore.availableWorktrees = [];

    // Reset list mock to return empty by default
    gitMock.worktree.list = mock(() => Promise.resolve([]));
  });

  // ==============================================================
  // BUG 1: `worktrees.length === 0` skip wipes store data
  // ==============================================================
  test('BUG 1: discovery with empty worktrees wipes previously-discovered worktrees from store', async () => {
    // Arrange: store already has worktrees for two projects (e.g., from a previous successful discovery)
    const existingFeaturedWorktrees: WorktreeMetadata[] = [
      {
        source: 'sdk',
        name: 'feature-x',
        path: '/repo/../feature-x',
        projectDirectory: '/repo',
        branch: 'feature-x',
        label: 'feature-x',
        worktreeRoot: '/repo/feature-x',
        worktreeStatus: 'ready',
        headState: 'branch',
        worktreeSource: 'created-for-session',
      },
    ];
    const existingBugfixWorktrees: WorktreeMetadata[] = [
      {
        source: 'sdk',
        name: 'bugfix-123',
        path: '/repo/../bugfix-123',
        projectDirectory: '/repo',
        branch: 'bugfix-123',
        label: 'bugfix-123',
        worktreeRoot: '/repo/bugfix-123',
        worktreeStatus: 'ready',
        headState: 'branch',
        worktreeSource: 'created-for-session',
      },
    ];

    const storedMap = new Map<string, WorktreeMetadata[]>();
    storedMap.set('/repo/feature-x', existingFeaturedWorktrees);
    storedMap.set('/repo/bugfix-123', existingBugfixWorktrees);
    currentMock.availableWorktreesByProject = storedMap;
    currentMock.availableWorktrees = [...existingFeaturedWorktrees, ...existingBugfixWorktrees];

    // Act: run discovery for the same projects but worktrees come back empty
    // (e.g., server not ready, or git worktree list returns nothing)
    const projects: ProjectEntry[] = [
      { id: 'project-1', path: '/repo/feature-x' },
      { id: 'project-2', path: '/repo/bugfix-123' },
    ];

    await discoverWorktreesBug1(projects);

    // Assert: store should have preserved the existing worktrees
    // But due to BUG 1 + overwrite, both projects are missing from the map
    const result = currentMock.availableWorktreesByProject;
    // DEMONSTRATING THE BUG: both projects that had worktrees are now gone
    // because `worktrees.length === 0` skipped them and the store was overwritten
    expect(result.size).toBe(0); // <--- BUG: should be 2 but is 0
    expect(currentMock.availableWorktrees.length).toBe(0); // <--- BUG: should be 2 but is 0
    console.log('[BUG 1] Store overwritten: previously-discovered worktrees are gone.');
    console.log(`  Expected 2 project entries, got ${result.size}`);
    console.log(`  Expected 2 worktrees, got ${currentMock.availableWorktrees.length}`);
  });

  test('BUG 1: worktrees for a newly-added project with no worktrees skip its entry entirely', async () => {
    // Arrange: store has data for project A, but project B is new and has no worktrees
    const existingWorktrees: WorktreeMetadata[] = [
      {
        source: 'sdk',
        name: 'feature',
        path: '/repo/../feature',
        projectDirectory: '/repo',
        branch: 'feature',
        label: 'feature',
        worktreeRoot: '/repo/feature',
        worktreeStatus: 'ready',
        headState: 'branch',
        worktreeSource: 'created-for-session',
      },
    ];
    const storedMap = new Map<string, WorktreeMetadata[]>();
    storedMap.set('/repo', existingWorktrees);
    currentMock.availableWorktreesByProject = storedMap;
    currentMock.availableWorktrees = [...existingWorktrees];

    // Act: discovery runs for both projects, project B has 0 worktrees
    const projects: ProjectEntry[] = [
      { id: 'project-1', path: '/repo' },         // has 1 worktree
      { id: 'project-2', path: '/other-repo' },   // has 0 worktrees
    ];

    gitMock.worktree.list = mock((dir: string) => {
      if (dir === '/repo') return Promise.resolve([
        { name: 'feature', branch: 'feature', path: '/repo/feature' },
      ]);
      return Promise.resolve([]);
    });

    await discoverWorktreesBug1(projects);

    // BUG: project A is still in the map (good), but project B is absent
    // This means the store was overwritten and only project A's entry survived
    const result = currentMock.availableWorktreesByProject;
    expect(result.has('/repo')).toBe(true);
    expect(result.has('/other-repo')).toBe(false);
    // The real problem: if project A previously had worktrees but now returns
    // empty on re-discovery, its entry would also disappear
  });

  // ==============================================================
  // BUG 2: No re-discovery after mutations
  // ==============================================================
  test('BUG 2: discoveredProjectsRef prevents re-discovery when project list is unchanged', () => {
    // This simulates the `discoveredProjectsRef` guard in SessionSidebar.tsx:479
    // `if (discoveredProjectsRef.current === projectWorktreeDiscoveryKey) return;`

    const projects: ProjectEntry[] = [
      { id: 'project-1', path: '/repo' },
    ];

    // The discovery key is built from project IDs + paths (SessionSidebar.tsx:406-411)
    const buildDiscoveryKey = (entries: ProjectEntry[]) =>
      entries.map((p) => `${p.id}:${p.path.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''}`).join('|');

    const key1 = buildDiscoveryKey(projects);
    const discoveredProjectsRef = { current: '' };

    // First call: discovery runs
    if (discoveredProjectsRef.current !== key1) {
      discoveredProjectsRef.current = key1;
      // discovery runs...
    }
    expect(discoveredProjectsRef.current).toBe(key1);

    // Second call with same project list: discovery is SKIPPED
    const key2 = buildDiscoveryKey(projects);
    let discoveryRan = false;
    if (discoveredProjectsRef.current !== key2) {
      discoveryRan = true; // would not reach here
    }

    // BUG: even though a worktree was created externally since the last discovery,
    // discovery is skipped because the project set is unchanged
    expect(discoveryRan).toBe(false);
    console.log('[BUG 2] Re-discovery skipped: project list unchanged, new worktree not discovered.');

    // FIX: Remove discoveredProjectsRef guard and use epoch-based invalidation instead
  });

  // ==============================================================
  // BUG 3: Failed discovery destroys existing data
  // ==============================================================
  test('BUG 3: discovery error for one project loses all its worktrees from store', async () => {
    // Arrange: store has worktrees for project A and project B
    const existingWorktreesA: WorktreeMetadata[] = [
      {
        source: 'sdk',
        name: 'feature-a',
        path: '/repo-a/../feature-a',
        projectDirectory: '/repo-a',
        branch: 'feature-a',
        label: 'feature-a',
        worktreeRoot: '/repo-a/feature-a',
        worktreeStatus: 'ready',
        headState: 'branch',
        worktreeSource: 'created-for-session',
      },
    ];
    const existingWorktreesB: WorktreeMetadata[] = [
      {
        source: 'sdk',
        name: 'feature-b',
        path: '/repo-b/../feature-b',
        projectDirectory: '/repo-b',
        branch: 'feature-b',
        label: 'feature-b',
        worktreeRoot: '/repo-b/feature-b',
        worktreeStatus: 'ready',
        headState: 'branch',
        worktreeSource: 'created-for-session',
      },
    ];

    const storedMap = new Map<string, WorktreeMetadata[]>();
    storedMap.set('/repo-a', existingWorktreesA);
    storedMap.set('/repo-b', existingWorktreesB);
    currentMock.availableWorktreesByProject = storedMap;
    currentMock.availableWorktrees = [...existingWorktreesA, ...existingWorktreesB];

    // Act: discovery runs — project B's listProjectWorktrees throws
    const projects: ProjectEntry[] = [
      { id: 'project-1', path: '/repo-a' },
      { id: 'project-2', path: '/repo-b' },
    ];

    // Make project B throw (listProjectWorktrees will re-throw since git.worktree.list rejects)
    gitMock.worktree.list = mock((dir: string) => {
      if (dir === '/repo-b') return Promise.reject(new Error('git worktree list failed'));
      return Promise.resolve([
        { name: 'feature-a', branch: 'feature-a', path: '/repo-a/feature-a' },
      ]);
    });

    await discoverWorktreesBug1(projects);

    // BUG: project A's worktrees are preserved (good), but project B's entry
    // is gone from the store even though it was there before
    const result = currentMock.availableWorktreesByProject;
    expect(result.has('/repo-a')).toBe(true);
    expect(result.has('/repo-b')).toBe(false); // <--- BUG: should still have project B's data
    console.log('[BUG 3] Project B worktrees lost from store after discovery error.');
    console.log(`  Project B in store: ${result.has('/repo-b')} (expected: true)`);
  });

  // ==============================================================
  // Cumulative: all three bugs together produce the visible symptom
  // ==============================================================
  test('CUMULATIVE: worktree created externally never appears in sidebar', async () => {
    // This simulates the full scenario:
    // 1. Initial discovery finds worktree in project A
    // 2. User (or OpenCode) creates a new worktree externally (git worktree add)
    // 3. Sidbar re-renders but discoveredProjectsRef prevents re-discovery
    // 4. Even if re-discovery ran, the create was not via worktreeManager,
    //    so the store is never updated directly

    // Arrange: initial discovery found 1 worktree for project A
    const initialWorktrees: WorktreeMetadata[] = [
      {
        source: 'sdk',
        name: 'initial',
        path: '/repo/../initial',
        projectDirectory: '/repo',
        branch: 'initial',
        label: 'initial',
        worktreeRoot: '/repo/initial',
        worktreeStatus: 'ready',
        headState: 'branch',
        worktreeSource: 'created-for-session',
      },
    ];
    const initialMap = new Map<string, WorktreeMetadata[]>();
    initialMap.set('/repo', initialWorktrees);
    currentMock.availableWorktreesByProject = initialMap;
    currentMock.availableWorktrees = [...initialWorktrees];

    // Now a new worktree is created externally (e.g., via `git worktree add` in terminal)
    // or via OpenCode. The worktreeManager.createWorktree is NOT called,
    // so the store is NOT updated directly.

    // Store the current discovery key (simulating discoveredProjectsRef)
    const projects: ProjectEntry[] = [{ id: 'project-1', path: '/repo' }];
    const buildDiscoveryKey = (entries: ProjectEntry[]) =>
      entries.map((p) => `${p.id}:${p.path.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''}`).join('|');
    const discoveredProjectsRef = { current: buildDiscoveryKey(projects) };

    // Sidebar re-renders but the project set is the same, so discovery is skipped
    const newKey = buildDiscoveryKey(projects);
    let discoveryWouldRun = false;
    if (discoveredProjectsRef.current !== newKey) {
      discoveryWouldRun = true;
    }

    expect(discoveryWouldRun).toBe(false); // <--- BUG: re-discovery is skipped

    // Even if we forced re-discovery, the git worktree list would return the new worktree
    // But since we skipped it, the new worktree is invisible
    const result = currentMock.availableWorktreesByProject;
    const worktreesForRepo = result.get('/repo') ?? [];
    expect(worktreesForRepo.length).toBe(1); // <--- should be 2 but re-discovery never ran
    console.log('[CUMULATIVE] Externally-created worktree never appears in sidebar.');
    console.log(`  Worktrees found: ${worktreesForRepo.length} (expected: 2)`);
    console.log(`  Re-discovery ran: ${discoveryWouldRun} (expected: true — but blocked by discoveredProjectsRef)`);
  });
});
