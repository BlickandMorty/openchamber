// EPISTEMOS (engine-reactive bar): the composer must re-derive from the ACTIVE
// engine — a new draft follows the chip's live intent (so flipping the chip
// changes the bar instantly), an existing session follows its own engine. Lock
// the resolution rule that every engine-reactive control shares.
import { describe, expect, it } from 'vitest';
import { resolveActiveEngine } from '@/epistemos/useActiveEngine';

const engineOf = (id: string) => (id.startsWith('goose') ? 'goose' : 'opencode') as const;

describe('resolveActiveEngine', () => {
    it('new draft (draftOpen) follows the live chip intent — flips instantly', () => {
        expect(resolveActiveEngine('goose', 'opencode-sess', true, engineOf)).toBe('goose');
        expect(resolveActiveEngine('opencode', 'goose-sess', true, engineOf)).toBe('opencode');
    });

    it('no current session follows the intent', () => {
        expect(resolveActiveEngine('goose', null, false, engineOf)).toBe('goose');
        expect(resolveActiveEngine('opencode', null, false, engineOf)).toBe('opencode');
    });

    it('existing session (no draft) follows its OWN engine, not the intent', () => {
        // key: a goose session stays goose even if the stale intent says opencode.
        expect(resolveActiveEngine('opencode', 'goose-123', false, engineOf)).toBe('goose');
        expect(resolveActiveEngine('goose', 'opencode-123', false, engineOf)).toBe('opencode');
    });
});
