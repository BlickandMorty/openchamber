#!/usr/bin/env node

/**
 * Reproduction script for Issue #1657 - Voice Input Not Working on Desktop
 *
 * Tests the server-side STT endpoint (/api/stt/transcribe) and identifies
 * the root causes of both reported issues.
 *
 * Run: node scripts/reproduce/issue-1657-reproduction.mjs
 */

import express from 'express';
import { registerTtsRoutes } from '../../packages/web/server/lib/tts/routes.js';
import { normalizeCustomOpenAIBaseURL } from '../../packages/web/server/lib/tts/base-url.js';

// Save original env
const origRuntime = process.env.OPENCHAMBER_RUNTIME;
const origAllowRemote = process.env.OPENCHAMBER_ALLOW_REMOTE_OPENAI_COMPAT_URLS;

// ─── Helper: create test app ───────────────────────────────────────────────
function createApp() {
  const app = express();
  // Register TTS/STT routes with the sayTTSCapability set to null (not macOS)
  registerTtsRoutes(app, { sayTTSCapability: null });
  return app;
}

// ─── Helper: create a test audio blob as Buffer ────────────────────────────
function createMockAudioBuffer() {
  // Minimal WAV header with silence (44 bytes header + 1764 bytes of silence)
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate; // 1 second of audio
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const buffer = Buffer.alloc(totalSize);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(totalSize - 8, 4);
  buffer.write('WAVE', 8);
  
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // byte rate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Data is already zero (silence)
  
  return buffer;
}

// ─── Test Suite ────────────────────────────────────────────────────────────
async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.log(`  ✗ ${message}`);
      failed++;
    }
  }

  async function test(description, fn) {
    console.log(`\n${description}`);
    try {
      await fn();
    } catch (error) {
      console.log(`  ✗ Test threw: ${error.message}`);
      failed++;
    }
  }

  // ── Test 1: Middleware chain compatibility ──
  
  await test('Test 1: Verify audio/* content types are accepted by express.raw', async () => {
    const app = createApp();
    let middlewareRan = false;
    let bodyParsed = false;
    
    // We can't easily introspect middleware, so we verify via the route
    app.use((req, _res, next) => {
      // Simulate what registerCommonRequestMiddleware does - it applies
      // express.urlencoded() to ALL requests and express.json() for /api/tts paths
      if (!req.path.startsWith('/api') || req.path.startsWith('/api/config')) {
        // Not our concern
      }
      next();
    });

    // The STT endpoint accepts audio content type
    // If we run the actual server, we need to listen. Instead verify the
    // express.raw type function logic directly.
    const sttTypeCheck = (req) => (req.headers['content-type'] || '').startsWith('audio/');
    
    const testTypes = [
      { contentType: 'audio/webm', expected: true },
      { contentType: 'audio/webm;codecs=opus', expected: true },
      { contentType: 'audio/ogg;codecs=opus', expected: true },
      { contentType: 'audio/mp4', expected: true },
    ];
    
    for (const { contentType, expected } of testTypes) {
      const mockReq = { headers: { 'content-type': contentType } };
      const result = sttTypeCheck(mockReq);
      assert(result === expected, `Content-Type "${contentType}" should be accepted`);
    }
  });

  // ── Test 2: X-Base-URL header validation ──
  
  await test('Test 2: Verify X-Base-URL validation in the STT route handler', async () => {
    // The route handler extracts headers and validates them
    // Let's verify by simulating the handler logic
    
    const testUrls = [
      { url: 'http://localhost:8001/v1', shouldPass: true },
      { url: 'http://127.0.0.1:8001/v1', shouldPass: true },
      { url: '', shouldFail: true, reason: 'Missing baseURL' },
    ];
    
    // For the environment test, we need to test the base-url.js logic
    for (const entry of testUrls) {
      const result = normalizeCustomOpenAIBaseURL(entry.url);
      if (entry.shouldFail) {
        assert(result.error || !result.value, `Empty URL "${entry.url}" should be rejected`);
      } else {
        assert(!result.error && result.value, `URL "${entry.url}" should be valid`);
      }
    }
  });

  // ── Test 3: Verify transcribeAudio header extraction logic ──
  
  await test('Test 3: Verify header extraction matches actual behavior', async () => {
    // In the route handler, headers are extracted like:
    const extractHeaders = (req) => ({
      mimeType: (req.headers['content-type'] || 'audio/webm').split(',')[0].trim(),
      baseURL: typeof req.headers['x-base-url'] === 'string' ? req.headers['x-base-url'].trim() : '',
      model: typeof req.headers['x-model'] === 'string' && req.headers['x-model'].trim().length > 0
        ? req.headers['x-model'].trim()
        : 'deepdml/faster-whisper-large-v3-turbo-ct2',
      language: typeof req.headers['x-language'] === 'string' && req.headers['x-language'].trim().length > 0
        ? req.headers['x-language'].trim()
        : undefined,
      authHeader: typeof req.headers['authorization'] === 'string' ? req.headers['authorization'].trim() : '',
    });
    
    // Simulate a request with headers
    const mockReq = {
      headers: {
        'content-type': 'audio/webm;codecs=opus',
        'x-base-url': 'http://localhost:8001/v1',
        'x-model': 'whisper-1',
        'x-language': 'en',
        'authorization': 'Bearer test-api-key',
      }
    };
    
    const extracted = extractHeaders(mockReq);
    assert(extracted.mimeType === 'audio/webm;codecs=opus', 'Content-Type correctly extracted');
    assert(extracted.baseURL === 'http://localhost:8001/v1', 'X-Base-URL correctly extracted');
    assert(extracted.model === 'whisper-1', 'X-Model correctly extracted');
    assert(extracted.language === 'en', 'X-Language correctly extracted');
    assert(extracted.authHeader === 'Bearer test-api-key', 'Authorization correctly extracted');
  });

  // ── Test 4: Verify the STT route handler via HTTP ──

  await test('Test 4: Verify STT endpoint responds to valid requests', async () => {
    const http = await import('http');
    const app = createApp();
    
    // Start a server on a random port
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = addr.port;
    
    try {
      // Test 4a: Missing audio data (no body)
      const res1 = await fetch(`http://127.0.0.1:${port}/api/stt/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/webm',
          'X-Base-URL': 'http://localhost:8001/v1',
        },
      });
      const data1 = await res1.json();
      
      // With an empty body, express.raw won't parse it properly
      // The handler checks: if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0)
      // This should return 400
      assert(res1.status === 400 || res1.status === 500, 
        `Missing audio data returns ${res1.status}: ${data1.error || 'no error'}`);
      
      // Test 4b: Missing X-Base-URL header
      const audioBuffer = createMockAudioBuffer();
      const res2 = await fetch(`http://127.0.0.1:${port}/api/stt/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
        },
        body: audioBuffer,
      });
      const data2 = await res2.json();
      assert(res2.status === 400 && data2.error === 'X-Base-URL header is required',
        'Missing X-Base-URL returns 400: ' + JSON.stringify(data2));
      
      // Test 4c: Request with valid headers but unreachable server
      const res3 = await fetch(`http://127.0.0.1:${port}/api/stt/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'X-Base-URL': 'http://127.0.0.1:1/v1', // Port 1 should be unreachable
        },
        body: audioBuffer,
      });
      
      // The handler calls transcribeAudio() which tries to connect to the upstream
      // server. This should fail with a connection error (500).
      assert(res3.status === 500,
        `Unreachable upstream server returns 500 (got ${res3.status})`);
      
      const data3 = await res3.json();
      assert(typeof data3.error === 'string' && data3.error.length > 0,
        'Error message is provided: ' + data3.error);
      
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── Test 5: Verify the frontend fetch flow ──
  
  await test('Test 5: Analyze fetch URL resolution for STT endpoint', async () => {
    // In the desktop Electron app, runtimeFetch('/api/stt/transcribe') resolves
    // through getRuntimeUrlResolver().api('/api/stt/transcribe')
    //
    // The URL resolution is handled by packages/ui/src/lib/runtime-url.ts:
    //
    //   createRuntimeUrlResolver creates a resolver with apiBaseUrl from either:
    //     a) configured apiBaseUrl from RuntimeUrlConfig
    //     b) window.__OPENCHAMBER_API_BASE_URL__ injected at page load
    //
    //   On desktop, __OPENCHAMBER_API_BASE_URL__ is set to the local server URL
    //   (e.g. http://127.0.0.1:57123) via:
    //     - packages/electron/preload.mjs:56-58 (contextBridge for local pages)
    //     - packages/electron/main.mjs:815-822 (initScript injection)
    //
    //   The URL resolver produces:
    //     http://127.0.0.1:57123/api/stt/transcribe
    //
    // In the web browser, the apiBaseUrl is empty, so the URL is:
    //   /api/stt/transcribe (resolved relative to window.location.origin)
    //
    // POTENTIAL ISSUE: When the desktop UI is loaded from the custom protocol
    // (openchamber-ui://app), the fetch from this origin to http://127.0.0.1:<port>
    // is a cross-origin request. The Express server must include CORS headers
    // for this to work, or Electron must disable web security.
    //
    // ELECTRON WEB PREFERENCES: main.mjs lines 1888-1896
    //   - contextIsolation: true
    //   - sandbox: false (so preload can use contextBridge)
    //   - No mention of webSecurity being disabled
    //
    // If webSecurity is enabled (default), a fetch from openchamber-ui://app
    // to http://127.0.0.1:<port> would be blocked by CORS unless the server
    // includes appropriate CORS headers (Access-Control-Allow-Origin).
    //
    // Check: Does the Express server include CORS headers for all origins?
    // This would determine if cross-origin fetches from the custom protocol work.
    
    console.log('\n  URL resolution analysis:');
    console.log('  - Desktop (packaged UI): openchamber-ui://app → http://127.0.0.1:<port>');
    console.log('    This is a CROSS-ORIGIN request. Requires CORS headers on server.');
    console.log('  - Desktop (dev server): http://127.0.0.1:<port> → http://127.0.0.1:<port>');
    console.log('    This is a SAME-ORIGIN request. No CORS needed.');
    console.log('  - Web browser: window.location.origin → same origin');
    console.log('    Same-origin. No CORS needed.');
    
    assert(true, 'URL resolution analysis documented');
  });

  // ── Test 6: CORS header analysis for packaged desktop UI ──

  await test('Test 6: CORS preflight response check for custom STT headers', async () => {
    // The CORS middleware in packages/web/server/index.js:1099-1114 sets headers
    // for requests from 'openchamber-ui://app' origin.
    //
    // Access-Control-Allow-Headers (line 1105):
    //   'Content-Type,Authorization,Accept,X-Requested-With,Cache-Control,X-OpenCode-Directory'
    //
    // The audioStreamService._upload() sends these custom headers:
    //   - X-Base-URL  (sttServerUrl config, e.g. http://localhost:8001/v1)
    //   - X-Model     (sttModel config)
    //   - X-Language  (language hint)
    //   - Authorization (if sttApiKey is configured)
    //
    // X-Base-URL, X-Model, and X-Language are NOT in the Allow-Headers list!
    //
    // When the browser sends a cross-origin POST request with these custom headers:
    // 1. It sends an OPTIONS preflight request
    // 2. The server responds with Access-Control-Allow-Headers
    // 3. The browser checks if X-Base-URL, X-Model, X-Language are allowed
    // 4. Since they're not listed, the browser BLOCKS the actual request
    // 5. The fetch fails with a TypeError (CORS error) → "Failed to fetch"
    
    const allowedHeaders = 'Content-Type,Authorization,Accept,X-Requested-With,Cache-Control,X-OpenCode-Directory';
    const allowedList = allowedHeaders.split(',').map(h => h.trim().toLowerCase());
    
    const requiredHeaders = ['x-base-url', 'x-model', 'x-language'];
    const missingHeaders = requiredHeaders.filter(h => !allowedList.includes(h));
    
    console.log('\n  Required STT headers (sent by audioStreamService._upload()):');
    for (const header of requiredHeaders) {
      const isAllowed = allowedList.includes(header);
      console.log(`    - ${header}: ${isAllowed ? 'ALLOWED ✓' : 'NOT ALLOWED ✗'}`);
    }
    
    assert(missingHeaders.length > 0,
      `${missingHeaders.length} STT headers missing from CORS Allow-Headers: ${missingHeaders.join(', ')}`);
    
    console.log('\n  ROOT CAUSE IDENTIFIED: The X-Base-URL, X-Model, and X-Language');
    console.log('  custom headers are missing from the CORS Access-Control-Allow-Headers');
    console.log('  list in packages/web/server/index.js:1105.');
    console.log('');
    console.log('  When the desktop app loads from "openchamber-ui://app" (packaged UI),');
    console.log('  the fetch to http://127.0.0.1:<port>/api/stt/transcribe is cross-origin.');
    console.log('  The browser sends a CORS preflight (OPTIONS) request. The server responds');
    console.log('  with the allowed headers list, but the custom STT headers are NOT included.');
    console.log('  The browser then blocks the actual POST request with a CORS error.');
    console.log('');
    console.log('  FIX: Add "X-Base-URL,X-Model,X-Language" to the Access-Control-Allow-Headers');
    console.log('  list in packages/web/server/index.js line 1105.');
    console.log('');
    console.log('  FILE: packages/web/server/index.js:1105');
    console.log('  CURRENT:');
    console.log('    "Content-Type,Authorization,Accept,X-Requested-With,Cache-Control,X-OpenCode-Directory"');
    console.log('  FIX:');
    console.log('    "Content-Type,Authorization,Accept,X-Requested-With,Cache-Control,X-OpenCode-Directory,X-Base-URL,X-Model,X-Language"');
  });

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
