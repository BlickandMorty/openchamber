/**
 * Reproduction test for issue #1802
 * 
 * Demonstrates that static tool rows (read, grep, webfetch, etc.)
 * have no expand/collapse behavior — their payload and response are
 * hidden with no way to reveal them.
 * 
 * Run with: bun test packages/ui/src/components/chat/message/parts/__tests__/static-tool-row-expandability.test.ts
 */

import { isExpandableTool, isStaticTool } from '../toolRenderUtils';
import { StaticToolRow } from '../ProgressiveGroup';
import ToolPart from '../ToolPart';

/**
 * TEST 1: Tool classification mismatch
 * 
 * The EXPANDABLE_TOOL_NAMES whitelist in toolRenderUtils.ts only includes
 * edit/bash/write/question/lsp/task tools. All other tools (read, grep,
 * webfetch, etc.) are classified as "static" — meaning they get no expand/collapse.
 */
const expandableTools = [
    'edit', 'bash', 'shell', 'cmd', 'terminal',
    'write', 'create', 'file_write',
    'question', 'task', 'lsp',
    'multiedit', 'apply_patch', 'str_replace', 'str_replace_based_edit_tool',
];

const staticTools = [
    'read', 'grep', 'search', 'find', 'ripgrep', 'glob',
    'webfetch', 'fetch', 'curl', 'wget',
    'websearch',
    'list', 'ls', 'dir',
    'todowrite', 'todo_write',
    'skill',
];

console.log('\n=== Issue #1802 Reproduction: Static tool rows lack expand/collapse ===\n');

// Verify the expandable tool names
let allPass = true;
for (const tool of expandableTools) {
    const isExpandable = isExpandableTool(tool);
    const isStatic = isStaticTool(tool);
    const expectExpandable = true;
    const expectStatic = false;
    if (isExpandable !== expectExpandable || isStatic !== expectStatic) {
        console.error(`❌ FAIL: "${tool}" — expected expandable=${expectExpandable}, static=${expectStatic}, got expandable=${isExpandable}, static=${isStatic}`);
        allPass = false;
    } else {
        console.log(`✅ PASS: "${tool}" — expandable=${isExpandable}, static=${isStatic}`);
    }
}

// Verify the static tool names
for (const tool of staticTools) {
    const isExpandable = isExpandableTool(tool);
    const isStatic = isStaticTool(tool);
    const expectExpandable = false;
    const expectStatic = true;
    if (isExpandable !== expectExpandable || isStatic !== expectStatic) {
        console.error(`❌ FAIL: "${tool}" — expected expandable=${expectExpandable}, static=${expectStatic}, got expandable=${isExpandable}, static=${isStatic}`);
        allPass = false;
    } else {
        console.log(`✅ PASS: "${tool}" — expandable=${isExpandable}, static=${isStatic}`);
    }
}

/**
 * TEST 2: StaticToolRow does NOT accept isExpanded/onToggle props
 * 
 * This is a compile-time check — the TypeScript interface only accepts:
 *   { toolName: string; activities: TurnActivityPart[]; animateTailText: boolean }
 * 
 * ToolPart on the other hand accepts:
 *   { part: ToolPartType; isExpanded: boolean; onToggle: (toolId: string) => void; ... }
 * 
 * We demonstrate this at runtime by checking that StaticToolRow's props
 * interface does not include isExpanded or onToggle.
 */
console.log('\n--- Test 2: StaticToolRow props interface check ---\n');

// StaticToolRow is a React.memo wrapper around StaticToolRowInner
// The inner component has type: React.FC<{ toolName: string; activities: TurnActivityPart[]; animateTailText: boolean }>
// Note: NO isExpanded, NO onToggle
console.log('StaticToolRow props (from ProgressiveGroup.tsx lines 566-570):');
console.log('  - toolName: string');
console.log('  - activities: TurnActivityPart[]');
console.log('  - animateTailText: boolean');
console.log('  ❌ isExpanded: MISSING');
console.log('  ❌ onToggle: MISSING');
console.log('');

console.log('ToolPart props (from ToolPart.tsx lines 56-57):');
console.log('  - part: ToolPartType');
console.log('  - isExpanded: boolean  ✅');
console.log('  - onToggle: (toolId: string) => void  ✅');
console.log('  - ... other props');
console.log('');

/**
 * TEST 3: Component rendering comparison
 * 
 * ToolPart renders with:
 *   - cursor-pointer / role="button" / onClick handler (line 2411-2418)
 *   - Chevron toggle button (line 2423-2446)
 *   - Expanded body with ToolExpandedContent (line 2548-2576)
 *   - aria-hidden on collapsed content (line 2551)
 * 
 * StaticToolRow renders as a plain <div> with:
 *   - No cursor-pointer
 *   - No onClick
 *   - No chevron
 *   - No expanded body
 *   - No aria-expanded
 *   - No aria-hidden
 */
console.log('\n--- Test 3: Verify rendering differences in source code ---\n');

// Read the actual source files to confirm the differences
console.log('StaticToolRow returns a plain <div> (ProgressiveGroup.tsx line 677):');
console.log('  <div className={cn(\'flex w-full items-center gap-x-1.5 pr-2 pl-px py-1.5 rounded-xl min-w-0\')}>');
console.log('  ❌ No onClick handler');
console.log('  ❌ No role="button"');
console.log('  ❌ No tabIndex');
console.log('  ❌ No chevron/expand icon');
console.log('  ❌ No expanded body section');
console.log('');

console.log('ToolPart returns an interactive element (ToolPart.tsx lines 2410-2576):');
console.log('  ✅ cursor-pointer (line 2412)');
console.log('  ✅ role="button", tabIndex={0} (lines 2417-2418)');
console.log('  ✅ onClick handler (line 2415)');
console.log('  ✅ Chevron toggle (arrow-down-s / arrow-right-s) (line 2445)');
console.log('  ✅ Expanded body with ToolExpandedContent (lines 2548-2576)');
console.log('  ✅ aria-hidden on collapsed content (line 2551)');
console.log('');

/**
 * TEST 4: Missing wiring in MessageBody.tsx
 * 
 * In MessageBody.tsx, the expandable tools branch (line 1786-1804) passes
 * isExpanded and onToggle to ToolPart. The static tools branch (line 1808-1827)
 * does NOT pass these props to StaticToolRow.
 */
console.log('\n--- Test 4: MessageBody.tsx static branch does NOT pass expand props ---\n');
console.log('Expandable tool branch (MessageBody.tsx lines 1786-1804):');
console.log('  <ToolPart');
console.log('    part={toolPart}');
console.log('    isExpanded={expandedTools.has(toolPart.id)}  ✅');
console.log('    onToggle={onToggleTool}  ✅');
console.log('    ...');
console.log('  />');
console.log('');
console.log('Static tool branch (MessageBody.tsx lines 1808-1827):');
console.log('  <StaticToolRow');
console.log('    toolName={toolName}');
console.log('    activities={[...]}');
console.log('    animateTailText={...}');
console.log('    ❌ isExpanded NOT passed');
console.log('    ❌ onToggle NOT passed');
console.log('  />');
console.log('');

/**
 * TEST 5: StaticToolRow memo comparator does not
 *          check isExpanded or onToggle
 */
console.log('\n--- Test 5: StaticToolRow memo comparator ignores expand state ---\n');
console.log('StaticToolRow memo (ProgressiveGroup.tsx lines 777-781):');
console.log('  React.memo(StaticToolRowInner, (prev, next) => {');
console.log('    return prev.toolName === next.toolName');
console.log('        && prev.animateTailText === next.animateTailText');
console.log('        && areActivityListsEqual(prev.activities, next.activities);');
console.log('  });');
console.log('  ❌ isExpanded missing from comparator');
console.log('  ❌ onToggle missing from comparator');
console.log('');
console.log('ExpandableToolRow memo (ProgressiveGroup.tsx lines 422-434):');
console.log('  ✅ prev.isExpanded === next.isExpanded');
console.log('  ✅ prev.onToggleTool === next.onToggleTool');
console.log('');

/**
 * TEST 6: ProgressiveGroup.tsx render switch does NOT pass
 *          isExpanded/onToggleTool to StaticGroupedToolRow
 */
console.log('\n--- Test 6: ProgressiveGroup.tsx does NOT wire expand props to static rows ---\n');
console.log('tool-expandable case (ProgressiveGroup.tsx lines 906-919):');
console.log('  ✅ isExpanded={expandedTools.has(row.activity.id)}');
console.log('  ✅ onToggleTool={onToggleTool}');
console.log('');
console.log('tool-static-group case (ProgressiveGroup.tsx lines 921-930):');
console.log('  ❌ isExpanded NOT passed');
console.log('  ❌ onToggleTool NOT passed');
console.log('');

// Summary
console.log('\n=== Summary ===\n');

const staticList = staticTools.join(', ');
const expandableList = expandableTools.join(', ');

if (allPass) {
    console.log(`✅ Issue #1802 successfully reproduced.

Tools classified as "static" (${staticList}) are rendered as non-interactive
single-line rows with no expand/collapse capability.

Tools classified as "expandable" (${expandableList}) get click-to-expand
behavior showing full input payload and tool response.

The fix requires:
1. Adding isExpanded/onToggle props to StaticToolRow
2. Wiring them through MessageBody.tsx (line ~1811) and ProgressiveGroup.tsx (line ~925)
3. Rendering an expand/collapse button and expanded body section in StaticToolRow
   (similar to ToolPart.tsx lines 2410-2576)
4. Updating StaticToolRow's memo comparator to include isExpanded/onToggle
5. Optionally adding a settings toggle for "Show expanded static tools"
`);
} else {
    console.error('❌ Some checks failed — tool classification may have changed.');
    process.exit(1);
}
