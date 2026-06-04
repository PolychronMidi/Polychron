'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { requireEnv } = require('../../proxy/shared/load_env');

process.env.PROJECT_ROOT = requireEnv('PROJECT_ROOT');

const events = require('../../proxy/coherence_events');
const incidents = require('../../proxy/incident_registry');
const resolvers = require('../../proxy/incident_resolvers');
const mesh = require('../../proxy/invariant_mesh');
const metabolism = require('../../proxy/context_metabolism');
const claims = require('../../proxy/claim_proof_guard');
const economics = require('../../proxy/coherence_economics');
const organs = require('../../proxy/coherence_organs');
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
    // WIRED (item 1): every appended event carries a coherence-field vector.
    assert.ok(rows[0].field, 'event must carry a coherence field');
    assert.equal(typeof rows[0].field.net_coherence, 'number');
    assert.ok(['clarify', 'preserve', 'repair', 'mutate', 'obscure', 'parasitize'].includes(rows[0].field.effect));
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
  assert.ok(names.includes('statefile_proof_capsules'));
});

test('coherence economics covers budgets policy feedback immune checks and review scales', () => {
  const budget = economics.normalizeBudget({ benefit: 'blocked bad edit', latency_ms: 12, hook_noise: 0, false_positive_risk: 'low' });
  assert.equal(budget.cost.latency_ms, 12);
  assert.equal(economics.policyFeedback({ policy: 'p', prevented_failures: 0, noise_events: 4 }).action, 'retire');
  assert.deepEqual(economics.detectAgentPatterns('fixed all done', ''), ['unsupported_done_claim']);
  assert.equal(economics.reviewScales({ subtoken: 'proof', function: 'contract' }).filter((x) => x.checked).length, 2);
});

test('coherence organs 1-6 field proof braid immune policy freshness', () => {
  const root = tmpRoot();
  try {
    assert.deepEqual(organs.COHERENCE_ORGANS, ['coherence_field', 'proof_capsules', 'causal_braid', 'coherence_immune_system', 'policy_genome', 'temporal_coherence']);
    assert.deepEqual(organs.VECTOR_FIELDS, ['intent_alignment', 'evidence_strength', 'entropy_cost', 'causal_parent', 'invariant_touched', 'user_pain_addressed', 'reversibility', 'freshness', 'proof_status', 'noise_risk']);
    const proof = organs.appendProofCapsule(root, { claim: 'done', evidence: ['node --test'], verifier: 'unit', freshness: 0.9, confidence: 0.9 });
    assert.equal(proof.proof_status, 'proved');
    assert.equal(organs.readProofCapsules(root).length, 1);
    const field = organs.projectCoherenceField({ subject: 'x', intent_alignment: 0.8, evidence_strength: 0.8, entropy_cost: 0.1, noise_risk: 0.1, user_pain_addressed: 0.8 });
    assert.equal(field.effect, 'repair');
    const braid = organs.causalBraid({ user_pain: 'hurt', violated_invariant: 'truth', responsible_subsystem: 'hooks', runtime_state: 'stale', code_cause: 'cache', verification: 'test', recurrence_guard: 'regression', memory_crystallization: 'fact' });
    assert.deepEqual(braid.missing, []);
    assert.equal(organs.immuneResponse({ text: 'repeated hook UI spam' }).classification, 'repeated_hook_ui');
    assert.equal(organs.validatePolicyGenome({ name: 'p', protects: ['truth'], owner: 'hme', fail_open_or_closed: 'open' }).ok, true);
    assert.equal(organs.freshnessStatus({ sourceMtime: 20, processStart: 10, runtimeFingerprint: 'a', wantedFingerprint: 'a' }).status, 'runtime_stale');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('i/why proof debt mesh resolve modes dispatch', () => {
  const why = path.join(process.env.PROJECT_ROOT, 'tools/HME/i/why');
  for (const mode of ['proof', 'debt', 'mesh', 'resolve']) {
    const r = spawnSync(why, [`mode=${mode}`], { cwd: process.env.PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT: process.env.PROJECT_ROOT }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`mode=${mode}`));
  }
});

test('WIRED (items 3,4,6,8): operator i/why coherence views dispatch', () => {
  const why = path.join(process.env.PROJECT_ROOT, 'tools/HME/i/why');
  for (const mode of ['coherence-field', 'proof-capsules', 'causal-braid', 'immune', 'policy-genome', 'freshness']) {
    const r = spawnSync(why, [`mode=${mode}`], { cwd: process.env.PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT: process.env.PROJECT_ROOT }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`mode=${mode}`));
  }
});

test('WIRED (item 2): claim_proof emits a proof-debt capsule for an unverified completion claim', () => {
  const root = tmpRoot();
  try {
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    const transcript = path.join(root, 'tmp', 'transcript.jsonl');
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: 'user', message: { content: 'fix the parser' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'All tests pass and everything is fixed.' }] } }),
    ].join('\n') + '\n');
    const policy = require('../../proxy/stop_chain/policies/claim_proof');
    policy.run({ payload: { transcript_path: transcript }, projectRoot: root, allow: () => ({ decision: 'allow' }), instruct: (m) => ({ decision: 'instruct', message: m }), deny: (m) => ({ decision: 'deny', reason: m }) });
    const capsules = organs.readProofCapsules(root);
    assert.equal(capsules.length, 1, 'completion claim must mint a proof capsule');
    assert.equal(capsules[0].proof_status, 'debt', 'no same-turn verification => proof debt');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('WIRED (item 5): every builtin policy yields a valid reflexive genome', () => {
  const registry = require('../../policies/registry');
  registry.loadBuiltins();
  const invalid = [];
  for (const p of registry.list()) {
    const v = organs.validatePolicyGenome(registry.genomeInput(p));
    if (!v.ok) invalid.push(`${p.name}: ${v.missing.join(',')}`);
  }
  assert.deepEqual(invalid, [], `policies missing genome fields: ${invalid.join('; ')}`);
});

test('WIRED (item 3): proof capsules decay with age and drop out of the fresh set', () => {
  const root = tmpRoot();
  try {
    organs.appendProofCapsule(root, { claim: 'old fix', evidence: ['node --test'], verifier: 'unit', ts: '2020-01-01T00:00:00Z', verified_at: '2020-01-01T00:00:00Z' });
    organs.appendProofCapsule(root, { claim: 'fresh fix', evidence: ['node --test'], verifier: 'unit', confidence: 0.9, freshness: 0.9 });
    const decayed = organs.readProofCapsules(root, { decay: true });
    const old = decayed.find((c) => c.claim === 'old fix');
    assert.equal(old.expired, true, 'a 2020 capsule must read as expired');
    assert.equal(old.proof_status, 'debt', 'decayed proof is debt -> reverify');
    const fresh = organs.freshProofCapsules(root);
    assert.ok(fresh.every((c) => c.claim !== 'old fix'), 'expired capsule must not back a live claim');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('WIRED (item 2): incidents capture braid fields so a resolved incident reconstructs a complete chain', () => {
  const inc = incidents.normalizeIncident({ id: 'stale', component: 'pulse', summary: 'todo not archived', invariant: 'freshness', runtimeState: 'daemon ran stale todo_engine', rootCause: 'module cache', regressionTest: 'pulse_supervisor_reload.test.js', resolver: 'supervisor reload', proof: { reloaded: true }, status: 'resolved' });
  assert.equal(inc.invariant, 'freshness');
  assert.equal(inc.runtimeState, 'daemon ran stale todo_engine');
  const braid = organs.causalBraid({
    id: inc.id, user_pain: inc.summary, violated_invariant: inc.invariant, responsible_subsystem: inc.component,
    runtime_state: inc.runtimeState, code_cause: inc.rootCause, verification: JSON.stringify(inc.proof),
    recurrence_guard: inc.regressionTest, memory_crystallization: inc.resolver,
  });
  assert.deepEqual(braid.missing, [], 'a fully-specified resolved incident must braid with no missing links');
});

test('WIRED (item 4): hook decision rows carry a coherence-field vector', () => {
  const log = require('../../event_kernel/hook_decision_log');
  const deny = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: secret"}}';
  const summary = log.hookDecisionSummary('claude', 'PreToolUse', deny, deny, { tool_name: 'Write', session_id: 's' });
  assert.ok(summary, 'a deny decision must produce a summary row');
  assert.ok(summary.field, 'hook decision row must carry a coherence field');
  assert.equal(typeof summary.field.net_coherence, 'number');
  assert.ok(['clarify', 'preserve', 'repair', 'mutate', 'obscure', 'parasitize'].includes(summary.field.effect));
});

test('P1: capsuleBacksArtifacts -- same-artifact match, parse-gap fallback, no-fresh false', () => {
  const fresh = [{ proof_status: 'proved', expired: false, artifacts: ['a.js'] }];
  assert.equal(organs.capsuleBacksArtifacts(fresh, ['a.js']), true, 'same artifact backs the claim');
  assert.equal(organs.capsuleBacksArtifacts(fresh, ['b.js']), false, 'different artifact does not (no cross-turn laundering)');
  assert.equal(organs.capsuleBacksArtifacts(fresh, []), true, 'parse gap (no files) weakens to any fresh proved capsule');
  assert.equal(organs.capsuleBacksArtifacts([{ proof_status: 'debt', expired: false, artifacts: ['a.js'] }], ['a.js']), false, 'a debt capsule never backs a claim');
  assert.equal(organs.capsuleBacksArtifacts([], ['a.js']), false, 'no fresh capsule -> not backed');
});

function _transcript(root, opts) {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const t = path.join(root, 'tmp', 'transcript.jsonl');
  fs.writeFileSync(t, [
    JSON.stringify({ type: 'user', message: { content: 'fix the parser' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: opts.file } }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'All tests pass and everything is fixed.' }] } }),
  ].join('\n') + '\n');
  return t;
}

test('P1: a fresh same-artifact proof capsule backs a completion claim; a decayed one does not', () => {
  const policy = require('../../proxy/stop_chain/policies/claim_proof');
  const file = '/repo/src/parser.js';
  // fresh capsule naming the file edited this turn -> claim is proven -> allow.
  const okRoot = tmpRoot();
  try {
    organs.appendProofCapsule(okRoot, { claim: 'parser verified', evidence: ['node --test'], artifacts: [file], confidence: 0.9, freshness: 0.9 });
    const res = policy.run({ payload: { transcript_path: _transcript(okRoot, { file }) }, projectRoot: okRoot,
      allow: () => ({ decision: 'allow' }), instruct: (m) => ({ decision: 'instruct', message: m }), deny: (m) => ({ decision: 'deny', reason: m }) });
    assert.equal(res.decision, 'allow', 'fresh same-artifact capsule should back the claim');
  } finally { fs.rmSync(okRoot, { recursive: true, force: true }); }
  // only a DECAYED capsule for the file -> not proven -> debt ladder (instruct in non-st
  const staleRoot = tmpRoot();
  try {
    organs.appendProofCapsule(staleRoot, { claim: 'parser verified long ago', evidence: ['node --test'], artifacts: [file], ts: '2020-01-01T00:00:00Z', verified_at: '2020-01-01T00:00:00Z' });
    const res = policy.run({ payload: { transcript_path: _transcript(staleRoot, { file }) }, projectRoot: staleRoot,
      allow: () => ({ decision: 'allow' }), instruct: (m) => ({ decision: 'instruct', message: m }), deny: (m) => ({ decision: 'deny', reason: m }) });
    assert.notEqual(res.decision, 'allow', 'a decayed-only capsule must NOT back the claim');
  } finally { fs.rmSync(staleRoot, { recursive: true, force: true }); }
});

test('P3: resolvers carry braid fields so resolved incidents braid complete', () => {
  const root = tmpRoot();
  try {
    const v = resolvers.resolveLine(root, '[T] [stale_runtime] slot a stranded on stale code');
    assert.equal(v.kind, 'runtime_convergence');
    assert.ok(v.invariant && v.runtimeState && v.recurrenceTest, 'stale-runtime resolver must carry braid fields');
    const braid = organs.causalBraid({
      id: v.kind, user_pain: 'stale code served', violated_invariant: v.invariant, responsible_subsystem: v.kind,
      runtime_state: v.runtimeState, code_cause: v.reason, verification: JSON.stringify(v.proof),
      recurrence_guard: v.recurrenceTest, memory_crystallization: v.resolver,
    });
    assert.deepEqual(braid.missing, [], 'resolver-proven incident should braid with no missing links');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PRODUCER: recordIncident fans out to a coherence event and a metabolism fact', () => {
  const root = tmpRoot();
  try {
    incidents.recordIncident(root, { id: 'wire', component: 'test', summary: 'boom', repair: 'fix' });
    const ev = events.readEvents(root);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].kind, 'incident');
    assert.deepEqual(ev[0].obligations, ['fix']);
    const facts = metabolism.readFacts(root);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].source, 'incident_registry');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PRODUCER: resolveIncident is idempotent across runs', () => {
  const root = tmpRoot();
  try {
    const input = { id: 'r', component: 'test', summary: 'fixed', resolver: 'unit', dedupeKey: 'upstream:line-x' };
    assert.equal(incidents.resolveIncident(root, input), true);
    incidents.resolveIncident(root, input);
    incidents.resolveIncident(root, input);
    const resolved = incidents.readIncidents(root).filter((r) => r.status === 'resolved' && r.dedupeKey === 'upstream:line-x');
    assert.equal(resolved.length, 1, 'repeated resolve must not spam the ledger');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DEDUP: incident_resolvers self/observation classification comes from self_origin.js', () => {
  const selfOrigin = require('../../proxy/self_origin');
  const root = tmpRoot();
  try {
    // resolver verdict for an observation line must agree with the shared module
    assert.equal(selfOrigin.isObservation('[universal_pulse] WARN slow'), true);
    assert.equal(resolvers.resolveLine(root, '[T] [universal_pulse] WARN slow').kind, 'observation');
    assert.equal(resolvers.resolveLine(root, '[T] [agent-real] ERROR real').resolved, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ENFORCE: every tool_result-mutating middleware declares idempotency intent; every state file has an owner', () => {
  assert.deepEqual(mesh.queryMesh(process.env.PROJECT_ROOT, 'unmarked_mutators').map((n) => n.name), []);
  assert.deepEqual(mesh.queryMesh(process.env.PROJECT_ROOT, 'ownerless_state').map((n) => n.name), []);
});

test('ENFORCE: middleware manifest mutatesToolResult flag agrees with effects[] and source', () => {
  const man = JSON.parse(fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'tools/HME/proxy/middleware/manifest.json'), 'utf8'));
  const MUT = /toolResult\.(append|replace|sanitize)/;
  const flagEffectDrift = [];
  const flagSourceDrift = [];
  for (const m of man.modules) {
    const effMutates = (m.effects || []).some((e) => MUT.test(e));
    if (effMutates !== Boolean(m.mutatesToolResult)) flagEffectDrift.push(m.name);
    if (m.mutatesToolResult) {
      const src = fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'tools/HME/proxy/middleware', m.file), 'utf8');
      if (!/tool_result|toolResult|\.content/.test(src)) flagSourceDrift.push(m.name);
    }
  }
  assert.deepEqual(flagEffectDrift, [], `mutatesToolResult flag disagrees with effects[]: ${flagEffectDrift.join(', ')}`);
  assert.deepEqual(flagSourceDrift, [], `mutatesToolResult:true but source never touches tool results: ${flagSourceDrift.join(', ')}`);
});
