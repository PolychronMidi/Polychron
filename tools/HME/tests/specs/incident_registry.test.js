'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const incidents = require('../../proxy/incident_registry');

test('incident registry formats LIFESAVER-compatible text', () => {
  const line = incidents.formatIncidentLine({
    id: 'proxy-liveness',
    severity: 'lifesaver',
    component: 'proxy',
    summary: 'proxy is down',
    repair: 'restart proxy',
  });
  assert.match(line, incidents.LIFESAVER_TEXT_RE);
  assert.match(line, /proxy is down/);
  assert.match(line, /repair=restart proxy/);
});

test('incident registry writes text log plus structured JSONL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-incident-'));
  try {
    assert.equal(incidents.recordIncident(root, {
      id: 'middleware-throw',
      severity: 'lifesaver',
      component: 'middleware',
      summary: 'middleware boom',
      evidence: { mod: 'x' },
    }), true);
    const text = fs.readFileSync(path.join(root, incidents.ERROR_LOG_REL), 'utf8');
    assert.match(text, /LIFESAVER -- middleware boom/);
    const rows = fs.readFileSync(path.join(root, incidents.INCIDENT_LOG_REL), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'middleware-throw');
    assert.equal(rows[0].lifesaver, true);
    assert.equal(rows[0].status, 'open');
    assert.deepEqual(rows[0].evidence, { mod: 'x' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('incident registry can suppress resolver-proven historical lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-incident-resolver-'));
  try {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp/payload.json'), JSON.stringify({
      model: 'cx/gpt-5.5-xhigh', system: '', tools: [],
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(900000) }] }],
    }));
    const line = '[T] UPSTREAM_200_INTERACTIVE: omniroute 200 api_error [interactive]: input exceeds the context window (snapshot=tmp/payload.json)';
    assert.equal(incidents.unresolvedLines(root, [line]).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('incident registry can suppress resolver-proven transient upstream 200 api_error lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-incident-upstream-200-'));
  try {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp/payload.json'), JSON.stringify({ model: 'cx/gpt-5.5-xhigh', messages: [] }));
    fs.writeFileSync(path.join(root, 'tmp/payload.response'), 'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID abc in your message."}}\n\n');
    fs.writeFileSync(path.join(root, 'tmp/payload.headers.json'), JSON.stringify({ 'content-type': 'text/event-stream' }));
    const line = '[T] UPSTREAM_200_INTERACTIVE: omniroute 200 api_error [interactive]: An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID abc in your message. (request_id=?, snapshot=tmp/payload.json)';
    assert.equal(incidents.unresolvedLines(root, [line]).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('incident registry suppresses stale slot outage after live slots converge', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-incident-runtime-converged-'));
  try {
    fs.mkdirSync(path.join(root, 'tools/HME/runtime'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git/refs/heads'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(root, '.git/refs/heads/main'), 'abc123456789abcdef0000000000000000000000\n');
    fs.writeFileSync(path.join(root, 'tools/HME/runtime/proxy-runtime.json'), JSON.stringify({ git_sha: 'abc123456789' }));
    const health = { pid: process.pid, ts: Date.now(), ready: true, draining: false, git_sha: 'abc123456789', runtime_fingerprint: 'fp' };
    fs.writeFileSync(path.join(root, 'tools/HME/runtime/proxy-a.health'), JSON.stringify(health));
    const line = '[T] [proxy-liveness] LIFESAVER -- proxy is NOT serving current code: slot a missing (health file missing/unreadable); slot b dead (pid 9321 not alive). Requests bypass all rewriters until slots converge.';
    assert.equal(incidents.unresolvedLines(root, [line]).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('incident registry suppresses successful shuffler auto-heal when helper is alive', () => {
  const line = '[T] [shuffler] LIFESAVER file_watcher was dead; respawned by proxy-supervisor (auto-heal had stopped)';
  const out = require('../../proxy/incident_resolvers').RESOLVERS.find((fn) => fn(line, process.cwd())?.kind === 'shuffler_auto_heal');
  assert.ok(out, 'shuffler auto-heal resolver is registered');
});

test('incident ontology separates observations from unresolved agent debt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-incident-observation-'));
  try {
    const lines = [
      '[T] [universal_pulse] WARN hook latency high',
      '[T] [hme-proxy] LIFESAVER -- estimator drift informational after conservative gate fix',
      '[T] [agent-real] ERROR still actionable',
    ];
    const unresolved = incidents.unresolvedLines(root, lines);
    assert.equal(unresolved.length, 1);
    assert.match(unresolved[0], /agent-real/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
