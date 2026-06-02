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
