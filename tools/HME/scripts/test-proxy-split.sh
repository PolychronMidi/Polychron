#!/usr/bin/env bash
set -euo pipefail

ROOT="${PROJECT_ROOT}"
cd "$ROOT"

files=(
  tools/HME/proxy/hme_proxy.js
  tools/HME/proxy/hme_proxy_claude.js
  tools/HME/proxy/hme_proxy_routes.js
  tools/HME/proxy/hme_proxy_opus_gate.js
  tools/HME/proxy/hme_proxy_request_mutation.js
  tools/HME/proxy/hme_proxy_headers.js
  tools/HME/proxy/hme_proxy_context_budget.js
  tools/HME/proxy/hme_proxy_anthropic_response.js
  tools/HME/proxy/hme_proxy_connection_errors.js
  tools/HME/proxy/hme_proxy_response_trace.js
  tools/HME/proxy/hme_proxy_response_send.js
  tools/HME/proxy/hme_proxy_upstream_failure.js
)

for f in "${files[@]}"; do
  node -c "$f"
done

PROJECT_ROOT="$ROOT" node --test \
  tools/HME/tests/specs/proxy_boundary_contract.test.js \
  tools/HME/tests/specs/proxy_routes_and_opus_gate.test.js \
  tools/HME/tests/specs/proxy_connection_errors.test.js \
  tools/HME/tests/specs/proxy_handler_integration.test.js \
  tools/HME/tests/specs/proxy_extracted_modules.test.js \
  tools/HME/tests/specs/proxy_route_metrics.test.js \
  tools/HME/tests/specs/routing_ready_contract.test.js

printf '{"messages":[{"role":"user","content":"hi"}]}' | node tools/HME/proxy/hme_proxy.js --test >tools/HME/runtime/hme-proxy-test-smoke.json
python3 tools/HME/scripts/pipeline/hme/build-dir-intent-index.py >tools/HME/runtime/hme-dir-intent-proxy-split.out

echo "proxy split checks passed"
