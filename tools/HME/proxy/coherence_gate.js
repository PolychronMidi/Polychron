'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const { validateClaim, isCurrent, readClaimState } = require('./coherence_claims');
const invalidators = require('./claim_invalidators');
const graph = require('./claim_graph');
const audits = require('./coherence_audits');

const DEFAULT_CLAIM_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'claims');
const DEFAULT_GATE_REPORT = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'coherence-gate-report.json');

function evaluateClaims(claims, invs = []) {
  const failures = [];
  const states = [];
  for (const claim of claims || []) {
    const validation = validateClaim(claim);
    if (!validation.ok) {
      failures.push({ claim_id: claim && claim.claim_id, reason: 'schema_invalid', errors: validation.errors });
      states.push({ claim_id: claim && claim.claim_id, state: 'invalid', validation });
      continue;
    }
    const cur = isCurrent(claim, invs);
    const minimization = audits.evidenceDataMinimization({ metadata: claim.metadata, freshness_proof: claim.freshness_proof, telemetry: claim.telemetry, evidence: claim.evidence });
    const state = { claim_id: claim.claim_id, state: cur.current ? 'current' : 'stale', currentness: cur, validation, minimization };
    states.push(state);
    if (!claim.repair) failures.push({ claim_id: claim.claim_id, reason: 'missing_repair' });
    if (!claim.freshness_proof) failures.push({ claim_id: claim.claim_id, reason: 'missing_freshness_proof' });
    if (!minimization.ok) failures.push({ claim_id: claim.claim_id, reason: 'leaky_evidence', findings: minimization.findings });
    if (!cur.current && claim.status !== 'stale') failures.push({ claim_id: claim.claim_id, reason: 'stale_claim_presented_current', currentness: cur });
  }
  return { ok: failures.length === 0, failures, states };
}

function claimFiles(dir = DEFAULT_CLAIM_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)).sort();
}

function readClaimsWithStates(files, invs) {
  return files.map((file) => readClaimState(file, invs));
}

function _populateGraph(claimStates, invs, opts = {}) {
  const gfile = opts.graphFile || graph.DEFAULT_GRAPH;
  const g = graph.loadGraph(gfile);
  for (const st of claimStates) {
    if (!st.claim) continue;
    const c = st.claim;
    const cid = `claim:${c.claim_id}`;
    const producer = `verifier:${c.producer}`;
    const evidence = `evidence:${c.claim_id}`;
    graph.addNode(g, cid, 'claim', {
      rule_origin: c.producer,
      birthing_bug: (c.metadata && c.metadata.birthing_bug) || 'claim producer invariant',
      preserving_tests: c.tests || c.regression_tests || [],
      retirement_condition: c.retirement_condition,
      breakage_risk: c.repair,
      status: c.status,
      state: st.state,
    });
    graph.addNode(g, producer, 'verifier', { producer: c.producer, producer_version: c.producer_version });
    graph.addNode(g, evidence, 'evidence', { evidence_uri: c.evidence_uri, evidence_hash: c.evidence_hash });
    try { graph.addEdge(g, producer, 'produces', cid); } catch (_e) {}
    try { graph.addEdge(g, cid, 'evidenced_by', evidence); } catch (_e) {}
    for (const t of c.tests || c.regression_tests || []) {
      const tid = `test:${t}`;
      graph.addNode(g, tid, 'test', { path: t });
      try { graph.addEdge(g, cid, 'preserved_by', tid); } catch (_e) {}
    }
  }
  for (const inv of invs || []) {
    const iid = `invalidator:${inv.key}:${inv.path || inv.subject_uri}`;
    graph.addNode(g, iid, 'invalidator', inv);
    for (const st of claimStates) {
      if (!st.claim || st.currentness && st.currentness.current) continue;
      try { graph.addEdge(g, `claim:${st.claim.claim_id}`, 'invalidated_by', iid); } catch (_e) {}
    }
  }
  const retained = graph.enforceRetention(g, opts.retention || {});
  graph.saveGraph(retained.graph, gfile);
  return retained;
}

function gateRuntimeClaims(opts = {}) {
  const root = opts.root || PROJECT_ROOT;
  const dir = opts.dir || path.join(root, 'tools', 'HME', 'runtime', 'claims');
  const invs = opts.invalidators || invalidators.collectInvalidators(root, opts);
  const files = opts.files || claimFiles(dir);
  const claimStates = readClaimsWithStates(files, invs);
  const claims = claimStates.filter((s) => s.claim).map((s) => s.claim);
  const evalResult = evaluateClaims(claims, invs);
  for (const st of claimStates) {
    if (st.state === 'invalid' || st.state === 'missing') evalResult.failures.push({ claim_id: st.claim && st.claim.claim_id, file: st.file, reason: 'claim_file_invalid', error: st.error, validation: st.validation });
  }
  evalResult.ok = evalResult.failures.length === 0;
  const retention = _populateGraph(claimStates, invs, opts);
  const report = {
    generated_at: new Date().toISOString(),
    ok: evalResult.ok,
    claim_count: claimStates.length,
    invalidator_count: invs.length,
    failures: evalResult.failures,
    states: evalResult.states,
    retention,
  };
  const out = opts.reportFile || DEFAULT_GATE_REPORT;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return report;
}

module.exports = { DEFAULT_CLAIM_DIR, DEFAULT_GATE_REPORT, evaluateClaims, claimFiles, readClaimsWithStates, gateRuntimeClaims };
