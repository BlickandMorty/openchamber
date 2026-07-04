// EPISTEMOS (deep-hardening / GOOSE BLANK REPLY): goosed streams the reply
// Message with id:null (Message.id is Option<String>, unset mid-stream). The
// synthesizer used to `return null` on a null id, dropping ALL text -> every
// goose reply rendered blank (the bubble drew from onMessage's fallback id, but
// no text part ever attached). It must instead use the SAME fallback id so the
// text part lands on the assistant message. Lock it.
import { describe, expect, it } from 'vitest';
import { GooseDeltaSynthesizer, gooseLiveAssistantMessageId } from '@/epistemos/gooseClient';

const nullIdMessage = (text: string) => ({
    id: null,
    role: 'assistant',
    created: 1,
    content: [{ type: 'text', text }],
} as never);

describe('GooseDeltaSynthesizer null-id reply (blank-reply regression)', () => {
    it('emits text under the fallback id when goosed sends id:null', () => {
        const synth = new GooseDeltaSynthesizer();
        const fallback = gooseLiveAssistantMessageId('sess-1');
        const delta = synth.consume(nullIdMessage('hello from goose'), fallback);
        expect(delta).not.toBeNull();
        expect(delta!.messageId).toBe('sess-1-assistant-live');
        expect(delta!.appendedText).toBe('hello from goose');
        expect(delta!.fullText).toBe('hello from goose');
    });

    it('fallback id matches what onMessage uses (no drift → part attaches)', () => {
        // engineDispatch onMessage creates the assistant message under this exact id.
        expect(gooseLiveAssistantMessageId('abc')).toBe('abc-assistant-live');
    });

    it('diffs successive whole-Message frames into incremental deltas', () => {
        const synth = new GooseDeltaSynthesizer();
        const fb = gooseLiveAssistantMessageId('s');
        expect(synth.consume(nullIdMessage('hel'), fb)!.appendedText).toBe('hel');
        expect(synth.consume(nullIdMessage('hello'), fb)!.appendedText).toBe('lo');
    });
});
