import React from 'react';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useGitStore } from '@/stores/useGitStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';

type Project = { id: string; path: string; normalizedPath: string };

type Args = {
  normalizedProjects: Project[];
  gitRepoStatus: Map<string, { isGitRepo: boolean | null; branch: string | null }>;
  setProjectRepoStatus: React.Dispatch<React.SetStateAction<Map<string, boolean | null>>>;
  setProjectRootBranches: React.Dispatch<React.SetStateAction<Map<string, string>>>;
};

export const useProjectRepoStatus = (args: Args): void => {
  const {
    normalizedProjects,
    gitRepoStatus,
    setProjectRepoStatus,
    setProjectRootBranches,
  } = args;

  const { git } = useRuntimeAPIs();
  const ensureStatus = useGitStore((state) => state.ensureStatus);

  // Derive repo status from centralized Git store
  React.useEffect(() => {
    if (!git || normalizedProjects.length === 0) {
      setProjectRepoStatus(new Map());
      return;
    }

    // Trigger ensureStatus for each project to populate store
    normalizedProjects.forEach((project) => {
      void ensureStatus(project.normalizedPath, git);
    });
  }, [normalizedProjects, git, ensureStatus, setProjectRepoStatus]);

  // Read isGitRepo from the store-populated state
  React.useEffect(() => {
    const next = new Map<string, boolean | null>();
    normalizedProjects.forEach((project) => {
      next.set(project.id, gitRepoStatus.get(project.normalizedPath)?.isGitRepo ?? null);
    });
    setProjectRepoStatus(next);
  }, [normalizedProjects, gitRepoStatus, setProjectRepoStatus]);

  const projectGitBranchesKey = React.useMemo(() => {
    return normalizedProjects
      .map((project) => {
        const branch = gitRepoStatus.get(project.normalizedPath)?.branch ?? '';
        return `${project.id}:${branch}`;
      })
      .join('|');
  }, [normalizedProjects, gitRepoStatus]);

  // Tracks the input branch we last resolved a root branch against, per project.
  // Used to resolve `getRootBranch` only for projects that are new or whose
  // branch actually changed — rather than re-resolving every project whenever
  // any single project's branch settles (the old N² cascade).
  const resolvedInputByProjectId = React.useRef<Map<string, string>>(new Map());

  React.useEffect(() => {
    let cancelled = false;

    // Debounce so the initial burst of per-project `ensureStatus` updates
    // settles into a single resolution pass instead of one pass per project.
    const timer = setTimeout(() => {
      const run = async () => {
        const validIds = new Set(normalizedProjects.map((project) => project.id));
        // Drop bookkeeping for projects that are no longer present.
        for (const id of resolvedInputByProjectId.current.keys()) {
          if (!validIds.has(id)) {
            resolvedInputByProjectId.current.delete(id);
          }
        }

        const pending = normalizedProjects.filter((project) => {
          const currentBranch = gitRepoStatus.get(project.normalizedPath)?.branch ?? '';
          const lastBranch = resolvedInputByProjectId.current.get(project.id);
          return lastBranch === undefined || lastBranch !== currentBranch;
        });

        if (pending.length === 0) {
          return;
        }

        const entries = await mapWithConcurrency(pending, 2, async (project) => {
          const inputBranch = gitRepoStatus.get(project.normalizedPath)?.branch ?? '';
          const branch = await getRootBranch(
            project.normalizedPath,
            inputBranch ? { knownBranch: inputBranch } : undefined,
          ).catch(() => null);
          return { id: project.id, inputBranch, branch };
        });
        if (cancelled) {
          return;
        }

        const resolved = entries.filter((entry) => entry.branch);
        if (resolved.length === 0) {
          return;
        }

        setProjectRootBranches((prev) => {
          const next = new Map(prev);
          resolved.forEach(({ id, branch }) => {
            if (branch) {
              next.set(id, branch);
            }
          });
          return next;
        });
        resolved.forEach(({ id, inputBranch }) => {
          resolvedInputByProjectId.current.set(id, inputBranch);
        });
      };
      void run();
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedProjects, projectGitBranchesKey, gitRepoStatus, setProjectRootBranches]);
};
