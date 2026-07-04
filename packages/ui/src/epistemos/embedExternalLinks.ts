// EPISTEMOS overlay — PATCH_LEDGER#PRO-EXTLINK-1 (Pro agent surface).
// Owner "find disconnected parts + connect": external links + provider-OAuth
// "Open"/"Authorize" buttons were DEAD in the Pro embed. They route through
// lib/url.ts `openExternalUrl`, which (no desktop bridge injected) falls back to
// `window.open(url, '_blank')` — and a bare WKWebView has no WKUIDelegate/
// new-window handler, so `window.open` silently no-ops. Result: clicking
// "Authorize with Anthropic/OpenAI/GitHub/MCP" did nothing → the agent could
// never get provider credentials.
//
// The native ProAgentNavigationDecider (ProAgentSurfaceView.swift:42-49) DOES
// handle external http(s) MAIN-FRAME navigations: it opens them via
// NSWorkspace.shared.open AND returns `.cancel`, so the browser opens the link
// and the SPA never navigates away. `window.open` (a new-window request) bypasses
// that decider; a main-frame navigation does not. So: reroute external
// `window.open` through `window.location.assign` — the decider opens it in the
// system browser and cancels the in-page nav.
//
// Safe + scoped: embed-only; only external http(s) (non-loopback) is rerouted —
// internal/same-origin/loopback `window.open` falls through untouched. Because
// external `window.open` was already a no-op, there is no behavior to regress.

/** True iff `raw` resolves to an external (non-loopback) http/https URL. Pure — exported for tests. */
export const isExternalHttpUrl = (raw: string, baseHref: string): boolean => {
    try {
        const u = new URL(raw, baseHref);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const h = u.hostname;
        return h !== '127.0.0.1' && h !== 'localhost' && h !== '::1' && h !== '[::1]';
    } catch {
        return false;
    }
};

const toRaw = (url: unknown): string | null => {
    if (typeof url === 'string') return url;
    if (url instanceof URL) return url.href;
    return null;
};

if (import.meta.env.VITE_EPISTEMOS_EMBED === '1' && typeof window !== 'undefined') {
    const nativeOpen = window.open.bind(window);
    window.open = function patchedOpen(url?: string | URL, ...rest: unknown[]): Window | null {
        const raw = toRaw(url);
        if (raw !== null && isExternalHttpUrl(raw, window.location.href)) {
            // Main-frame nav → ProAgentNavigationDecider → NSWorkspace.open + .cancel.
            window.location.assign(raw);
            return null;
        }
        return (nativeOpen as (u?: string | URL, ...r: unknown[]) => Window | null)(url, ...rest);
    } as typeof window.open;
}
