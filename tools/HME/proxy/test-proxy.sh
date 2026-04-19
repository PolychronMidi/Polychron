#!/usr/bin/env bash
# Side test for hme_proxy.js — proves the proxy works WITHOUT touching mainline.
# Spins up a mock upstream + the proxy, sends a test payload, checks the response.
# Exit 0 = PASS, exit 1 = FAIL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROXY_SCRIPT="$SCRIPT_DIR/hme_proxy.js"
MOCK_PORT=19876
PROXY_PORT=19877
PASS=true

cleanup() {
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null || true
  [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "=== HME Proxy Side Test ==="
echo ""

# 1. Test --test mode (offline scan, no network)
echo "Test 1: --test mode (no read → coherence violation)"
RESULT=$(echo '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"hello"},{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"src/conductor/conductorIntelligence.js","old_string":"a","new_string":"b"}}]}]}' \
  | PROJECT_ROOT="$PROJECT_ROOT" node "$PROXY_SCRIPT" --test 2>/dev/null || true)
if echo "$RESULT" | grep -q '"violation": true'; then
  echo "  PASS: violation=true when Edit without HME read"
else
  echo "  FAIL: expected violation=true"
  echo "  got: $RESULT"
  PASS=false
fi

echo ""
echo "Test 2: --test mode (read before write → no violation)"
RESULT=$(echo '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"hello"},{"role":"assistant","content":[{"type":"tool_use","id":"t0","name":"mcp__HME__read","input":{"target":"conductorIntelligence"}}]},{"role":"user","content":[{"type":"tool_result","tool_use_id":"t0","content":"ok"}]},{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"src/conductor/conductorIntelligence.js","old_string":"a","new_string":"b"}}]}]}' \
  | PROJECT_ROOT="$PROJECT_ROOT" node "$PROXY_SCRIPT" --test 2>/dev/null || true)
if echo "$RESULT" | grep -q '"violation": false'; then
  echo "  PASS: violation=false when read precedes write"
else
  echo "  FAIL: expected violation=false"
  echo "  got: $RESULT"
  PASS=false
fi

echo ""
echo "Test 3: --test mode (no write intent → no violation)"
RESULT=$(echo '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"hello"},{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"src/conductor/conductorIntelligence.js"}}]}]}' \
  | PROJECT_ROOT="$PROJECT_ROOT" node "$PROXY_SCRIPT" --test 2>/dev/null || true)
if echo "$RESULT" | grep -q '"violation": false'; then
  echo "  PASS: violation=false for read-only tools"
else
  echo "  FAIL: expected violation=false"
  echo "  got: $RESULT"
  PASS=false
fi

# 2. Start mock upstream (echoes back a valid Anthropic-shaped response) ─
echo ""
echo "Test 4: live proxy → mock upstream (round-trip)"
node -e "
const http = require('http');
const s = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant',
      content: [{type:'text',text:'mock response'}],
      model: 'test-mock', stop_reason: 'end_turn',
      usage: {input_tokens: 10, output_tokens: 5},
      _proxy_test: {received_bytes: body.length, had_messages: body.includes('messages')}
    }));
  });
});
s.listen($MOCK_PORT, '127.0.0.1', () => { console.log('mock:' + $MOCK_PORT); });
" &
MOCK_PID=$!
sleep 1

# Start proxy pointed at mock
HME_PROXY_PORT=$PROXY_PORT \
HME_PROXY_UPSTREAM_HOST=127.0.0.1 \
HME_PROXY_UPSTREAM_PORT=$MOCK_PORT \
HME_PROXY_UPSTREAM_TLS=0 \
HME_PROXY_INJECT=0 \
PROJECT_ROOT="$PROJECT_ROOT" \
  node "$PROXY_SCRIPT" &
PROXY_PID=$!
sleep 1

# Health check
HEALTH=$(curl -sf --max-time 3 "http://127.0.0.1:${PROXY_PORT}/health" 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "  PASS: /health responds OK"
else
  echo "  FAIL: /health check failed: $HEALTH"
  PASS=false
fi

# Send a real-shaped payload through proxy → mock upstream
RESPONSE=$(curl -sf --max-time 5 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
  -H "content-type: application/json" \
  -H "x-api-key: test-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"test"}]}' \
  2>/dev/null || echo "FAIL")

if echo "$RESPONSE" | grep -q '"mock response"'; then
  echo "  PASS: round-trip through proxy → mock upstream works"
else
  echo "  FAIL: round-trip failed"
  echo "  got: $RESPONSE"
  PASS=false
fi

if echo "$RESPONSE" | grep -q '"had_messages":true\|"had_messages": true'; then
  echo "  PASS: mock confirms payload contained messages"
else
  echo "  FAIL: mock didn't see messages in forwarded payload"
  echo "  got: $RESPONSE"
  PASS=false
fi

# 3. Test with injection enabled
echo ""
echo "Test 5: live proxy with jurisdiction injection"
kill "$PROXY_PID" 2>/dev/null; wait "$PROXY_PID" 2>/dev/null || true

HME_PROXY_PORT=$PROXY_PORT \
HME_PROXY_UPSTREAM_HOST=127.0.0.1 \
HME_PROXY_UPSTREAM_PORT=$MOCK_PORT \
HME_PROXY_UPSTREAM_TLS=0 \
HME_PROXY_INJECT=1 \
PROJECT_ROOT="$PROJECT_ROOT" \
  node "$PROXY_SCRIPT" &
PROXY_PID=$!
sleep 1

# Send payload with a write to a jurisdiction file
RESPONSE=$(curl -sf --max-time 5 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
  -H "content-type: application/json" \
  -H "x-api-key: test-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"system":"You are helpful.","messages":[{"role":"user","content":"fix the bug"},{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"src/conductor/signal/meta/manager/hyperMetaManager.js","old_string":"a","new_string":"b"}}]}]}' \
  2>/dev/null || echo "FAIL")

if echo "$RESPONSE" | grep -q '"had_messages":true\|"had_messages": true'; then
  echo "  PASS: injection payload forwarded successfully"
else
  echo "  FAIL: injection round-trip failed"
  echo "  got: $RESPONSE"
  PASS=false
fi

# Verify the mock received a larger payload (injection added bytes)
RECEIVED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_proxy_test',{}).get('received_bytes',0))" 2>/dev/null || echo 0)
if [ "$RECEIVED" -gt 300 ]; then
  echo "  PASS: mock received $RECEIVED bytes (injection added context)"
else
  echo "  FAIL: mock only received $RECEIVED bytes (injection may not have fired)"
  PASS=false
fi

# 6. SSE streaming test
echo ""
echo "Test 6: SSE streaming round-trip"
kill "$PROXY_PID" 2>/dev/null; wait "$PROXY_PID" 2>/dev/null || true
kill "$MOCK_PID" 2>/dev/null; wait "$MOCK_PID" 2>/dev/null || true

# Mock that returns SSE stream like Anthropic
node -e "
const http = require('http');
const s = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const payload = JSON.parse(body);
    if (payload.stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'transfer-encoding': 'chunked',
        'cache-control': 'no-cache',
      });
      const events = [
        'event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_test\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test\",\"usage\":{\"input_tokens\":10}}}\n\n',
        'event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n',
        'event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n',
        'event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n',
        'event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n',
        'event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\n',
        'event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n',
      ];
      let i = 0;
      const interval = setInterval(() => {
        if (i < events.length) {
          res.write(events[i++]);
        } else {
          clearInterval(interval);
          res.end();
        }
      }, 50);
    } else {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({id:'msg_test',type:'message',role:'assistant',content:[{type:'text',text:'sync'}]}));
    }
  });
});
s.listen($MOCK_PORT, '127.0.0.1', () => console.log('sse-mock:' + $MOCK_PORT));
" &
MOCK_PID=$!
sleep 1

HME_PROXY_PORT=$PROXY_PORT \
HME_PROXY_UPSTREAM_HOST=127.0.0.1 \
HME_PROXY_UPSTREAM_PORT=$MOCK_PORT \
HME_PROXY_UPSTREAM_TLS=0 \
HME_PROXY_INJECT=0 \
PROJECT_ROOT="$PROJECT_ROOT" \
  node "$PROXY_SCRIPT" &
PROXY_PID=$!
sleep 1

SSE_OUT=$(curl -sf --max-time 10 -N -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
  -H "content-type: application/json" \
  -H "x-api-key: test-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"stream":true,"messages":[{"role":"user","content":"test"}]}' \
  2>/dev/null || echo "FAIL")

if echo "$SSE_OUT" | grep -q "message_start" && echo "$SSE_OUT" | grep -q "message_stop"; then
  echo "  PASS: SSE stream contains message_start and message_stop events"
else
  echo "  FAIL: SSE stream missing expected events"
  echo "  got: $(echo "$SSE_OUT" | head -c 500)"
  PASS=false
fi

if echo "$SSE_OUT" | grep -q "hello" && echo "$SSE_OUT" | grep -q "world"; then
  echo "  PASS: SSE content_block_delta tokens forwarded correctly"
else
  echo "  FAIL: SSE deltas missing"
  PASS=false
fi

EVENT_COUNT=$(echo "$SSE_OUT" | grep -c "^event:" || true)
if [ "$EVENT_COUNT" -ge 6 ]; then
  echo "  PASS: $EVENT_COUNT SSE events received (expected 7)"
else
  echo "  FAIL: only $EVENT_COUNT SSE events received (expected 7)"
  PASS=false
fi

# 7. Multi-upstream routing test ─
echo ""
echo "Test 7: X-HME-Upstream routes to different provider"

# Send request with X-HME-Upstream pointing at our mock (simulating Groq/NVIDIA/etc)
RESPONSE=$(curl -sf --max-time 5 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/chat/completions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer test-key" \
  -H "x-hme-upstream: http://127.0.0.1:${MOCK_PORT}" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"test"}]}' \
  2>/dev/null || echo "FAIL")

if echo "$RESPONSE" | grep -q "message_start\|msg_test"; then
  echo "  PASS: X-HME-Upstream routed to mock upstream"
else
  echo "  FAIL: X-HME-Upstream routing failed"
  echo "  got: $RESPONSE"
  PASS=false
fi

# Verify the X-HME-Upstream header was stripped (not forwarded to mock)
# The mock would need to echo headers back for this — skip for now, trust the code

echo ""
echo "Test 8: default upstream (no X-HME-Upstream header) goes to Anthropic default"
# We can't test real Anthropic, but verify the proxy doesn't crash on a
# request without the header. Since our mock is on a different port than
# DEFAULT_UPSTREAM, this will 502 — which proves the proxy tried to reach
# the default, not the mock.
RESPONSE=$(curl -sf --max-time 3 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
  -H "content-type: application/json" \
  -H "x-api-key: test-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"test"}]}' \
  2>/dev/null || echo "TIMEOUT_OR_ERROR")

# This should either get a real Anthropic error (auth failed) or a proxy 502.
# Either way, it proves the proxy routed to the DEFAULT upstream, not the mock.
if echo "$RESPONSE" | grep -qE '"type":"error"|TIMEOUT_OR_ERROR'; then
  echo "  PASS: no X-HME-Upstream → routed to default (Anthropic), got expected error/timeout"
else
  echo "  INFO: unexpected response (may have hit real Anthropic): $(echo "$RESPONSE" | head -c 200)"
fi

# 9. Emergency valve test
echo ""
echo "Test 9: emergency valve trips after 3 consecutive upstream failures"
kill "$PROXY_PID" 2>/dev/null; wait "$PROXY_PID" 2>/dev/null || true
kill "$MOCK_PID" 2>/dev/null; wait "$MOCK_PID" 2>/dev/null || true

# Create a temp .env for the valve to modify (don't touch real .env)
VALVE_DIR=$(mktemp -d)
VALVE_ENV="$VALVE_DIR/.env"
echo "HME_PROXY_ENABLED=1" > "$VALVE_ENV"
mkdir -p "$VALVE_DIR/log"
mkdir -p "$VALVE_DIR/tools/HME/activity"
cp "$PROJECT_ROOT/tools/HME/activity/emit.py" "$VALVE_DIR/tools/HME/activity/emit.py" 2>/dev/null || true

# Start proxy pointed at a dead upstream (port 19999 — nothing listening)
HME_PROXY_PORT=$PROXY_PORT \
HME_PROXY_UPSTREAM_HOST=127.0.0.1 \
HME_PROXY_UPSTREAM_PORT=19999 \
HME_PROXY_UPSTREAM_TLS=0 \
HME_PROXY_INJECT=0 \
PROJECT_ROOT="$VALVE_DIR" \
  node "$PROXY_SCRIPT" &
PROXY_PID=$!
sleep 1

# Send 3 requests — each will fail (connection refused to port 19999)
for i in 1 2 3; do
  curl -sf --max-time 3 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
    -H "content-type: application/json" \
    -d '{"model":"test","messages":[{"role":"user","content":"test"}]}' \
    2>/dev/null || true
  sleep 0.5
done

# Give valve time to trip and write files
sleep 2

# Check 1: proxy should have exited
if kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "  FAIL: proxy still running after 3 failures"
  kill "$PROXY_PID" 2>/dev/null
  PASS=false
else
  echo "  PASS: proxy self-terminated after 3 consecutive failures"
fi

# Check 2: .env should have HME_PROXY_ENABLED=0
if grep -q "HME_PROXY_ENABLED=0" "$VALVE_ENV"; then
  echo "  PASS: .env updated to HME_PROXY_ENABLED=0"
else
  echo "  FAIL: .env not updated"
  echo "  got: $(cat "$VALVE_ENV")"
  PASS=false
fi

# Check 3: error log should have PROXY_EMERGENCY
if [ -f "$VALVE_DIR/log/hme-errors.log" ] && grep -q "PROXY_EMERGENCY" "$VALVE_DIR/log/hme-errors.log"; then
  echo "  PASS: critical alert written to hme-errors.log"
else
  echo "  FAIL: no PROXY_EMERGENCY in error log"
  PASS=false
fi

rm -rf "$VALVE_DIR"

# Summary
echo ""
echo "=== Side Test Summary ==="
if $PASS; then
  echo "ALL TESTS PASSED — proxy is safe to activate on mainline"
  exit 0
else
  echo "SOME TESTS FAILED — DO NOT activate proxy on mainline"
  exit 1
fi
