'use strict';
const { requireEnv: _hmeRequireEnv } = require('../../proxy/shared/load_env.js');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = _hmeRequireEnv('PROJECT_ROOT');
const proxyDir = path.join(repo, 'tools/HME/proxy');

function lineCount(rel) {
  return fs.readFileSync(path.join(proxyDir, rel), 'utf8').split('\n').length;
}

test('proxy modules stay below enforced 350 LOC ceiling', () => {
  const modules = [
    'hme_proxy.js',
    'hme_proxy_claude.js',
    'hme_proxy_routes.js',
    'hme_proxy_opus_gate.js',
    'hme_proxy_request_mutation.js',
    'hme_proxy_anthropic_response.js',
    'hme_proxy_connection_errors.js',
  ];
  for (const rel of modules) {
    assert.ok(fs.existsSync(path.join(proxyDir, rel)), `${rel} exists`);
    assert.ok(lineCount(rel) <= 350, `${rel} should stay at or below enforced 350 LOC ceiling`);
  }
});

test('split proxy modules parse cleanly with node -c', () => {
  const modules = [
    'hme_proxy.js',
    'hme_proxy_claude.js',
    'hme_proxy_routes.js',
    'hme_proxy_opus_gate.js',
    'hme_proxy_request_mutation.js',
    'hme_proxy_headers.js',
    'hme_proxy_context_budget.js',
    'hme_proxy_anthropic_response.js',
    'hme_proxy_connection_errors.js',
    'hme_proxy_response_trace.js',
    'hme_proxy_response_send.js',
    'hme_proxy_upstream_failure.js',
  ];
  for (const rel of modules) {
    const full = path.join(proxyDir, rel);
    assert.ok(fs.existsSync(full), `${rel} exists`);
    const result = spawnSync(process.execPath, ['-c', full], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${rel} parses: ${result.stderr || result.stdout}`);
  }
});

test('hme_proxy_core no longer owns context-budget state', () => {
  const core = fs.readFileSync(path.join(proxyDir, 'hme_proxy_core.js'), 'utf8');
  for (const needle of [
    '_envNumber',
    '_resolveModelCtx',
    '_estimatedContextTokens',
    '_effectiveCompactThreshold',
    '_shrinkForPassthrough',
    '_shrinkForOmniContext',
    '_lastInputTokensRemaining',
    '_lastPayloadBytes',
  ]) {
    assert.equal(core.includes(needle), false, `${needle} should live outside hme_proxy_core.js`);
  }
});
