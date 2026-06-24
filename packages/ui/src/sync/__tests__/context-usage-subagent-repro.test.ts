/**
 * Reproduction test for issue #1812:
 * Context usage icon uses the main agent's context window size instead of the subagent's.
 *
 * Scenario:
 * - Main agent uses a model with a 1M (1,000,000 token) context window
 * - Subagent uses a model with a 128K (128,000 token) context window
 * - Subagent has sent the last message, using ~100K tokens
 * - The context usage display should use the subagent's 128K limit, but uses the main agent's 1M limit
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useSessionUIStore } from '../session-ui-store';
import { useConfigStore } from '@/stores/useConfigStore';

/** Simulate the Header.tsx logic for computing context limit */
function simulateHeaderContextLimit(): { contextLimit: number; outputLimit: number } {
  const { getCurrentModel } = useConfigStore.getState();
  const currentModel = getCurrentModel();
  const limit = currentModel && typeof currentModel.limit === 'object' && currentModel.limit !== null
    ? (currentModel.limit as Record<string, unknown>)
    : null;
  const contextLimit = (limit && typeof limit.context === 'number' ? limit.context : 0);
  const outputLimit = (limit && typeof limit.output === 'number' ? limit.output : 0);
  return { contextLimit, outputLimit };
}

/** Simulate the MiniChatLayout.tsx / VSCodeLayout.tsx logic */
function simulateMiniChatContextLimit(): { contextLimit: number; outputLimit: number } {
  const { getCurrentModel } = useConfigStore.getState();
  const currentModel = getCurrentModel();

  // Prefers currentModel (main agent) if it has a .limit property
  const modelForLimits = currentModel?.limit ? currentModel : undefined;
  const limit = modelForLimits && typeof modelForLimits.limit === 'object' && modelForLimits.limit !== null
    ? (modelForLimits.limit as Record<string, unknown>)
    : null;
  const contextLimit = limit && typeof limit.context === 'number' ? limit.context : 0;
  const outputLimit = limit && typeof limit.output === 'number' ? limit.output : 0;
  return { contextLimit, outputLimit };
}

describe('Context usage subagent reproduction (#1812)', () => {
  const mainAgentModel = {
    id: 'glm-5.2',
    providerId: 'zhipu',
    name: 'GLM5.2',
    limit: { context: 1_000_000, output: 8192 },
  };

  const subagentModel = {
    id: 'gpt-4o-mini',
    providerId: 'openai',
    name: 'GPT-4o Mini',
    limit: { context: 128_000, output: 16384 },
  };

  const providerMain = {
    id: 'zhipu',
    name: 'Zhipu AI',
    models: [mainAgentModel],
  };

  const providerSub = {
    id: 'openai',
    name: 'OpenAI',
    models: [subagentModel],
  };

  beforeEach(() => {
    // Configure the store with both providers and set the main agent's model as current
    useConfigStore.setState({
      providers: [providerMain, providerSub] as any,
      currentProviderId: 'zhipu',
      currentModelId: 'glm-5.2',
    });
  });

  afterEach(() => {
    useSessionUIStore.setState({ currentSessionId: null });
  });


  test('Header.tsx: always uses main agent model context limit, even when subagent sent last message', () => {
    // Set up the session with a subagent message as the last assistant message
    const sessionId = 'test-session-1';
    useSessionUIStore.setState({
      currentSessionId: sessionId,
      // @ts-expect-error - setting raw sync messages for the test
    });

    // Inject a subagent message with providerID/modelID from a different model
    const syncMessages = [
      {
        id: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
      {
        id: 'msg-2',
        role: 'assistant',
        providerID: 'openai',      // Subagent's provider
        modelID: 'gpt-4o-mini',    // Subagent's model with 128K context
        tokens: { input: 80_000, output: 5000, reasoning: 2000, cache: { read: 10000, write: 3000 } },
        content: [{ type: 'text', text: 'Subagent response' }],
      },
    ];

    // We need to inject messages into the session. Let's access the sync store directly.
    // The messages are stored in the sync/event store, not session-ui-store directly.
    // For this reproduction, we'll verify the logic by checking what contextLimit 
    // would be passed to getContextUsage().

    const { contextLimit, outputLimit } = simulateHeaderContextLimit();

    // The Header.tsx code always uses getCurrentModel() — the main agent's model
    console.log('[Header.tsx] contextLimit used:', contextLimit);
    console.log('[Header.tsx] Expected (subagent model):', subagentModel.limit.context);
    console.log('[Header.tsx] Got (main agent model):', mainAgentModel.limit.context);

    // BUG: contextLimit is 1_000_000 (main agent's) instead of 128_000 (subagent's)
    expect(contextLimit).toBe(mainAgentModel.limit.context);

    // The percentage would be computed as:
    const subagentTotalTokens = 80_000 + 5000 + 2000 + 10000 + 3000; // = 100_000
    const buggyPercentage = contextLimit > 0
      ? Math.round((subagentTotalTokens / contextLimit) * 100)
      : 0;
    const correctPercentage = subagentModel.limit.context
      ? Math.round((subagentTotalTokens / subagentModel.limit.context) * 100)
      : 0;

    console.log(`[Header.tsx] Total tokens: ${subagentTotalTokens}`);
    console.log(`[Header.tsx] Buggy percentage (using ${contextLimit} window): ${buggyPercentage}%`);
    console.log(`[Header.tsx] Correct percentage (using ${subagentModel.limit.context} window): ${correctPercentage}%`);

    // BUG: Should show ~78% but shows ~10%
    expect(buggyPercentage).toBe(10);
    expect(correctPercentage).toBe(78);
  });

  test('MiniChatLayout.tsx: prefers main agent model context limit over subagent model', () => {
    const { contextLimit, outputLimit } = simulateMiniChatContextLimit();

    console.log('[MiniChatLayout] contextLimit used:', contextLimit);
    console.log('[MiniChatLayout] Expected (subagent model):', subagentModel.limit.context);
    console.log('[MiniChatLayout] Got (main agent model):', mainAgentModel.limit.context);

    // BUG: Uses 1_000_000 because currentModel (main agent) has a .limit property
    expect(contextLimit).toBe(mainAgentModel.limit.context);
  });

  test('VSCodeLayout.tsx: same pattern as MiniChatLayout', () => {
    // Same logic as MiniChatLayout:
    // const modelForLimits = currentModel?.limit ? currentModel : latestAssistantModel;
    const { getCurrentModel } = useConfigStore.getState();
    const currentModel = getCurrentModel();

    // currentModel?.limit is truthy, so modelForLimits = currentModel (main agent)
    const modelForLimits = currentModel?.limit ? currentModel : undefined;

    // The latestAssistantModel (subagent's model) is never used
    console.log('[VSCodeLayout] currentModel?.limit:', !!currentModel?.limit);
    console.log('[VSCodeLayout] modelForLimits === currentModel:', modelForLimits === currentModel);
    console.log('[VSCodeLayout] latestAssistantModel (subagent) would be:', subagentModel.id);

    expect(currentModel?.limit).toBeTruthy();
    expect(modelForLimits?.id).toBe('glm-5.2');
    expect(modelForLimits?.id).not.toBe('gpt-4o-mini');
  });

  test('ContextSidebarTab correctly resolves context from last assistant message', () => {
    // The detailed context panel (ContextSidebarTab.tsx) resolves the model 
    // from the LAST assistant message's providerID/modelID, which is correct.
    // This test demonstrates the correct behavior for comparison.

    // When we look up the model from msg-2's providerID/modelID:
    const { providers } = useConfigStore.getState();
    const provider = providers.find((p: any) => p.id === 'openai');
    const model = (provider as any)?.models?.find((m: any) => m.id === 'gpt-4o-mini');
    const contextLimit = typeof (model as any)?.limit?.context === 'number'
      ? (model as any).limit.context
      : null;

    console.log('[ContextSidebarTab] Resolved from message providerID/modelID:', contextLimit);
    expect(contextLimit).toBe(128_000);
  });
});
