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
    assert.deepEqual(rows[0].evidence, { mod: 'x' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
