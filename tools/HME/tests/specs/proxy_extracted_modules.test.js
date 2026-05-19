'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sessionKey } = require('../../proxy/shared');
const { shrinkForPassthrough } = require('../../proxy/passthrough_compact');
const { createContextBudget } = require('../../proxy/hme_proxy_context_budget');
const { handleLegacySwapResponse, writeAnthropicStopSse } = require('../../proxy/legacy_swap_response');
const { effectiveMode, buildMode1Chain, applyOverdriveRoute, upstreamModelId, roleFromPayload } = require('../../proxy/overdrive_route');
const { reasoningTextFromData, providerReasoningToThinkingRewrite } = require('../../proxy/reasoning_to_thinking');
const { _jsonStats } = require('../../proxy/hme_proxy_response_trace');
const codexFallback = require('../../proxy/hme_proxy_codex');

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

function anthropicOnlyCfg() {
  return {
    providers_to_skip: { providers: [] },
    ranking_rules: { cost_order: ['subscription', 'free', 'usage'] },
    manually_toprank: { E5: ['claude-opus-4-7-max-e5'], driver: [''] },
    team_role_models: {
      driver: { source: 'manually_toprank', tier: 'E5' },
      stage_crew: { source: 'ranking_rules', tier: 'role' },
    },
    tiers: { E5: { models: [
      { id: 'claude-opus-4-7-max-e5', provider: 'anthropic', api_model: 'claude-opus-4-7', cost: 'subscription', tier_score: 9 },
    ] } },
  };
}

test('sessionKey prefers stable Anthropic metadata session id over content hash', () => {
  const payload = {
    metadata: {
      user_id: JSON.stringify({ device_id: 'dev', session_id: 'real-session-id' }),
    },
    messages: [{ role: 'user', content: 'first prompt text' }],
  };
  assert.equal(sessionKey(payload), 'real-session-id');
});

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

test('Anthropic registry variants route with api_model instead of registry id', () => {
  assert.equal(upstreamModelId({ id: 'claude-opus-4-7-max-e5', api_model: 'claude-opus-4-7' }), 'claude-opus-4-7');
  assert.equal(upstreamModelId({ id: 'deepseek-v4-pro-go' }), 'deepseek-v4-pro');
});

test('mode 1 top-level requests default to driver E5 manual top rank', () => {
  const cfg = {
    ranking_rules: { cost_order: ['subscription', 'free'] },
    manually_toprank: { E5: ['gpt-top-e5'], driver: ['manual-sonnet-e3'] },
    team_role_models: { driver: { tier: 'E5', source: 'manually_toprank' } },
    tiers: {
      E5: { models: [
        { id: 'gpt-top-e5', provider: 'codex', cost: 'subscription', tier_score: 10 },
        { id: 'ranked-opus-e5', provider: 'anthropic', api_model: 'claude-opus-4-7', cost: 'subscription', tier_score: 9 },
      ] },
      E3: { models: [
        { id: 'manual-sonnet-e3', provider: 'anthropic', api_model: 'claude-sonnet-4-6', cost: 'subscription', tier_score: 1 },
      ] },
    },
  };
  const result = buildMode1Chain({ model: 'claude-sonnet-4-6', messages: [] }, {}, cfg);
  assert.equal(result.role, 'driver');
  assert.equal(result.tier, 'E5');
  assert.deepEqual(result.chain.map((m) => m.id), ['manual-sonnet-e3', 'gpt-top-e5', 'ranked-opus-e5']);
});

test('OmniRoute fallback helpers use api_model for Anthropic variants', () => {
  assert.equal(
    codexFallback.upstreamModelId({ id: 'claude-sonnet-4-6-high-e2', api_model: 'claude-sonnet-4-6' }),
    'claude-sonnet-4-6',
  );
  assert.notEqual(
    codexFallback.chainSignature([{ provider: 'anthropic', id: 'a', api_model: 'claude-sonnet-4-6' }]),
    codexFallback.chainSignature([{ provider: 'anthropic', id: 'a', api_model: 'claude-haiku-4-5' }]),
  );
});

test('non-streaming Anthropic JSON response with text is not blank', () => {
  const stats = _jsonStats(JSON.stringify({
    model: 'claude-sonnet-4-6',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
    stop_reason: 'end_turn',
  }));
  assert.equal(stats.textChars, 5);
  assert.equal(stats.textBlocks, 1);
  assert.equal(stats.toolUseBlocks, 0);
  assert.equal(stats.stopReason, 'end_turn');
});

test('non-streaming Anthropic JSON response with tool use is not blank', () => {
  const stats = _jsonStats(JSON.stringify({
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }],
    stop_reason: 'tool_use',
  }));
  assert.equal(stats.textChars, 0);
  assert.equal(stats.toolUseBlocks, 1);
  assert.equal(stats.stopReason, 'tool_use');
});

test('blank retry is disabled for max_tokens probes but NOT for manual top-rank chains', () => {
  // manually_toprank only fronts the chain; blank retry still cascades.
  assert.equal(
    codexFallback.blankRetryDisabledReason({
      payload: { max_tokens: 1 },
      swapChain: [{ id: 'manual-sonnet', _manual_toprank: true }, { id: 'ranked-opus' }],
      env: {},
    }),
    'max_tokens_probe',
  );
  assert.equal(
    codexFallback.blankRetryDisabledReason({
      payload: { max_tokens: 200 },
      swapChain: [{ id: 'manual-sonnet', _manual_toprank: true }, { id: 'ranked-opus' }],
      env: {},
    }),
    '',
    'manual top-rank no longer cancels blank-retry cascade',
  );
});

test('mode 1 real models.json driver override beats E5 manual fallback', () => {
  const cfg = require('../../proxy/shared').loadModelsJson();
  const result = buildMode1Chain({ model: 'claude-sonnet-4-6', messages: [] }, {}, cfg);
  assert.equal(result.role, 'driver');
  assert.equal(result.chain[0].id, 'gpt-5.5-xhigh');
  assert.notEqual(result.chain[0].id, 'claude-sonnet-4-6-max-e3');
});

test('role detection ignores stale role text in system-reminder continuation context', () => {
  const payload = {
    model: 'claude-sonnet-4-6',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nold transcript said You are Blue Lead\n</system-reminder>' }] },
      { role: 'user', content: [{ type: 'text', text: 'restarted to see if sonnet only is being properly used now' }] },
    ],
  };
  assert.equal(roleFromPayload(payload, {}), 'driver');
});

test('role detection still honors explicit live team lead prompts', () => {
  assert.equal(roleFromPayload({ messages: [{ role: 'user', content: 'You are Blue Lead\nRun this check.' }] }, {}), 'blue_lead');
});

test('mode 1 same-chain fallback index advances even when chain has a manual top', () => quiet(() => {
  // manually_toprank only fronts the chain; failover still progresses through it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od-route-manual-same-chain-'));
  try {
    const { chainSignature } = require('../../proxy/overdrive_route');
    const cfg = require('../../proxy/shared').loadModelsJson();
    const chainInfo = buildMode1Chain({ model: 'claude-sonnet-4-6', messages: [] }, {}, cfg);
    fs.mkdirSync(path.join(tmp, 'tmp'), { recursive: true });
    // fail>0 + recent ts triggers honoring idx from state.
    fs.writeFileSync(path.join(tmp, 'tmp/hme-omni-swap-state.json'), JSON.stringify({ idx: 1, chain: chainSignature(chainInfo.chain), fail: 1, ts: Date.now() }));
    const payload = { model: 'claude-sonnet-4-6', stream: true, messages: [{ role: 'user', content: 'hi' }], system: '', tools: [] };
    const clientReq = { headers: { authorization: 'Bearer direct' }, url: '/v1/messages' };
    const result = applyOverdriveRoute({
      payload, clientReq, clientRes: fakeClientRes(), outBody: Buffer.from(JSON.stringify(payload)),
      stripStaleToolResults: () => {}, stripClaudeIdentity: () => {}, shrinkForContext: () => {},
      env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake' }, projectRoot: tmp,
    });
    assert.equal(result.swapMeta.id, chainInfo.chain[1].id, 'fallback index 1 selects chain[1]');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

test('mode 1 stale fallback index resets to chain[0] on chain-signature mismatch', () => quiet(() => {
  // Stale signature mismatch resets idx=0; manual top fronting still applies.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od-route-manual-top-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tmp/hme-omni-swap-state.json'), JSON.stringify({ idx: 9, chain: 'old-chain', fail: 9, ts: Date.now() }));
    const payload = { model: 'claude-sonnet-4-6', stream: false, messages: [{ role: 'user', content: 'hi' }], system: '', tools: [] };
    const clientReq = { headers: { authorization: 'Bearer direct' }, url: '/v1/messages' };
    const result = applyOverdriveRoute({
      payload,
      clientReq,
      clientRes: fakeClientRes(),
      outBody: Buffer.from(JSON.stringify(payload)),
      stripStaleToolResults: () => {},
      stripClaudeIdentity: () => {},
      shrinkForContext: () => {},
      env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake' },
      projectRoot: tmp,
      cfg: anthropicOnlyCfg(),
    });
    assert.equal(result.applied, true);
    assert.equal(result.swapMeta.id, 'claude-opus-4-7-max-e5');
    assert.match(payload.model, /^claude\/claude-opus-4-7/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

test('mode 1 chain skips configured providers and keeps Anthropic top', () => {
  const cfg = {
    providers_to_skip: { providers: ['opencode_go'] },
    ranking_rules: { cost_order: ['subscription', 'free'] },
    manually_toprank: { E5: ['anthropic-top'] },
    team_role_models: { driver: { tier: 'E5', source: 'manually_toprank' } },
    tiers: { E5: { models: [
      { id: 'anthropic-top', provider: 'anthropic', cost: 'subscription', tier_score: 9 },
      { id: 'opencode-skip', provider: 'opencode-go', cost: 'free', tier_score: 10 },
      { id: 'codex-ok', provider: 'codex', cost: 'free', tier_score: 1 },
    ] } },
  };
  const result = buildMode1Chain({ model: 'claude-opus-4-7', messages: [] }, { HME_TEAM_ROLE: 'driver' }, cfg);
  assert.deepEqual(result.chain.map((m) => m.id), ['anthropic-top', 'codex-ok']);
});

test('mode 1 route health quarantine skips routes unless forced', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-route-health-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools', 'HME', 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tools', 'HME', 'runtime', 'model-route-health.json'), JSON.stringify({
      'kilo-gateway/kilo-auto/free': { status: 'blocked', reason: 'manual test' },
    }));
    const cfg = {
      providers_to_skip: { providers: [] },
      ranking_rules: { cost_order: ['free'] },
      manually_toprank: { E5: [] },
      team_role_models: { driver: { tier: 'E5', source: 'ranking_rules' } },
      tiers: { E5: { models: [
        { id: 'kilo-auto-free', provider: 'kilo-gateway', api_model: 'kilo-auto/free', cost: 'free', tier_score: 9 },
        { id: 'step-free', provider: 'kilo-gateway', api_model: 'stepfun/step-3.5-flash:free', cost: 'free', tier_score: 5 },
      ] } },
    };
    const payload = { model: 'claude-sonnet-4-6', messages: [] };
    const normal = buildMode1Chain(payload, { HME_TEAM_ROLE: 'driver' }, cfg, { projectRoot: tmp });
    const forced = buildMode1Chain(payload, { HME_TEAM_ROLE: 'driver', HME_FORCE_QUARANTINED_ROUTES: '1' }, cfg, { projectRoot: tmp });
    assert.deepEqual(normal.chain.map((m) => m.id), ['step-free']);
    assert.deepEqual(forced.chain.map((m) => m.id), ['kilo-auto-free', 'step-free']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('mode 1 Anthropic registry uses Claude OAuth provider without API key', () => quiet(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od-route-claude-oauth-'));
  try {
    const payload = { model: 'claude-opus-4-7', stream: false, messages: [{ role: 'user', content: 'hi' }], system: '', tools: [] };
    const clientReq = { headers: { authorization: 'Bearer direct' }, url: '/v1/messages' };
    const result = applyOverdriveRoute({
      payload,
      clientReq,
      clientRes: fakeClientRes(),
      outBody: Buffer.from(JSON.stringify(payload)),
      stripStaleToolResults: () => {},
      stripClaudeIdentity: () => {},
      shrinkForContext: () => {},
      env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake', HME_TEAM_ROLE: 'stage_crew' },
      projectRoot: tmp,
      cfg: anthropicOnlyCfg(),
    });
    assert.equal(result.applied, true);
    assert.match(payload.model, /^claude\/claude-opus-4-7/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

test('mode 1 OmniRoute path strips Claude Code adaptive thinking extras', () => quiet(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od-route-thinking-'));
  try {
    const payload = {
      model: 'claude-opus-4-7',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
      system: '',
      tools: [],
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    };
    const clientReq = { headers: { authorization: 'Bearer direct' }, url: '/v1/messages' };
    const result = applyOverdriveRoute({
      payload,
      clientReq,
      clientRes: fakeClientRes(),
      outBody: Buffer.from(JSON.stringify(payload)),
      stripStaleToolResults: () => {},
      stripClaudeIdentity: () => {},
      shrinkForContext: () => {},
      env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake', HME_TEAM_ROLE: 'stage_crew' },
      projectRoot: tmp,
      cfg: anthropicOnlyCfg(),
    });
    assert.equal(result.applied, true);
    assert.match(payload.model, /^claude\/claude-opus-4-7/);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'thinking'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'output_config'), false);
    assert.doesNotMatch(result.outBody.toString('utf8'), /adaptive|output_config/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

test('mode 1 OmniRoute path omits schema-extra thinkingLevel for Anthropic models', () => quiet(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od-route-effort-'));
  try {
    const payload = { model: 'claude-opus-4-7', stream: false, messages: [{ role: 'user', content: 'hi' }], system: '', tools: [] };
    const clientReq = { headers: { authorization: 'Bearer direct' }, url: '/v1/messages' };
    const result = applyOverdriveRoute({
      payload,
      clientReq,
      clientRes: fakeClientRes(),
      outBody: Buffer.from(JSON.stringify(payload)),
      stripStaleToolResults: () => {},
      stripClaudeIdentity: () => {},
      shrinkForContext: () => {},
      env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake', ANTHROPIC_API_KEY: 'fake', HME_TEAM_ROLE: 'stage_crew' },
      projectRoot: tmp,
      cfg: anthropicOnlyCfg(),
    });
    assert.equal(result.applied, true);
    assert.match(payload.model, /^anthropic\/claude-opus-4-7/);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'thinkingLevel'), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

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
      env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake', HME_TEAM_ROLE: 'stage_crew' },
      projectRoot: tmp,
    });
    assert.equal(result.applied, true);
    assert.equal(result.isOmniRoute, true);
    assert.equal(result.isLegacySwap, false);
    assert.equal(strippedTools, true);
    assert.equal(strippedIdentity, true);
    assert.equal(contextPreflight, true);
    assert.match(payload.model, /^[a-z-]+\//);
    assert.match(clientReq.headers['x-hme-upstream'], /^http:\/\/127\.0\.0\.1:/);
    assert.equal(clientReq.headers.authorization, undefined);
    assert.equal(clientReq.headers['x-api-key'], undefined);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}));

test('mode 1 provider override applies capability matrix request overrides', () => quiet(() => {
  for (const provider of ['aihubmix', 'kilo-gateway']) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od-route-nonstream-'));
    try {
      const payload = { model: 'claude-sonnet-4-6', stream: true, messages: [{ role: 'user', content: 'hi' }], system: '', tools: [] };
      const clientReq = { headers: { authorization: 'Bearer direct', 'x-api-key': 'direct' }, url: '/v1/messages' };
      const result = applyOverdriveRoute({
        payload,
        clientReq,
        clientRes: fakeClientRes(),
        outBody: Buffer.from(JSON.stringify(payload)),
        stripStaleToolResults: () => {},
        stripClaudeIdentity: () => {},
        shrinkForContext: () => {},
        env: { OVERDRIVE_MODE: '1', OPENCODE_API_KEY: 'fake', HME_TEAM_ROLE: 'stage_crew', HME_OMNIROUTE_PROVIDER: provider },
        projectRoot: tmp,
      });
      const routed = JSON.parse(result.outBody.toString('utf8'));
      assert.equal(result.applied, true);
      assert.equal(result.omniProvider, provider);
      assert.equal(routed.non_stream, true);
      assert.match(routed.model, new RegExp(`^${provider}/`));
      assert.equal(clientReq.headers.authorization, undefined);
      assert.equal(clientReq.headers['x-api-key'], undefined);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
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

test('provider reasoning fields convert to Anthropic thinking events', () => {
  const ctx = new Map();
  const data = { type: 'response.reasoning_summary_text.delta', delta: { text: 'reasoned path' } };
  assert.equal(reasoningTextFromData(data), 'reasoned path');
  const out = providerReasoningToThinkingRewrite('response.reasoning_summary_text.delta', data, ctx);
  assert.ok(Array.isArray(out.events));
  assert.equal(out.events[0][0], 'content_block_start');
  assert.equal(out.events[0][1].content_block.type, 'thinking');
  assert.equal(out.events[1][0], 'content_block_delta');
  assert.equal(out.events[1][1].delta.type, 'thinking_delta');
  assert.equal(out.events[1][1].delta.thinking, 'reasoned path');
});


test('non-reasoning delta text is not converted to thinking', () => {
  const data = { type: 'response.output_text.delta', delta: { text: 'visible answer' } };
  assert.equal(reasoningTextFromData(data), '');
  assert.equal(providerReasoningToThinkingRewrite('response.output_text.delta', data, new Map()), data);
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

test('context budget compaction gears start at half input and escalate', () => {
  const oldEnv = { ...process.env };
  try {
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_COMPACT_KEEP_MIN = '4';
    delete process.env.HME_PROXY_COMPACT_BYTES;
    const budget = createContextBudget();
    budget.setLastInputTokensLimit(1000);

    let payload = { messages: [{ role: 'user', content: 'x'.repeat(450) }] };
    let plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 0);
    assert.equal(plan.threshold, Infinity);

    payload = { messages: [{ role: 'user', content: 'x'.repeat(520) }] };
    plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 1);
    assert.equal(plan.threshold, 500);

    payload = { messages: [{ role: 'user', content: 'x'.repeat(700) }] };
    plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 2);
    assert.equal(plan.threshold, 650);

    payload = { messages: [{ role: 'user', content: 'x'.repeat(900) }] };
    plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 3);
    assert.equal(plan.threshold, 850);
  } finally {
    process.env = oldEnv;
  }
});

test('gear one only elides stale lengthy tool results', () => {
  const payload = { messages: [] };
  for (let i = 0; i < 8; i += 1) {
    const id = `gear-tool-${i}`;
    payload.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] });
    payload.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(60000) }] });
  }
  const beforeCount = payload.messages.length;
  const changed = shrinkForPassthrough(payload, {
    effectiveThreshold: () => ({ threshold: 1000, maxTier: 1, maxToolResultAge: 4, toolResultByteFloor: 50000 }),
    keepMin: 3,
    env: { HME_PROXY_LOCAL_SUMMARY: '1' },
    log: () => {},
    projectRoot: os.tmpdir(),
  });
  assert.ok(changed > 0);
  assert.equal(payload.messages.length, beforeCount);
  const results = payload.messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []);
  assert.ok(results.slice(0, -2).every((b) => String(b.content).includes('content elided by hme-proxy precompact')));
  assert.ok(results.slice(-2).every((b) => String(b.content).length === 60000));
});
