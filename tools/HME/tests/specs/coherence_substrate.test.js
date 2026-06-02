'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');

const events = require('../../proxy/coherence_events');
const incidents = require('../../proxy/incident_registry');
const resolvers = require('../../proxy/incident_resolvers');
const mesh = require('../../proxy/invariant_mesh');
const metabolism = require('../../proxy/context_metabolism');
const claims = require('../../proxy/claim_proof_guard');
const economics = require('../../proxy/coherence_economics');
const state = require('../../proxy/state_registry');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hme-coherence-')); }

test('coherence event ledger normalizes and appends proof-carrying rows', () => {
  const root = tmpRoot();
  try {
    const ev = events.appendEvent(root, {
      kind: 'test', subject: 'hme', intent: 'prove green', evidence: ['npm run test:hme'],
      coherence_delta: 1, entropy_delta: -0.5, obligations: ['report'], proofClass: 'executed',
    });
    assert.equal(ev.proof_class, 'executed');
    const rows = events.readEvents(root);
    assert.equal(rows.length, 1);
    assert.equal(events.summarize(rows).open_obligations[0], 'report');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('typed incident registry records resolved proof rows without re-emitting error text', () => {
  const root = tmpRoot();
  try {
    assert.equal(incidents.recordIncident(root, { id: 'x', summary: 'open boom' }), true);
    assert.equal(incidents.resolveIncident(root, { id: 'x', summary: 'fixed', resolver: 'unit', proof: { ok: true } }), true);
    const err = fs.readFileSync(path.join(root, incidents.ERROR_LOG_REL), 'utf8');
    assert.match(err, /open boom/);
    assert.doesNotMatch(err, /fixed/);
    const rows = fs.readFileSync(path.join(root, incidents.INCIDENT_LOG_REL), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map((r) => r.status), ['open', 'resolved']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('upstream context-window resolver proves captured payload now gates locally', () => {
  const root = tmpRoot();
  try {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    const rel = 'tmp/payload.json';
    fs.writeFileSync(path.join(root, rel), JSON.stringify({
      model: 'cx/gpt-5.5-xhigh', stream: true, system: '', tools: [],
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(900000) }] }],
    }));
    const verdict = resolvers.resolveLine(root, `[T] UPSTREAM_200_INTERACTIVE: omniroute 200 api_error [interactive]: input exceeds the context window (snapshot=${rel})`);
    assert.equal(verdict.kind, 'upstream_context_window');
    assert.equal(verdict.resolved, true);
    assert.equal(verdict.proof.action, 'over_window');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('invariant mesh links core registries into queryable nodes', () => {
  const built = mesh.buildMesh(process.env.PROJECT_ROOT);
  assert.ok(built.counts.routes >= 8);
  assert.ok(built.counts.middleware >= 20);
  assert.ok(built.counts.state_files >= 1);
  assert.ok(mesh.queryMesh(process.env.PROJECT_ROOT, 'mutators').some((n) => n.type === 'middleware'));
});

test('context metabolism promotes useful proof, appends facts, and composts contradictions', () => {
  const root = tmpRoot();
  try {
    assert.equal(metabolism.nextStage({ stage: 'raw_trace', proof_strength: 0.5, usefulness: 0.8, recency: 1 }), 'extracted_fact');
    assert.equal(metabolism.nextStage({ stage: 'verified_fact', proof_strength: 0.9, usefulness: 0.8, recency: 1 }), 'durable_invariant');
    assert.equal(metabolism.nextStage({ stage: 'verified_fact', contradicted_by: ['new proof'], proof_strength: 0.9 }), 'composted');
    metabolism.appendFact(root, { subject: 'gate', content: 'prior max calibrated', proof_strength: 0.8, usefulness: 0.8, stage: 'extracted_fact' });
    assert.equal(metabolism.readFacts(root).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('claim proof guard blocks unsupported done claims and allows executed proof', () => {
  const blocked = claims.evaluateClaim('all fixes are done', []);
  assert.equal(blocked.supported, false);
  assert.equal(blocked.action, 'block');
  const ok = claims.evaluateClaim('all fixes are done', [events.normalizeEvent({ kind: 'test', evidence: ['node --test'], proofClass: 'executed' })]);
  assert.equal(ok.supported, true);
});

test('coherence stores are registered from state-files.json', () => {
  const names = state.listRegistered();
  assert.ok(names.includes('statefile_coherence_events'));
  assert.ok(names.includes('statefile_context_metabolism'));
});

test('coherence economics covers budgets policy feedback immune checks and review scales', () => {
  const budget = economics.normalizeBudget({ benefit: 'blocked bad edit', latency_ms: 12, hook_noise: 0, false_positive_risk: 'low' });
  assert.equal(budget.cost.latency_ms, 12);
  assert.equal(economics.policyFeedback({ policy: 'p', prevented_failures: 0, noise_events: 4 }).action, 'retire');
  assert.deepEqual(economics.detectAgentPatterns('fixed all done', ''), ['unsupported_done_claim']);
  assert.equal(economics.reviewScales({ subtoken: 'proof', function: 'contract' }).filter((x) => x.checked).length, 2);
});

test('i/why proof debt and mesh modes dispatch', () => {
  const why = path.join(process.env.PROJECT_ROOT, 'tools/HME/i/why');
  for (const mode of ['proof', 'debt', 'mesh']) {
    const r = spawnSync(why, [`mode=${mode}`], { cwd: process.env.PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT: process.env.PROJECT_ROOT }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`mode=${mode}`));
  }
});
