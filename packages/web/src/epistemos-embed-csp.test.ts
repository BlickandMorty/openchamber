// EPISTEMOS (Plan §14.5): the embed CSP must block EXTERNAL hosts. Lock the
// policy so a future edit can't silently re-open an exfiltration path (a bare
// `ws:`/`https:` scheme in connect-src, or a `*` source).
import { describe, expect, it } from 'vitest';
// @ts-expect-error — JS overlay module.
import { epistemosEmbedCSP } from '../server/lib/goose/security-headers.js';

const directive = (name: string): string => {
    const found = epistemosEmbedCSP.split(';').map((d: string) => d.trim()).find((d: string) => d.startsWith(name + ' '));
    return found ?? '';
};

describe('embed CSP (no external hosts)', () => {
    it('default-src is self-only; connect-src is self + inert data: (no external host)', () => {
        expect(directive('default-src')).toBe("default-src 'self'");
        // connect-src governs fetch/XHR/SSE/WebSocket — the exfiltration lens.
        // 'self' + data: only: data: is inline/self-contained (the terminal's
        // ghostty-web WASM is fetched as a data: URL) and has NO network egress,
        // so it cannot exfiltrate to a remote host. The anti-exfil guarantee is
        // the ABSENCE of a bare ws:/https: source (asserted below), not the
        // absence of data:.
        expect(directive('connect-src')).toBe("connect-src 'self' data:");
    });

    it('never contains a wildcard or a bare external scheme', () => {
        // No `*` anywhere, and no bare ws:/wss:/http:/https: source that would
        // re-allow ANY host. (data:/blob: are inert, non-network schemes.)
        expect(epistemosEmbedCSP).not.toMatch(/\*/);
        expect(epistemosEmbedCSP).not.toMatch(/\b(wss?|https?):(?!\/)/);
        expect(epistemosEmbedCSP).not.toMatch(/(connect|default|script|style|img|font)-src[^;]*\b(wss?|https?):/);
    });

    it('locks object/base/frame-ancestors down', () => {
        expect(epistemosEmbedCSP).toContain("object-src 'none'");
        expect(epistemosEmbedCSP).toContain("base-uri 'none'");
        expect(epistemosEmbedCSP).toContain("frame-ancestors 'none'");
    });
});
