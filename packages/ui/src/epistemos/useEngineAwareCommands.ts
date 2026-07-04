import { useMemo } from 'react';
import { useCommandsStore } from '@/stores/useCommandsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { engineForSession } from '@/epistemos/engineDispatch';

// EPISTEMOS overlay (Plan 1-PRO §0.6 capability truth / §3 / §8-P3): goose has
// NO slash commands (the adapter's sendCommand rejects them). Per the LOCKED
// owner decision "show the active engine's real capabilities only. Hide absent
// features. Never fake parity," the composer must HIDE commands for a goose
// session rather than show a menu that rejects on use. Every command surface
// (the autocomplete menu, the slash-highlight, the draft-starter chips) reads
// the store through this hook; returning an empty list for a goose session
// makes all three disappear — a single source of truth for the gate.
//
// Loaded only by composer components (not the client eval chain), so no module
// cycle. engineForSession is a pure read of the adapter's session index.
/** Pure gate (testable): goose sessions get NO commands; everything else the
 *  real list. Exported for a re-runnable witness of the capability-hide. */
export const gateCommandsForEngine = <T>(commands: T[], isGooseSession: boolean): T[] =>
    isGooseSession ? [] : commands;

export const useEngineAwareCommands = () => {
    const commands = useCommandsStore((s) => s.commands);
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const isGoose = currentSessionId ? engineForSession(currentSessionId) === 'goose' : false;
    return useMemo(
        () => gateCommandsForEngine(commands, isGoose) as typeof commands,
        [isGoose, commands],
    );
};
