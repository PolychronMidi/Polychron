'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { shrinkForPassthrough } = require('../../proxy/passthrough_compact');
const { handleLegacySwapResponse, writeAnthropicStopSse } = require('../../proxy/legacy_swap_response');
const { effectiveMode, buildMode1Chain, applyOverdriveRoute } = require('../../proxy/overdrive_route');

function quiet(fn) {
  const orig = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = orig; }
}

function fakeClientRes() {
  const calls = { headers: [], writes: [], ended: false };
  return {
    calls,
    writeHead(status, headers) { calls.headers.push({ status, headers }); },
    write(chunk) { calls.writes.push(String(chunk)); },
    end(chunk) { if (chunk) calls.writes.push(String(chunk)); calls.ended = true; },
  };
}

test('overdrive route retires legacy modes and keeps only mode 1 active', () => {
  for (const mode of ['0', '2', '3', '4', '5', '6', '', undefined]) {
    assert.equal(effectiveMode({ OVERDRIVE_MODE: mode }), '0');
  }
  assert.equal(effectiveMode({ OVERDRIVE_MODE: '1' }), '1');
});

test('mode 1 chain builder preserves team-role tier routing', () => {
  const cfg = {
    ranking_rules: { cost_order: ['free', 'usage'] },
    manually_toprank: { E5: ['manual-e5'] },
    team_role_models: { driver: { tier: 'E5', source: 'manually_toprank' } },
    tiers: { E5: { models: [
      { id: 'usage-e5', cost: 'usage', tier_score: 9 },
      { id: 'manual-e5', cost: 'free', tier_score: 1 },
      { id: 'free-e5', cost: 'free', tier_score: 5 },
    ] } },
  };
  const result = buildMode1Chain({ model: 'claude-sonnet-4-6', messages: [] }, { HME_TEAM_ROLE: 'driver' }, cfg);
  assert.equal(result.role, 'driver');
  assert.equal(result.tier, 'E5');
  assert.deepEqual(result.chain.map((m) => m.id), ['manual-e5', 'free-e5', 'usage-e5']);
});

test('mode 1 OmniRoute path rewrites Claude payload and strips direct auth', () => quiet(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od-route-'));
  try {
    const payload = { model: 'claude-sonnet-4-6', stream: true, messages: [{ role: 'user', content: 'hi' }], system: '', tools: [] };
    const clientReq = { headers: { authorization: 'Bearer direct', 'x-api-key': 'direct-key' }, url: '/v1/messages' };
    let strippedTools = false;
    let strippedIdentity = false;
    let contextPreflight = false;
    const result = applyOverdriveRoute({
      payload,
      clientReq,
      clientRes: fakeClientRes(),
      outBody: Buffer.from(JSON.stringify(payload)),
      stripStaleToolResults: () => { strippedTools = true; },
      stripClaudeIdentity: () => { strippedIdentity = true; },
      shrinkForContext: () => { contextPreflight = true; },
      env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake', HME_TEAM_ROLE: 'driver', HME_OMNIROUTE_PROVIDER: 'openai-responses' },
      projectRoot: tmp,
    });
    assert.equal(result.applied, true);
    assert.equal(result.isOmniRoute, true);
    assert.equal(result.isLegacySwap, false);
    assert.equal(strippedTools, true);
    assert.equal(strippedIdentity, true);
    assert.equal(contextPreflight, true);
    assert.match(payload.model, /^openai-responses\//);
    assert.match(clientReq.headers['x-hme-upstream'], /^http:\/\/127\.0\.0\.1:/);
    assert.equal(clientReq.headers.authorization, undefined);
    assert.equal(clientReq.headers['x-api-key'], undefined);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

test('passthrough compaction keeps Claude payload coherent after shrinking', () => {
  const logs = [];
  const payload = { messages: [] };
  for (let i = 0; i < 10; i += 1) payload.messages.push({ role: 'user', content: `message-${i} ${'x'.repeat(100)}` });
  const changed = shrinkForPassthrough(payload, {
    threshold: 1000,
    keepMin: 3,
    env: { HME_PROXY_LOCAL_SUMMARY: '1' },
    log: (msg) => logs.push(msg),
    projectRoot: os.tmpdir(),
  });
  assert.ok(changed > 0);
  assert.equal(payload.messages[0].role, 'user');
  assert.match(payload.messages[0].content, /^\(hme-proxy local-summary placeholder:/);
  assert.ok(JSON.stringify(payload).length <= 1000);
  assert.ok(logs.some((line) => line.includes('local-summary')));
});



test('passthrough microcompaction honors configured stale tool horizon', () => {
  const payload = { messages: [] };
  for (let i = 0; i < 20; i += 1) {
    const id = `tool-${i}`;
    payload.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] });
    payload.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(20000) }] });
  }
  const changed = shrinkForPassthrough(payload, {
    threshold: 400000,
    keepMin: 3,
    maxToolResultAge: 4,
    toolResultByteFloor: 1000,
    env: {},
    log: () => {},
    projectRoot: os.tmpdir(),
  });
  assert.ok(changed > 0);
  assert.ok(JSON.stringify(payload).length <= 400000);
  const results = payload.messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []);
  assert.ok(results.slice(0, -2).every((b) => String(b.content).includes('content elided by hme-proxy precompact')));
  assert.ok(results.slice(-2).every((b) => String(b.content).length === 20000));
});


test('passthrough compaction drops oldest messages when microcompaction cannot hit threshold', () => {
  const payload = { messages: [] };
  for (let i = 0; i < 10; i += 1) {
    const id = `tool-${i}`;
    payload.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] });
    payload.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(20000) }] });
  }
  const changed = shrinkForPassthrough(payload, {
    threshold: 1000,
    keepMin: 3,
    maxToolResultAge: 4,
    toolResultByteFloor: 1000,
    env: {},
    log: () => {},
    projectRoot: os.tmpdir(),
  });
  assert.ok(changed > 0);
  assert.ok(JSON.stringify(payload).length <= 1000);
  assert.ok(payload.messages.length <= 4);
});

test('legacy swap auth failure emits Anthropic stop SSE instead of surfacing 401', () => quiet(() => {
  const clientRes = fakeClientRes();
  let released = false;
  assert.equal(handleLegacySwapResponse({ upstreamRes: { statusCode: 401 }, clientRes, wasStreaming: true, releaseOpusSlot: () => { released = true; }, model: 'test-model' }), true);
  assert.equal(clientRes.calls.headers[0].status, 200);
  assert.equal(clientRes.calls.ended, true);
  assert.match(clientRes.calls.writes.join(''), /event: message_stop/);
  assert.equal(released, false);
}));

test('stop SSE writer includes required Anthropic stream envelope', () => {
  const clientRes = fakeClientRes();
  writeAnthropicStopSse(clientRes, 'test-model');
  const body = clientRes.calls.writes.join('');
  assert.match(body, /event: message_start/);
  assert.match(body, /event: message_delta/);
  assert.match(body, /event: message_stop/);
  assert.match(body, /"model":"test-model"/);
});
