#!/usr/bin/env bash
set -euo pipefail

echo "=== Reproduce #1885: Build warns about eval() in onnxruntime-web dependency ==="
echo ""

# Verify dependency chain
echo "1. Check dependency chain..."
echo "   @xenova/transformers version:"
node -e "console.log('   ' + require('@xenova/transformers/package.json').version)"
echo ""
echo "   onnxruntime-web location:"
ls -d node_modules/.bun/onnxruntime-web@1.14.0/node_modules/onnxruntime-web 2>/dev/null || echo "   (not in standard node_modules location)"
echo ""

echo "2. Check onnxruntime-web version:"
node -e "const p = require('node:path'); const pkg = require(p.join(process.cwd(), 'node_modules/.bun/onnxruntime-web@1.14.0/node_modules/onnxruntime-web/package.json')); console.log('   ' + pkg.version)"
echo ""

echo "3. Verify eval() exists in ort-web.min.js..."
EVAL_COUNT=$(grep -o 'eval' node_modules/.bun/onnxruntime-web@1.14.0/node_modules/onnxruntime-web/dist/ort-web.min.js 2>/dev/null | wc -l)
echo "   eval() occurrences in ort-web.min.js: $EVAL_COUNT"
echo ""

echo "4. Run vite build (capturing warnings)..."
cd packages/web
npx vite build 2>&1 | grep -i "eval\|onnxruntime" || echo "   (no eval warnings found - build completed cleanly)"
echo ""

echo "=== Reproduction complete ==="
echo "If you see eval warnings above, the issue is confirmed."
