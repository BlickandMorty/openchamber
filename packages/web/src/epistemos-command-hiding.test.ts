// EPISTEMOS (Plan §0.6 capability truth / §3 / §8-P3): goose has no slash
// commands, so the composer must HIDE them for a goose session (not show a
// menu that rejects). Lock the pure gate the three command surfaces share.
import { describe, expect, it } from 'vitest';
import { gateCommandsForEngine } from '@/epistemos/useEngineAwareCommands';

describe('gateCommandsForEngine (capability hiding)', () => {
    const commands = [{ name: 'compact' }, { name: 'init' }];

    it('hides ALL commands for a goose session (empty → menu/highlight/starters disappear)', () => {
        expect(gateCommandsForEngine(commands, true)).toEqual([]);
    });

    it('passes the real command list through for a non-goose (opencode) session', () => {
        expect(gateCommandsForEngine(commands, false)).toBe(commands);
    });
});
