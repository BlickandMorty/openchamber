/**
 * Reproduction script for issue #1968:
 * Replace session.abort() with session.interrupt() (new in OpenCode SDK v1.17.12)
 * so the STOP button actually cancels the upstream LLM provider request.
 *
 * Current behavior: session.abort() marks the session as idle locally but does NOT
 * cancel the HTTP request to the LLM provider (OpenAI, Anthropic, etc.).
 * The provider keeps generating, tokens keep burning.
 *
 * Expected behavior: session.interrupt() tears down the upstream provider request
 * — cancels the reader, returns 499 if the client disconnected.
 */

import { describe, test, expect } from "bun:test"
import * as path from "node:path"
import * as fs from "node:fs"

// The test file lives at the repo root
const REPO_ROOT = import.meta.dirname

function readSource(filePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, filePath), "utf-8")
}

describe("Issue #1968: session.interrupt() should replace session.abort()", () => {
  test("SDK version is ^1.17.9 — session.interrupt() is not available yet", () => {
    // Read the version from bun.lock
    const lockContent = readSource("bun.lock")
    expect(lockContent).toMatch(/@opencode-ai\/sdk.*\^1\.17\.\d+/)

    // Check the installed SDK version
    const installedPkg = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "node_modules/.bun/@opencode-ai+sdk@1.17.9/node_modules/@opencode-ai/sdk/package.json"),
        "utf-8",
      ),
    )
    expect(installedPkg.version).toBe("1.17.9")

    // Check that session.interrupt is not in the types
    const sdkGenTypes = fs.readFileSync(
      path.join(REPO_ROOT, "node_modules/.bun/@opencode-ai+sdk@1.17.9/node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts"),
      "utf-8",
    )
    expect(sdkGenTypes).not.toContain("interrupt")
  })

  test("session-actions.ts: 3 call sites use session.abort(), 0 use session.interrupt()", () => {
    const content = readSource("packages/ui/src/sync/session-actions.ts")

    const abortMatches = content.match(/sdk\(\)\.session\.abort\(/g)
    expect(abortMatches).not.toBeNull()
    expect(abortMatches!.length).toBe(3)

    const interruptMatches = content.match(/sdk\(\)\.session\.interrupt\(/g)
    expect(interruptMatches).toBeNull()

    // Verify exact line numbers for each abort call
    const lines = content.split("\n")
    const abortLines: number[] = []
    lines.forEach((line: string, i: number) => {
      if (line.includes("session.abort(")) abortLines.push(i + 1)
    })
    expect(abortLines).toEqual([725, 918, 1050])

    // Check the abortCurrentOperation function specifically (line ~723-728)
    const abortFunc = lines.slice(722, 728).join("\n")
    expect(abortFunc).toContain("session.abort")
  })

  test("opencode client wrapper: abortSession() uses session.abort() not session.interrupt()", () => {
    const content = readSource("packages/ui/src/lib/opencode/client.ts")

    const abortMatches = content.match(/this\.client\.session\.abort\(/g)
    expect(abortMatches).not.toBeNull()
    expect(abortMatches!.length).toBe(1)

    const interruptMatches = content.match(/session\.interrupt\(/g)
    expect(interruptMatches).toBeNull()
  })

  test("session-actions.test.ts mocks session.abort but NOT session.interrupt", () => {
    const content = readSource("packages/ui/src/sync/session-actions.test.ts")

    const abortMocks = content.match(/method: "session\.abort"/g)
    expect(abortMocks).not.toBeNull()
    expect(abortMocks!.length).toBe(1)

    const interruptMocks = content.match(/method: "session\.interrupt"/g)
    expect(interruptMocks).toBeNull()
  })

  test("ChatInput handleAbort calls abortCurrentOperation which calls session.abort()", () => {
    const content = readSource("packages/ui/src/components/chat/ChatInput.tsx")
    expect(content).toContain("sessionActions.abortCurrentOperation(")
    expect(content).toContain("abortCurrentOperation(currentSessionId")
  })

  test("session.interrupt is absent from the entire codebase", () => {
    const { execSync } = require("child_process")
    const result = execSync(
      'grep -rn "session\\.interrupt" packages/ --include="*.ts" --include="*.tsx" 2>/dev/null || echo "NO_MATCHES"',
      { cwd: REPO_ROOT, encoding: "utf-8" },
    )
    expect(result.trim()).toBe("NO_MATCHES")
  })

  test("vscode bridge: no abort or interrupt usage", () => {
    const content = readSource("packages/vscode/src/bridge-git-special-runtime.ts")

    // The bridge-git-special-runtime.ts doesn't use session.abort/interrupt
    // but it's mentioned as a cleanup path in the issue
    const abortMatches = content.match(/abort/g)
    expect(abortMatches).toBeNull()

    const interruptMatches = content.match(/interrupt/g)
    expect(interruptMatches).toBeNull()
  })
})
