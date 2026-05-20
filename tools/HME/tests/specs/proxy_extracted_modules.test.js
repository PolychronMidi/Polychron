'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sessionKey } = require('../../proxy/shared');
const { stripStaleToolResults } = require('../../proxy/conversation_graph');
const { shrinkForPassthrough } = require('../../proxy/passthrough_compact');
const { createContextBudget } = require('../../proxy/hme_proxy_context_budget');
const { mutateClaudeRequest } = require('../../proxy/hme_proxy_request_mutation');
const { handleLegacySwapResponse, writeAnthropicStopSse } = require('../../proxy/legacy_swap_response');
const { effectiveMode, buildMode1Chain, applyOverdriveRoute, upstreamModelId, roleFromPayload } = require('../../proxy/overdrive_route');
const { reasoningTextFromData, providerReasoningToThinkingRewrite } = require('../../proxy/reasoning_to_thinking');
const { _jsonStats } = require('../../proxy/hme_proxy_response_trace');
const { loadEnv, requireEnvInt } = require('../../proxy/shared/load_env');
const { _contextTokenUsageFields, _extractUsageFromBody } = require('../../proxy/hme_proxy_anthropic_response');
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

test('env loader fails fast on missing templated keys and invalid typed reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-env-contract-'));
  const prev = process.env.HME_ENV_FAILFAST_TEMPLATE;
  try {
    fs.mkdirSync(path.join(dir, 'doc', 'templates'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'doc', 'templates', '.env.example'), 'A=1\nB=2\nPORT=3\n');
    fs.writeFileSync(path.join(dir, '.env'), 'A=ok\nPORT=abc\n');
    assert.throws(
      () => loadEnv(path.join(dir, '.env'), { overwrite: true }),
      /missing template key\(s\): B/,
    );
    fs.writeFileSync(path.join(dir, '.env'), 'A=ok\nB=present\nPORT=abc\n');
    loadEnv(path.join(dir, '.env'), { overwrite: true });
    assert.throws(() => requireEnvInt('PORT'), /invalid integer environment key PORT/);
  } finally {
    if (prev === undefined) delete process.env.HME_ENV_FAILFAST_TEMPLATE;
    else process.env.HME_ENV_FAILFAST_TEMPLATE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context token usage parser extracts Anthropic JSON and SSE usage', () => {
  assert.deepEqual(
    _extractUsageFromBody({ 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ usage: { input_tokens: 123, output_tokens: 45 } }))),
    { input_tokens: 123, output_tokens: 45 },
  );
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":456,"output_tokens":0}}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":78}}',
    '',
  ].join('\n');
  assert.deepEqual(
    _extractUsageFromBody({ 'content-type': 'text/event-stream' }, Buffer.from(sse)),
    { input_tokens: 456, output_tokens: 78 },
  );
});

test('context token usage fields separate upstream headers from synthetic context signal', () => {
  const row = _contextTokenUsageFields({
    headers: { 'content-type': 'application/json', 'anthropic-ratelimit-input-tokens-remaining': '2500' },
    rateLimitHeaders: { 'content-type': 'application/json' },
    status: 200,
    payload: { model: 'gpt-test' },
    outBody: Buffer.from('abcdefghij'),
    outBuf: Buffer.from(JSON.stringify({ usage: { input_tokens: 4, output_tokens: 2 } })),
    route: 'omni-context',
    model: 'gpt-test',
    thresholdBytes: 1000,
    estimatedTokensFn: (bytes) => bytes / 2,
    getLastInputTokensRemaining: () => null,
    getLastInputTokensLimit: () => null,
  });
  assert.equal(row.header_input_tokens_source, 'none');
  assert.equal(row.header_input_tokens_remaining, null);
  assert.equal(row.context_signal_input_tokens_remaining, 2500);
  assert.equal(row.estimated_input_tokens, 5);
  assert.equal(row.usage_input_tokens, 4);
  assert.equal(row.estimated_vs_usage_delta, 1);

  const upstream = _contextTokenUsageFields({
    headers: { 'content-type': 'application/json' },
    rateLimitHeaders: { 'anthropic-ratelimit-input-tokens-limit': '20000', 'anthropic-ratelimit-input-tokens-remaining': '12345' },
    status: 200,
    payload: { model: 'claude-test' },
    outBody: Buffer.from('abc'),
    outBuf: Buffer.from('{}'),
    route: 'direct',
    thresholdBytes: 250000,
  });
  assert.equal(upstream.header_input_tokens_source, 'upstream');
  assert.equal(upstream.header_input_tokens_limit, 20000);
  assert.equal(upstream.header_input_tokens_remaining, 12345);
  assert.equal(upstream.header_input_tokens_used, 7655);
});

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
  const telemetry = [];
  const changed = shrinkForPassthrough(payload, {
    threshold: 400000,
    keepMin: 3,
    maxToolResultAge: 4,
    toolResultByteFloor: 1000,
    env: {},
    log: () => {},
    telemetry: (row) => telemetry.push(row),
    route: 'test-route',
    model: 'test-model',
    projectRoot: os.tmpdir(),
  });
  assert.ok(changed > 0);
  assert.ok(JSON.stringify(payload).length <= 400000);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].event, 'context_compaction');
  assert.equal(telemetry[0].route, 'test-route');
  assert.equal(telemetry[0].model, 'test-model');
  assert.equal(telemetry[0].stage, 'microcompact');
  assert.equal(telemetry[0].messages_dropped, 0);
  assert.ok(telemetry[0].stale_tool_results_elided > 0);
  assert.ok(telemetry[0].before_bytes > telemetry[0].after_bytes);
  assert.equal(telemetry[0].threshold_bytes, 400000);
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
  const telemetry = [];
  const changed = shrinkForPassthrough(payload, {
    threshold: 1000,
    keepMin: 3,
    maxToolResultAge: 4,
    toolResultByteFloor: 1000,
    env: {},
    log: () => {},
    telemetry: (row) => telemetry.push(row),
    route: 'drop-test',
    model: 'drop-model',
    projectRoot: os.tmpdir(),
  });
  assert.ok(changed > 0);
  assert.ok(JSON.stringify(payload).length <= 1000);
  assert.ok(payload.messages.length <= 4);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].event, 'context_compaction');
  assert.equal(telemetry[0].route, 'drop-test');
  assert.equal(telemetry[0].model, 'drop-model');
  assert.equal(telemetry[0].stage, 'message_drop');
  assert.ok(telemetry[0].messages_dropped > 0);
  assert.ok(telemetry[0].before_messages > telemetry[0].after_messages);
  assert.ok(telemetry[0].before_bytes > telemetry[0].after_bytes);
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

test('context budget compaction gears start near context high-water and escalate', () => {
  const oldEnv = { ...process.env };
  try {
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_COMPACT_KEEP_MIN = '4';
    process.env.HME_PROXY_COMPACT_BYTES = '3000000';
    process.env.HME_PROXY_COMPACT_START_FRACTION = '0.80';
    process.env.HME_PROXY_COMPACT_GEAR1_END = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR2_END = '0.97';
    process.env.HME_PROXY_COMPACT_GEAR1_TARGET = '0.80';
    process.env.HME_PROXY_COMPACT_GEAR2_TARGET = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR3_TARGET = '0.97';
    const budget = createContextBudget();
    budget.setLastInputTokensLimit(1000);

    let payload = { messages: [{ role: 'user', content: 'x'.repeat(750) }] };
    let plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 0);
    assert.equal(plan.threshold, Infinity);

    payload = { messages: [{ role: 'user', content: 'x'.repeat(830) }] };
    plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 1);
    assert.equal(plan.threshold, 800);

    payload = { messages: [{ role: 'user', content: 'x'.repeat(880) }] };
    plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 2);
    assert.equal(plan.threshold, 900);

    payload = { messages: [{ role: 'user', content: 'x'.repeat(990) }] };
    plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 3);
    assert.equal(plan.threshold, 970);
  } finally {
    process.env = oldEnv;
  }
});

test('context budget does not compact 90k token GPT-5.5 payload below high-water', () => {
  const oldEnv = { ...process.env };
  try {
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_COMPACT_KEEP_MIN = '4';
    process.env.HME_PROXY_COMPACT_BYTES = '3000000';
    const budget = createContextBudget();
    const payload = { model: 'gpt-5.5-high', messages: [{ role: 'user', content: 'x'.repeat(90000) }] };
    const plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 0);
    assert.equal(plan.threshold, Infinity);
    const changed = budget.shrinkForPassthrough(payload);
    assert.equal(changed, 0);
    assert.equal(payload.messages.length, 1);
  } finally {
    process.env = oldEnv;
  }
});

test('explicit compact byte cap does not force emergency tier below high-water', () => {
  const oldEnv = { ...process.env };
  try {
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_COMPACT_BYTES = '250000';
    const budget = createContextBudget();
    budget.setLastInputTokensLimit(272000);
    const payload = { model: 'gpt-5.5-high', messages: [{ role: 'user', content: 'x'.repeat(90000) }] };
    const plan = budget.effectiveCompactThreshold(payload);
    assert.equal(plan.maxTier, 0);
    assert.equal(plan.threshold, Infinity);
    assert.equal(budget.shrinkForPassthrough(payload), 0);
  } finally {
    process.env = oldEnv;
  }
});

test('live-ish 90k GPT-5.5 passthrough smoke emits no compaction markers', () => {
  const oldEnv = { ...process.env };
  const logs = [];
  try {
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_COMPACT_BYTES = '3000000';
    process.env.HME_PROXY_COMPACT_TRACE = '1';
    process.env.HME_PROXY_COMPACT_START_FRACTION = '0.80';
    process.env.HME_PROXY_COMPACT_GEAR1_END = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR2_END = '0.97';
    process.env.HME_PROXY_COMPACT_GEAR1_TARGET = '0.80';
    process.env.HME_PROXY_COMPACT_GEAR2_TARGET = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR3_TARGET = '0.97';
    const origError = console.error;
    console.error = (msg) => logs.push(String(msg));
    try {
      const budget = createContextBudget();
      const payload = { model: 'gpt-5.5-high', messages: [{ role: 'user', content: 'x'.repeat(90000) }] };
      const before = JSON.stringify(payload);
      assert.equal(budget.shrinkForPassthrough(payload), 0);
      assert.equal(JSON.stringify(payload), before);
    } finally {
      console.error = origError;
    }
    const logText = logs.join('\n');
    assert.match(logText, /compact-decision model=gpt-5\.5-high/);
    assert.match(logText, /gear=0/);
    assert.doesNotMatch(logText, /passthrough-compact decision|precompact|content elided|oldest message\(s\) dropped/);
  } finally {
    process.env = oldEnv;
  }
});


test('request mutation passthrough path leaves 90k GPT-5.5 context unelided', async () => {
  const oldEnv = { ...process.env };
  const logs = [];
  try {
    process.env.OVERDRIVE_MODE = '0';
    process.env.HME_PROXY_FORCE_PASSTHROUGH = '1';
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_COMPACT_BYTES = '3000000';
    process.env.HME_PROXY_COMPACT_TRACE = '1';
    process.env.HME_PROXY_COMPACT_START_FRACTION = '0.80';
    process.env.HME_PROXY_COMPACT_GEAR1_END = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR2_END = '0.97';
    process.env.HME_PROXY_COMPACT_GEAR1_TARGET = '0.80';
    process.env.HME_PROXY_COMPACT_GEAR2_TARGET = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR3_TARGET = '0.97';
    const payload = { model: 'gpt-5.5-high', messages: [{ role: 'user', content: 'x'.repeat(90000) }] };
    const before = JSON.stringify(payload);
    const budget = createContextBudget();
    const origError = console.error;
    console.error = (msg) => logs.push(String(msg));
    try {
      const result = await mutateClaudeRequest({
        payload,
        outBody: Buffer.from(before, 'utf8'),
        injected: false,
        upstream: { provider: 'anthropic' },
        clientReq: { url: '/v1/messages' },
        isAnthropic: true,
        isInteractivePath: true,
        shrinkForPassthrough: budget.shrinkForPassthrough,
        stripHmePrefixOutgoing: () => false,
        injectHmeTools: async () => 0,
        sanitizePayload: () => {},
        injectStopReminderSystem: () => false,
        lifecycleInactive: () => false,
        runInlineFallback: () => {},
        middleware: { runPipeline: async () => false },
      });
      assert.equal(result.passthrough, true);
      assert.equal(result.outBody.toString('utf8'), before);
      assert.equal(JSON.stringify(payload), before);
    } finally {
      console.error = origError;
    }
    const logText = logs.join('\n');
    assert.match(logText, /compact-decision model=gpt-5\.5-high/);
    assert.doesNotMatch(logText, /passthrough-compact decision|precompact|content elided|oldest message\(s\) dropped/);
  } finally {
    process.env = oldEnv;
  }
});

test('message dropping is disabled until gear three', () => {
  const payload = { messages: [] };
  for (let i = 0; i < 20; i += 1) {
    const id = `gear-two-tool-${i}`;
    payload.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] });
    payload.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(60000) }] });
  }
  const beforeCount = payload.messages.length;
  const changed = shrinkForPassthrough(payload, {
    effectiveThreshold: () => ({ threshold: 1000, maxTier: 2, maxToolResultAge: 4, toolResultByteFloor: 50000 }),
    keepMin: 3,
    env: { HME_PROXY_LOCAL_SUMMARY: '0' },
    log: () => {},
    projectRoot: os.tmpdir(),
  });
  assert.ok(changed > 0);
  assert.equal(payload.messages.length, beforeCount);
  assert.doesNotMatch(JSON.stringify(payload), /passthrough-compact: .*oldest message/);
});


test('high keepTurns prevents stale tool stripping in long GPT-5.5 sessions', () => {
  const payload = { model: 'gpt-5.5-high', messages: [] };
  for (let i = 0; i < 120; i += 1) {
    const id = `kept-tool-${i}`;
    payload.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] });
    payload.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `result-${i}` }] });
  }
  const before = JSON.stringify(payload);
  assert.equal(stripStaleToolResults(payload, 200), 0);
  assert.equal(JSON.stringify(payload), before);
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
