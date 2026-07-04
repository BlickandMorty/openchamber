// EPISTEMOS (deep-hardening / GAP #9): the goose permission ASK arrives as a
// MessageContent::ActionRequired content item — {type:"actionRequired",
// data:{actionType:"toolConfirmation", id, toolName, arguments, prompt}}
// (verified in goose-providers/src/conversation/message.rs). The adapter had
// been matching the DORMANT top-level {type:"toolConfirmationRequest"} variant,
// so permission cards never surfaced. Lock the extractor to the real shape.
import { describe, expect, it } from 'vitest';
import { extractGooseToolConfirmation } from '@/epistemos/gooseSdkMapping';

describe('extractGooseToolConfirmation', () => {
    it('parses the LIVE actionRequired/toolConfirmation shape (nested data)', () => {
        const item = {
            type: 'actionRequired',
            data: {
                actionType: 'toolConfirmation',
                id: 'confirm-1',
                toolName: 'shell',
                arguments: { command: 'ls' },
                prompt: 'Run a shell command?',
            },
        };
        expect(extractGooseToolConfirmation(item)).toEqual({
            id: 'confirm-1',
            toolName: 'shell',
            arguments: { command: 'ls' },
            prompt: 'Run a shell command?',
        });
    });

    it('still parses the legacy top-level toolConfirmationRequest variant', () => {
        const item = { type: 'toolConfirmationRequest', id: 'c2', toolName: 'edit' };
        expect(extractGooseToolConfirmation(item)).toEqual({
            id: 'c2',
            toolName: 'edit',
            arguments: undefined,
            prompt: null,
        });
    });

    it('ignores non-confirmation content (text, other actionRequired kinds, missing id)', () => {
        expect(extractGooseToolConfirmation({ type: 'text', text: 'hi' })).toBeNull();
        expect(extractGooseToolConfirmation({ type: 'actionRequired', data: { actionType: 'elicitation', id: 'e1' } })).toBeNull();
        expect(extractGooseToolConfirmation({ type: 'actionRequired', data: { actionType: 'toolConfirmation' } })).toBeNull();
        expect(extractGooseToolConfirmation(null)).toBeNull();
    });
});
