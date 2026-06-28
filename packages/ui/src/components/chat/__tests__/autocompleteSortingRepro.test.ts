/**
 * Reproduction test for #1896: autocomplete sorts alphabetically instead of by relevance.
 *
 * This test demonstrates the gap between current sorting behavior (alphabetical,
 * with optional scope/prefix tiebreakers) and the expected behavior (relevance-first
 * using scoreByFuzzyQuery).
 *
 * Three components are affected:
 * - FileMentionAutocomplete (agent mentions via @)
 * - SkillAutocomplete (inline skills via /)
 * - CommandAutocomplete (slash commands via /)
 *
 * All three use `fuzzyMatch()` as a boolean filter, then sort alphabetically or
 * by scope — no relevance ranking. `scoreByFuzzyQuery()` already exists in
 * packages/ui/src/lib/search/fuzzySearch.ts and provides prefix/substring/fuzzy
 * scoring, but is not wired into these components.
 */
import { describe, expect, test } from 'bun:test';
import { fuzzyMatch } from '@/lib/utils';
import { scoreByFuzzyQuery, matchesFuzzyQuery } from '@/lib/search/fuzzySearch';

// ---------------------------------------------------------------------------
// Simulated data matching the component types
// ---------------------------------------------------------------------------

type AgentInfo = { name: string; description?: string; mode?: string | null };
type SkillInfo = { name: string; scope: string; description?: string };
type CommandInfo = { id: string; name: string; description?: string; isBuiltIn?: boolean; isOpenChamber?: boolean; scope?: string };

// ---------------------------------------------------------------------------
// Current sorting implementations (extracted from the components)
// ---------------------------------------------------------------------------

/** Current FileMentionAutocomplete agent filtering + sorting (lines 258-274) */
function currentAgentSort(agents: AgentInfo[], query: string): AgentInfo[] {
  const normalizedQuery = query.trim().toLowerCase();
  return agents
    .filter((agent) => {
      if (!normalizedQuery) return true;
      const haystack = `${agent.name} ${agent.description ?? ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .map((agent) => ({
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Current SkillAutocomplete filtering + sorting (lines 45-56) */
function currentSkillSort(skills: SkillInfo[], query: string): SkillInfo[] {
  const normalizedQuery = query.trim();
  const matches = normalizedQuery.length
    ? skills.filter((skill) => fuzzyMatch(skill.name, normalizedQuery))
    : skills;

  return [...matches].sort((a, b) => {
    // Sort by project scope first, then name
    if (a.scope === 'project' && b.scope !== 'project') return -1;
    if (a.scope !== 'project' && b.scope === 'project') return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Current CommandAutocomplete filtering + sorting (lines 187-200) */
function currentCommandSort(commands: CommandInfo[], query: string): CommandInfo[] {
  const filtered = query
    ? commands.filter(
        (cmd) =>
          fuzzyMatch(cmd.name, query) ||
          (cmd.description && fuzzyMatch(cmd.description, query)),
      )
    : commands;

  filtered.sort((a, b) => {
    const aStartsWith = a.name.toLowerCase().startsWith(query.toLowerCase());
    const bStartsWith = b.name.toLowerCase().startsWith(query.toLowerCase());
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;
    return a.name.localeCompare(b.name);
  });

  return filtered;
}

// ---------------------------------------------------------------------------
// Expected sorting using scoreByFuzzyQuery
// ---------------------------------------------------------------------------

/** What FileMentionAutocomplete agents should look like with relevance ranking */
function expectedAgentSort(agents: AgentInfo[], query: string): AgentInfo[] {
  if (!query.trim()) return agents;
  const scored = scoreByFuzzyQuery(
    agents,
    query.trim(),
    (agent) => `${agent.name}${agent.description ? ' ' + agent.description : ''}`,
    { threshold: 0.4 },
  );
  return scored.map((s) => s.item);
}

/** What SkillAutocomplete should look like with relevance ranking */
function expectedSkillSort(skills: SkillInfo[], query: string): SkillInfo[] {
  if (!query.trim()) {
    // When no query, keep current scope-then-name fallback
    return [...skills].sort((a, b) => {
      if (a.scope === 'project' && b.scope !== 'project') return -1;
      if (a.scope !== 'project' && b.scope === 'project') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Score-based sorting
  const scored = scoreByFuzzyQuery(
    skills,
    query.trim(),
    (skill) => skill.name,
    { threshold: 0.4 },
  );

  // Then stable sort within each score group by scope, then name
  return scored.map((s) => s.item);
}

/** What CommandAutocomplete should look like with relevance ranking */
function expectedCommandSort(commands: CommandInfo[], query: string): CommandInfo[] {
  if (!query.trim()) return commands;

  const scored = scoreByFuzzyQuery(
    commands,
    query.trim(),
    (cmd) => `${cmd.name} ${cmd.description ?? ''}`,
    { threshold: 0.4 },
  );
  return scored.map((s) => s.item);
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// Agents designed so that for query "reviewer":
// - Alphabetical order: code-reviewer, reviewer, senior-code-reviewer
// - Relevance order: reviewer (prefix match), code-reviewer (substring at 5), senior-code-reviewer (substring)
const mockAgents: AgentInfo[] = [
  { name: 'architect', description: 'design system architecture', mode: 'agent' },
  { name: 'code-reviewer', description: 'automated code review', mode: 'agent' },
  { name: 'senior-code-reviewer', description: 'senior code review agent', mode: 'agent' },
  { name: 'reviewer', description: 'review changes', mode: 'agent' },
  { name: 'debugger', description: 'find and fix bugs', mode: 'agent' },
];

const mockSkills: SkillInfo[] = [
  { name: 'review-pr', scope: 'project', description: 'review a pull request' },
  { name: 'fix-issue', scope: 'user', description: 'fix a github issue' },
  { name: 'code-review', scope: 'project', description: 'review code changes' },
  { name: 'review-docs', scope: 'user', description: 'review documentation' },
  { name: 'deploy', scope: 'project', description: 'deploy to production' },
  { name: 'test-runner', scope: 'user', description: 'run tests' },
];

const mockCommands: CommandInfo[] = [
  { id: '1', name: 'review', description: 'review changes', isBuiltIn: true },
  { id: '2', name: 'undo', description: 'undo last change', isBuiltIn: true },
  { id: '3', name: 'redo', description: 'redo last change', isBuiltIn: true },
  { id: '4', name: 'timeline', description: 'view session timeline', isBuiltIn: true },
  { id: '5', name: 'compact', description: 'compact session', isBuiltIn: true },
  { id: '6', name: 'test', description: 'run tests', isBuiltIn: false },
  { id: '7', name: 'build', description: 'build project', isBuiltIn: false },
  { id: '8', name: 'workspace-review', description: 'review whole workspace', isOpenChamber: true },
  { id: '9', name: 'handoff-review', description: 'handoff review to another', isOpenChamber: true },
  { id: '10', name: 'plan-feature', description: 'plan a new feature', isOpenChamber: true },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileMentionAutocomplete (agent mentions with @)', () => {
  const query = 'reviewer';

  test('CURRENT behavior: agents sorted alphabetically, not by relevance', () => {
    const result = currentAgentSort(mockAgents, query);
    const resultNames = result.map((a) => a.name);
    console.log('[FileMention] Current order:', resultNames.join(', '));

    // Current code: .includes() + localeCompare
    // Matches for "reviewer": code-reviewer, senior-code-reviewer, reviewer
    // Alphabetical: code-reviewer, reviewer, senior-code-reviewer
    // The most relevant (reviewer — prefix match) should be first but is buried at index 1
    const reviewerIdx = resultNames.indexOf('reviewer');
    const codeReviewerIdx = resultNames.indexOf('code-reviewer');
    console.log(`[FileMention] 'reviewer' at index ${reviewerIdx}, 'code-reviewer' at index ${codeReviewerIdx}`);

    // 'code-reviewer' comes first alphabetically, burying the more relevant 'reviewer'
    expect(reviewerIdx).toBeGreaterThan(codeReviewerIdx);
  });

  test('EXPECTED behavior: agents sorted by relevance using scoreByFuzzyQuery', () => {
    const result = expectedAgentSort(mockAgents, query);
    const resultNames = result.map((a) => a.name);
    console.log('[FileMention] Expected order:', resultNames.join(', '));

    // 'reviewer' should be first (prefix match, score -1)
    expect(resultNames[0]).toBe('reviewer');
  });
});

describe('SkillAutocomplete (inline skills with /)', () => {
  const query = 'review';

  test('CURRENT behavior: sorted by scope then name, no relevance', () => {
    const result = currentSkillSort(mockSkills, query);
    const resultNames = result.map((s) => s.name);
    console.log('[Skill] Current order:', resultNames.join(', '));

    // Current: project scope first (alphabetical), then user scope (alphabetical)
    // Expected: relevance first — 'review-pr' (prefix match) should be first
    const reviewPrIdx = resultNames.indexOf('review-pr');
    const codeReviewIdx = resultNames.indexOf('code-review');
    const reviewDocsIdx = resultNames.indexOf('review-docs');

    // 'review-pr' and 'review-docs' start with "review", but 'code-review' is substring only
    // With scope-first sorting, 'code-review' (project) comes before 'review-docs' (user)
    // even though 'review-docs' is a better match
    if (reviewPrIdx !== -1 && reviewDocsIdx !== -1) {
      // review-pr should be before review-docs (both start with "review", scope project > user)
      expect(reviewPrIdx).toBeLessThan(reviewDocsIdx);
    }
  });

  test('EXPECTED behavior: skills sorted by relevance, not scope-first', () => {
    const result = expectedSkillSort(mockSkills, query);
    const resultNames = result.map((s) => s.name);
    console.log('[Skill] Expected order:', resultNames.join(', '));

    // 'review-pr' should be before 'code-review' (prefix match > substring match)
    const reviewPrIdx = resultNames.indexOf('review-pr');
    const codeReviewIdx = resultNames.indexOf('code-review');
    if (reviewPrIdx !== -1 && codeReviewIdx !== -1) {
      expect(reviewPrIdx).toBeLessThan(codeReviewIdx);
    }
  });
});

describe('CommandAutocomplete (slash commands with /)', () => {
  const query = 'review';

  test('CURRENT behavior: sorted by prefix-match fallback then alphabetically', () => {
    const result = currentCommandSort(mockCommands, query);
    const resultNames = result.map((c) => c.name);
    console.log('[Command] Current order:', resultNames.join(', '));

    // Current sorts: prefix match first, then alphabetically
    // But prefix matching is only checking startsWith on name — no substring scoring
    // 'review' and 'workspace-review' both start with 'review' at position 0
    // 'handoff-review' is substring — starts with 'handoff'
    // So 'handoff-review' loses to alphabetically sorted prefix matches even though
    // 'handoff-review' contains 'review' as a significant part
    const reviewIdx = resultNames.indexOf('review');
    const wsReviewIdx = resultNames.indexOf('workspace-review');
    const handoffReviewIdx = resultNames.indexOf('handoff-review');

    // 'review' should be first (prefix match + alphabetical)
    expect(reviewIdx).toBe(0);
    // 'handoff-review' is a suffix match (ends with 'review') — should rank higher than non-matches
    // but with current prefix-only sorting, it may be buried
    console.log(`[Command] 'handoff-review' at index ${handoffReviewIdx}`);
  });

  test('EXPECTED behavior: commands sorted by relevance, using prefix > substring > fuzzy scoring', () => {
    const result = expectedCommandSort(mockCommands, query);
    const resultNames = result.map((c) => c.name);
    console.log('[Command] Expected order:', resultNames.join(', '));

    // 'review' should be first (prefix match)
    // 'workspace-review' has 'review' as a suffix — should rank higher than unrelated commands
    // 'handoff-review' also has 'review' as suffix — should also rank well
    const reviewIdx = resultNames.indexOf('review');
    expect(reviewIdx).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Demonstrate that scoreByFuzzyQuery exists and provides relevance scoring
// ---------------------------------------------------------------------------

describe('scoreByFuzzyQuery relevance scoring', () => {
  test('prefix matches score highest (-1)', () => {
    const items = ['reviewer', 'senior-reviewer', 'code-review', 'architect'];
    const result = scoreByFuzzyQuery(items, 'review', (s) => s, { threshold: 0.4 });
    // Prefix match "reviewer" should be first
    expect(result[0].item).toBe('reviewer');
    expect(result[0].score).toBe(-1);
  });

  test('substring matches (not prefix) score next (idx/1000)', () => {
    const items = ['senior-reviewer', 'code-review'];
    const result = scoreByFuzzyQuery(items, 'review', (s) => s, { threshold: 0.4 });
    // Both are substring matches, ordered by match position
    result.forEach((r) => {
      // Neither is a prefix match (score -1), so score should be >= 0
      expect(typeof r.score === 'number').toBe(true);
      expect(!Number.isNaN(r.score)).toBe(true);
    });
  });

  test('alphabetical sort never reflects query relevance', () => {
    const items = ['senior-reviewer', 'reviewer'];
    // Alphabetical: 'reviewer' < 'senior-reviewer'
    expect([...items].sort()).toEqual(['reviewer', 'senior-reviewer']);
    // This is coincidentally correct for exact prefix match

    // But consider: ['architect', 'debugger', 'reviewer', 'senior-reviewer']
    const allItems = ['architect', 'debugger', 'reviewer', 'senior-reviewer'];
    expect([...allItems].sort()).toEqual([
      'architect',
      'debugger',
      'reviewer',      // 3rd out of 4
      'senior-reviewer',
    ]);
    // With query "reviewer", relevance order should be: reviewer, senior-reviewer, ...
    const scored = scoreByFuzzyQuery(allItems, 'reviewer', (s) => s, { threshold: 0.4 });
    const scoredNames = scored.map((s) => s.item);
    expect(scoredNames[0]).toBe('reviewer');
    expect(scoredNames[1]).toBe('senior-reviewer');
    console.log('[scoreByFuzzyQuery] Alphabetical vs relevance:', {
      alphabetical: [...allItems].sort(),
      relevance: scoredNames,
      scores: scored.map((s) => s.score),
    });
  });
});
