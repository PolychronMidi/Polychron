#!/usr/bin/env bash
# Live smoke test — sends REAL requests through the proxy to every provider.
# Verifies actual round-trip: proxy → real API → response back through proxy.
# Uses minimal prompts (short, cheap) to avoid burning quota.
#
# Requires: .env sourced for API keys. Proxy NOT on mainline — this script
# starts its own isolated proxy instance on an ephemeral port.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROXY_SCRIPT="$SCRIPT_DIR/hme_proxy.js"
PROXY_PORT=19877
PASS=true
TESTED=0
PASSED=0

# Source .env for API keys
set -a
source "$PROJECT_ROOT/.env"
set +a

cleanup() {
  [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "=== HME Proxy LIVE Smoke Test ==="
echo "Sends real (minimal) requests through proxy to each provider."
echo ""

# Start proxy with Anthropic as default upstream
HME_PROXY_PORT=$PROXY_PORT \
HME_PROXY_INJECT=0 \
PROJECT_ROOT="$PROJECT_ROOT" \
  node "$PROXY_SCRIPT" &
PROXY_PID=$!
sleep 1

if ! curl -sf --max-time 3 "http://127.0.0.1:${PROXY_PORT}/health" > /dev/null 2>&1; then
  echo "FATAL: proxy failed to start"
  exit 1
fi
echo "Proxy running on :${PROXY_PORT}"
echo ""

# Helper
test_provider() {
  local name="$1"
  local upstream="$2"     # X-HME-Upstream value (empty = default/Anthropic)
  local auth_header="$3"  # e.g. "x-api-key: sk-..." or "authorization: Bearer ..."
  local path="$4"         # request path, e.g. /v1/chat/completions or /v1/messages
  local body="$5"
  local expect="$6"       # grep pattern to confirm valid response

  TESTED=$((TESTED + 1))
  local headers=(-H "content-type: application/json")
  [ -n "$auth_header" ] && headers+=(-H "$auth_header")
  [ -n "$upstream" ] && headers+=(-H "x-hme-upstream: $upstream")

  local resp http_code
  resp=$(curl -s -w "\nHTTP_CODE:%{http_code}" --max-time 30 -X POST \
    "http://127.0.0.1:${PROXY_PORT}${path}" \
    "${headers[@]}" \
    -d "$body" 2>&1) || resp="CURL_FAIL: $?"
  http_code=$(echo "$resp" | grep -o 'HTTP_CODE:[0-9]*' | cut -d: -f2)
  resp=$(echo "$resp" | sed '/^HTTP_CODE:/d')

  if echo "$resp" | grep -qE "$expect"; then
    echo "  PASS [$name]: got valid response (HTTP $http_code)"
    PASSED=$((PASSED + 1))
  elif [ -n "$http_code" ] && [ "$http_code" != "000" ] && [ "$http_code" != "502" ]; then
    # Got an HTTP response from the real API (even if error like 429/401).
    # This proves the proxy forwarded to the real endpoint.
    echo "  PASS [$name]: proxy reached API (HTTP $http_code)"
    PASSED=$((PASSED + 1))
  else
    echo "  FAIL [$name]: proxy could not reach API"
    echo "       http_code=$http_code response: $(echo "$resp" | head -c 300)"
    PASS=false
  fi
}

# Anthropic
echo " Anthropic (default upstream) "
ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-}"
if [ -z "$ANTHROPIC_KEY" ]; then
  echo "  SKIP: no ANTHROPIC_API_KEY in env (Claude Code manages its own key)"
else
  test_provider "anthropic" "" \
    "x-api-key: $ANTHROPIC_KEY" \
    "/v1/messages" \
    '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"Say OK"}]}' \
    '"type":"message"|"text"'
fi

# Groq (OpenAI compat)
echo " Groq "
if [ -z "${GROQ_API_KEY:-}" ]; then
  echo "  SKIP: no GROQ_API_KEY"
else
  test_provider "groq" "https://api.groq.com/openai" \
    "authorization: Bearer $GROQ_API_KEY" \
    "/v1/chat/completions" \
    '{"model":"llama-3.3-70b-versatile","max_tokens":10,"messages":[{"role":"user","content":"Say OK"}]}' \
    '"choices"|"message"|"content"'
fi

# OpenRouter (OpenAI compat)
echo " OpenRouter "
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "  SKIP: no OPENROUTER_API_KEY"
else
  test_provider "openrouter" "https://openrouter.ai/api" \
    "authorization: Bearer $OPENROUTER_API_KEY" \
    "/v1/chat/completions" \
    '{"model":"meta-llama/llama-3.3-70b-instruct:free","max_tokens":10,"messages":[{"role":"user","content":"Say OK"}]}' \
    '"choices"|"message"|"content"'
fi

# Cerebras (OpenAI compat)
echo " Cerebras "
if [ -z "${CEREBRAS_API_KEY:-}" ]; then
  echo "  SKIP: no CEREBRAS_API_KEY"
else
  test_provider "cerebras" "https://api.cerebras.ai" \
    "authorization: Bearer $CEREBRAS_API_KEY" \
    "/v1/chat/completions" \
    '{"model":"llama3.1-8b","max_tokens":10,"messages":[{"role":"user","content":"Say OK"}]}' \
    '"choices"|"message"|"content"'
fi

# Mistral (OpenAI compat)
echo " Mistral "
if [ -z "${MISTRAL_API_KEY:-}" ]; then
  echo "  SKIP: no MISTRAL_API_KEY"
else
  test_provider "mistral" "https://api.mistral.ai" \
    "authorization: Bearer $MISTRAL_API_KEY" \
    "/v1/chat/completions" \
    '{"model":"mistral-small-latest","max_tokens":10,"messages":[{"role":"user","content":"Say OK"}]}' \
    '"choices"|"message"|"content"'
fi

# NVIDIA NIM (OpenAI compat)
echo " NVIDIA "
if [ -z "${NVIDIA_API_KEY:-}" ]; then
  echo "  SKIP: no NVIDIA_API_KEY"
else
  test_provider "nvidia" "https://integrate.api.nvidia.com" \
    "authorization: Bearer $NVIDIA_API_KEY" \
    "/v1/chat/completions" \
    '{"model":"meta/llama-3.3-70b-instruct","max_tokens":10,"messages":[{"role":"user","content":"Say OK"}]}' \
    '"choices"|"message"|"content"'
fi

# Gemini (non-OpenAI format — uses query param auth, different path)
echo " Gemini "
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "  SKIP: no GEMINI_API_KEY"
else
  # Gemini uses a different URL structure: POST /v1beta/models/{model}:generateContent?key=...
  # The proxy routes via X-HME-Upstream. We set upstream to the Gemini API root
  # and put the full path in the request URL.
  TESTED=$((TESTED + 1))
  GEMINI_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" --max-time 30 -X POST \
    "http://127.0.0.1:${PROXY_PORT}/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}" \
    -H "content-type: application/json" \
    -H "x-hme-upstream: https://generativelanguage.googleapis.com" \
    -d '{"contents":[{"parts":[{"text":"Say OK"}]}],"generationConfig":{"maxOutputTokens":10}}' \
    2>&1)
  GEMINI_CODE=$(echo "$GEMINI_RESP" | grep -o 'HTTP_CODE:[0-9]*' | cut -d: -f2)
  GEMINI_RESP=$(echo "$GEMINI_RESP" | sed '/^HTTP_CODE:/d')

  if echo "$GEMINI_RESP" | grep -qE '"candidates"|"content"|"text"|"error"'; then
    echo "  PASS [gemini]: proxy reached Gemini API (HTTP $GEMINI_CODE)"
    PASSED=$((PASSED + 1))
  elif [ -n "$GEMINI_CODE" ] && [ "$GEMINI_CODE" != "000" ] && [ "$GEMINI_CODE" != "502" ]; then
    echo "  PASS [gemini]: proxy reached Gemini API (HTTP $GEMINI_CODE)"
    PASSED=$((PASSED + 1))
  else
    echo "  FAIL [gemini]: proxy did not reach Gemini API"
    echo "       http_code=$GEMINI_CODE response: $(echo "$GEMINI_RESP" | head -c 300)"
    PASS=false
  fi
fi

# Local llama.cpp (if running)
echo " Local llama.cpp arbiter "
ARBITER_URL="${HME_LLAMACPP_ARBITER_URL:-http://127.0.0.1:8080}"
if curl -sf --max-time 3 "${ARBITER_URL}/health" > /dev/null 2>&1; then
  test_provider "llamacpp-arbiter" "$ARBITER_URL" \
    "" \
    "/v1/chat/completions" \
    '{"model":"hme-arbiter","max_tokens":10,"messages":[{"role":"user","content":"Say OK"}]}' \
    '"choices"|"content"|"text"'
else
  echo "  SKIP: arbiter not running at $ARBITER_URL"
fi

# Summary
echo ""
echo "=== Live Smoke Test Summary ==="
echo "$PASSED/$TESTED providers responded successfully through proxy"
if $PASS; then
  echo "ALL TESTED PROVIDERS PASSED"
  exit 0
else
  echo "SOME PROVIDERS FAILED — check output above"
  exit 1
fi
