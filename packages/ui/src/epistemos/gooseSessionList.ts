// EPISTEMOS overlay (Plan 1-PRO §3): goose rows for the merged global session
// list. goosed has no session-list endpoint — the adapter-owned index is the
// source of truth (Plan §10.1); rows hydrate lazily via getSession when opened.
// Directory grouping only, no branch/worktree — capability truth (§0.6).

import type { GlobalSessionRecord } from '@/stores/globalSessions';
import { gooseEngineClient } from '@/epistemos/gooseClient';
import { gooseSessionToSdkSession } from '@/epistemos/gooseSdkMapping';

export const listGooseGlobalSessionRecords = (options: {
    directory?: string;
    archived: boolean;
}): GlobalSessionRecord[] => {
    // The adapter index has no archive concept — goose rows live in the
    // active list only.
    if (options.archived) return [];
    return gooseEngineClient
        .listIndexedSessions()
        .filter((entry) => !options.directory || entry.workingDir === options.directory)
        .map((entry) => ({
            ...gooseSessionToSdkSession(undefined, entry),
            project: entry.workingDir
                ? { id: `goose:${entry.workingDir}`, name: entry.workingDir.split('/').pop() || entry.workingDir }
                : null,
        }));
};
