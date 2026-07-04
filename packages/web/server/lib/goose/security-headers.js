// EPISTEMOS overlay (Plan 1-PRO §4.1 / §14.5 / hardening doctrine §3A):
// no-external-hosts CSP for the embedded Pro agent surface. The surface is a
// same-origin SPA in a loopback-pinned WKWebView; a CSP is defense-in-depth so
// a compromised SPA dependency can't exfiltrate to — or pull script from — an
// external host. Registered only under EPISTEMOS_EMBED (the native Pro host),
// so stock web/desktop/VS Code builds are byte-identical.
//
// The policy is tuned to what THIS SPA needs and NOTHING external:
//  - script/style 'unsafe-inline' + 'unsafe-eval' — Vite/React inline + libs
//    that use new Function; this is about XSS hardening, not the exfil vector.
//  - connect-src 'self' data: — same-origin REST + SSE + the PTY WebSocket, PLUS
//    `data:` for the terminal's ghostty-web WASM (`fetch('data:...wasm')` +
//    WebAssembly.compile). `data:` is INLINE (self-contained, no network egress),
//    so it is NOT an exfiltration vector — the anti-exfil guarantee is about bare
//    `ws:`/`https:` to REMOTE hosts, which stays forbidden; 'self' still covers
//    the same-origin ws:// in WebKit. Without `data:` here the terminal's WASM
//    load is CSP-blocked and the terminal never initializes.
//  - img/font/media data: + blob: (icons, generated assets); worker blob:.
//  - object/base/frame locked down.
const EMBED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export const registerEpistemosSecurityHeaders = (app, { logger = console } = {}) => {
  if (process.env.EPISTEMOS_EMBED !== '1') return false;
  app.use((_req, res, next) => {
    // Only set if not already present (don't clobber a stricter upstream one).
    if (!res.getHeader('Content-Security-Policy')) {
      res.setHeader('Content-Security-Policy', EMBED_CSP);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  logger.info?.('[epistemos] embed CSP + security headers active (no external hosts)');
  return true;
};

// Exported for unit tests / audits.
export const epistemosEmbedCSP = EMBED_CSP;
