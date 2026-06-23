import { beforeEach, describe, expect, test } from 'bun:test';
import { useSessionUIStore } from './session-ui-store';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

/**
 * Reproduction analysis for issue #1787.
 *
 * Bug: Clicking "+" on project A's folder while a blank draft from project B is
 * open does not update the folder label — it still shows B.
 *
 * These tests verify the store-level state transitions are CORRECT.
 * The draft's selectedProjectId and directoryOverride ARE properly updated.
 * All 4 tests pass, meaning the store data is correctly set.
 *
 * Root cause hypothesis: The bug is in the React rendering layer, not the store.
 * Likely candidates:
 *   - A stale closure in a memo'd component (SortableProjectItem, SessionGroupSection)
 *   - A useLayoutEffect in useProjectSessionSelection that interferes with draft state
 *   - useSyncExternalStore's synchronous re-renders between setActiveProjectIdOnly()
 *     and openNewSessionDraft() in the same click handler
 *
 * Key file: packages/ui/src/components/session/sidebar/hooks/useProjectSessionSelection.ts
 * The useLayoutEffect there fires when activeProjectId changes and can call
 * openNewSessionDraft() if newSessionDraftOpen is false at that moment.
 * With useSyncExternalStore's synchronous re-rendering in React 18, this effect
 * may fire BETWEEN setActiveProjectIdOnly() and the original openNewSessionDraft()
 * call, potentially racing the draft state.
 */

describe('Issue #1787 - openNewSessionDraft project context switching', () => {
  const projectA = {
    id: 'project-a',
    path: '/home/user/projects/a',
    label: 'Project A',
    lastOpenedAt: Date.now() - 1000,
  };

  const projectB = {
    id: 'project-b',
    path: '/home/user/projects/b',
    label: 'Project B',
    lastOpenedAt: Date.now() - 500,
  };

  beforeEach(() => {
    // Reset stores to clean state
    useSessionUIStore.setState({
      newSessionDraft: { open: false, directoryOverride: null, parentID: null },
      currentSessionId: null,
      currentSessionDirectory: null,
      availableWorktreesByProject: new Map(),
    });

    // Set up projects store with two projects, A is active
    useProjectsStore.setState({
      projects: [projectA, projectB],
      activeProjectId: projectA.id,
    });

    // Set up directory store to match project A
    useDirectoryStore.setState({
      currentDirectory: projectA.path,
    });

    // Mock localStorage for persistDraftTarget
    const store = {};
    globalThis.localStorage = {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => { store[key] = value; },
      removeItem: (key) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (index) => Object.keys(store)[index] ?? null,
    };
  });

  test('clicking "+" on B then A correctly updates draft project context', () => {
    // Verify initial state: user is on project A
    expect(useProjectsStore.getState().activeProjectId).toBe(projectA.id);
    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false);

    // Step 2: Click "+" on project B (simulates sidebar handler)
    useProjectsStore.getState().setActiveProjectIdOnly(projectB.id);
    useSessionUIStore.getState().openNewSessionDraft({
      directoryOverride: projectB.path,
    });

    let draft = useSessionUIStore.getState().newSessionDraft;
    expect(draft.open).toBe(true);
    expect(draft.selectedProjectId).toBe(projectB.id);
    expect(draft.directoryOverride).toBe(projectB.path);
    expect(useProjectsStore.getState().activeProjectId).toBe(projectB.id);
    expect(useDirectoryStore.getState().currentDirectory).toBe(projectB.path);

    // Step 3: Without typing, click "+" on project A
    useProjectsStore.getState().setActiveProjectIdOnly(projectA.id);
    useSessionUIStore.getState().openNewSessionDraft({
      directoryOverride: projectA.path,
    });

    draft = useSessionUIStore.getState().newSessionDraft;
    expect(draft.open).toBe(true);
    expect(draft.selectedProjectId).toBe(projectA.id);
    expect(draft.directoryOverride).toBe(projectA.path);
    expect(useProjectsStore.getState().activeProjectId).toBe(projectA.id);
    expect(useDirectoryStore.getState().currentDirectory).toBe(projectA.path);
  });

  test('folder-level "+" with targetFolderId correctly switches project context', () => {
    // Simulates the folder-level "+" in SessionGroupSection
    useProjectsStore.getState().setActiveProjectIdOnly(projectB.id);
    useSessionUIStore.getState().openNewSessionDraft({
      directoryOverride: projectB.path,
      targetFolderId: 'folder-1',
    });

    let draft = useSessionUIStore.getState().newSessionDraft;
    expect(draft.selectedProjectId).toBe(projectB.id);
    expect(draft.targetFolderId).toBe('folder-1');

    useProjectsStore.getState().setActiveProjectIdOnly(projectA.id);
    useSessionUIStore.getState().openNewSessionDraft({
      directoryOverride: projectA.path,
      targetFolderId: 'folder-2',
    });

    draft = useSessionUIStore.getState().newSessionDraft;
    expect(draft.selectedProjectId).toBe(projectA.id);
    expect(draft.directoryOverride).toBe(projectA.path);
    expect(draft.targetFolderId).toBe('folder-2');
  });

  test('openNewSessionDraft infers project from directoryOverride alone', () => {
    // Without setActiveProjectIdOnly, openNewSessionDraft should infer project from directory
    useSessionUIStore.getState().openNewSessionDraft({
      directoryOverride: projectB.path,
    });

    let draft = useSessionUIStore.getState().newSessionDraft;
    expect(draft.selectedProjectId).toBe(projectB.id);

    useSessionUIStore.getState().openNewSessionDraft({
      directoryOverride: projectA.path,
    });

    draft = useSessionUIStore.getState().newSessionDraft;
    expect(draft.selectedProjectId).toBe(projectA.id);
  });

  test('directory store stays in sync through sequential switches', () => {
    useProjectsStore.getState().setActiveProjectIdOnly(projectB.id);
    useSessionUIStore.getState().openNewSessionDraft({ directoryOverride: projectB.path });
    expect(useDirectoryStore.getState().currentDirectory).toBe(projectB.path);

    useProjectsStore.getState().setActiveProjectIdOnly(projectA.id);
    useSessionUIStore.getState().openNewSessionDraft({ directoryOverride: projectA.path });
    expect(useDirectoryStore.getState().currentDirectory).toBe(projectA.path);

    // Switch back to B
    useProjectsStore.getState().setActiveProjectIdOnly(projectB.id);
    useSessionUIStore.getState().openNewSessionDraft({ directoryOverride: projectB.path });
    expect(useDirectoryStore.getState().currentDirectory).toBe(projectB.path);
  });
});
