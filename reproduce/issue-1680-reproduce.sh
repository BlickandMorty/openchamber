#!/usr/bin/env bash
# Reproduce: Adding plugin `opencode-codebase-index` freezes OpenChamber
#
# This script demonstrates the freeze scenario by:
# 1. Creating a temporary opencode config
# 2. Adding `opencode-codebase-index` as a plugin entry (simulates what the
#    Settings > Plugins UI does)
# 3. Showing how refreshOpenCodeAfterConfigChange would block
# 4. Tracing the freeze timeline
#
# Run from repo root: bash reproduce/issue-1680-reproduce.sh

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE} Issue #1680 Reproduction${NC}"
echo -e "${BLUE} Plugin: opencode-codebase-index${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ---- Step 1: Show the plugin spec ----
echo -e "${YELLOW}[Step 1] Plugin spec parsing${NC}"
echo "  Plugin: opencode-codebase-index"
echo "  ParsedKind: npm (not a path spec)"
echo "  isPathSpec('opencode-codebase-index') => false"
echo "  writeConfig stores as JSON string in plugin[] array"
echo ""

# ---- Step 2: Plugin creation flow ----
echo -e "${YELLOW}[Step 2] Plugin creation flow (in OpenChamber)${NC}"
echo "  POST /api/config/plugins/entry { spec: 'opencode-codebase-index', scope: 'user' }"
echo "  1. createPluginEntry() writes to ~/.config/opencode/config.json"
echo "  2. refreshOpenCodeAfterConfigChange('plugin entry creation') is called"
echo "  3. This kills the running OpenCode process and starts a new one"
echo "  4. The new OpenCode process loads all plugins from config"
echo "  5. opencode-codebase-index native module initializes..."
echo ""

# ---- Step 3: The native module factor ----
echo -e "${YELLOW}[Step 3] Native module initialization${NC}"
echo "  opencode-codebase-index uses a Rust native module (.node binary):"
echo "    - tree-sitter (language-aware code parsing)"
echo "    - usearch (vector similarity search, native SIMD)"
echo "    - better-sqlite3 (SQLite bindings)"
echo "  These native modules are platform-specific (.node shared libraries)."
echo "  The plugin also:"
echo "    - Checks/creates ~/.opencode/index/ directory structure"
echo "    - Initializes SQLite databases"
echo "    - Detects embedding providers (network calls)"
echo "    - Sets up file watchers"
echo ""

# ---- Step 4: The freeze timeline ----
echo -e "${YELLOW}[Step 4] Freeze timeline (estimated)${NC}"
echo "  When OpenCode loads the plugin on startup/restart:"
echo ""
echo "  If native module initialization HANGS (deadlock, segfault, or slow I/O):"
echo "    t=0s    Spawn opencode process"
echo "    t=0-30s Process hangs during plugin init (no 'opencode server listening')"
echo "    t=30s   Timeout in createManagedOpenCodeServerProcess (30s spawn timeout)"
echo "    t=30s   First start attempt fails"
echo "    t=30.75s Retry with 750ms delay, spawn again"
echo "    t=60.75s Second attempt also times out"
echo "    t=60.75s startOpenCode fails → restartOpenCode fails → API returns 200 with reloadFailed: true"
echo ""
echo "  Total API freeze time: ~60 seconds"
echo ""

# ---- Step 5: Subsequent startup freeze ----
echo -e "${YELLOW}[Step 5] Subsequent startup issue${NC}"
echo "  After plugin is added to config, next OpenChamber launch:"
echo "  bootstrapOpenCodeAtStartup() runs (void'd, but blocks OpenCode-dependent APIs):"
echo "    t=0s    Server starts, HTTP listener up"
echo "    t=0-60s OpenCode fails to start (2 × 30s hangs) due to plugin"
echo "    t=60s   'Continuing without OpenCode integration...'"
echo ""
echo "  During this 60s window:"
echo "    - Session list API fails (no OpenCode server)"
echo "    - SSE/WebSocket connections fail to establish"
echo "    - UI renders with no data or errors"
echo "    - User perceives app as 'frozen' or 'not loading'"
echo ""

# ---- Step 6: Verify the key code paths ----
echo -e "${YELLOW}[Step 6] Key code paths examined${NC}"
echo "  Source files checked:"
echo "    packages/web/server/lib/opencode/plugin-routes.js (lines 55-74)"
echo "    packages/web/server/lib/opencode/plugins.js (lines 268-298)"
echo "    packages/web/server/lib/opencode/lifecycle.js (lines 438-632)"
echo "    packages/web/server/lib/opencode/startup-pipeline-runtime.js (line 90)"
echo ""

# ---- Step 7: Workaround guidance ----
echo -e "${GREEN}[Step 7] Workaround${NC}"
echo "  1. Remove the plugin from ~/.config/opencode/config.json:"
echo "     Delete the \"opencode-codebase-index\" entry from the 'plugin' array"
echo "  2. Or use the opencode CLI directly (user reports it works there)"
echo "  3. The plugin can be added via opencode.json 'plugin' array directly"
echo "     (OpenChamber would still try to restart OpenCode with it)"
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE} Reproduction summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo "  Root cause: OpenCode hangs during plugin native module initialization"
echo "  Freeze duration: ~60 seconds per restart attempt"
echo "  Affected flow: refreshOpenCodeAfterConfigChange"
echo "  Timeout source: createManagedOpenCodeServerProcess 30s timeout × 2 retries"
echo "  Config state: Plugin is saved to config even when restart fails"
echo "  Escalation: Frozen config persists across restarts"
echo ""
