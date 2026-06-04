'use strict';

const fs = require('fs');
const path = require('path');
const { requireEnv } = require('../proxy/shared/load_env');
const root = requireEnv('PROJECT_ROOT');

function arg(name, fallback = '') {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

const MODES = ['proof', 'debt', 'mesh', 'resolve', 'metabolize', 'coherence-field', 'proof-capsules', 'causal-braid', 'immune', 'policy-genome', 'freshness'];

function mode() {
  const m = arg('mode', process.argv[2] || 'proof');
  return MODES.includes(m) ? m : 'proof';
}

function recentErrorLines(limit = 40) {
  try {
    return fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8').split('\n').filter(Boolean).slice(-limit);
  } catch (_e) {
    // silent-ok: missing/unreadable error log = no recent error lines for the why view.
    return [];
  }
}

function runProof() {
  const events = require('../proxy/coherence_events').readEvents(root, { limit: Number(arg('limit', 50)) || 50 });
  const incidents = require('../proxy/incident_registry');
  const guard = require('../proxy/claim_proof_guard');
  const unresolved = incidents.unresolvedLines(root, recentErrorLines(80));
  console.log('mode=proof');
  console.log(`coherence_events=${events.length}`);
  for (const ev of events.slice(-10)) console.log(`- ${ev.kind} ${ev.subject || '(no subject)'} proof=${ev.proof_class} evidence=${(ev.evidence || []).length}`);
  console.log(`unresolved_incidents=${unresolved.length}`);
  // Live claim-proof check: can we truthfully claim "all incidents resolved"
  // right now? The guard evaluates that completion claim against the ledger's
  const verdict = guard.evaluateClaim('all incidents are resolved', events);
  let label;
  if (unresolved.length > 0) label = `BLOCK (${unresolved.length} unresolved incidents)`;
  else if (!verdict.supported) label = `${verdict.action.toUpperCase()} (${verdict.reason || 'no same-turn proof'})`;
  else label = 'ALLOW (proof-backed)';
  console.log(`claim "all incidents resolved": ${label}`);
}

function runDebt() {
  const evMod = require('../proxy/coherence_events');
  const events = evMod.readEvents(root, { limit: Number(arg('limit', 200)) || 200 });
  const summary = evMod.summarize(events);
  const incidents = require('../proxy/incident_registry');
  const unresolved = incidents.unresolvedLines(root, recentErrorLines(200));
  console.log('mode=debt');
  console.log(`open_obligations=${summary.open_obligations.length}`);
  for (const ob of summary.open_obligations.slice(0, 20)) console.log(`- obligation: ${ob}`);
  console.log(`unresolved_incidents=${unresolved.length}`);
  for (const line of unresolved.slice(0, 10)) console.log(`- incident: ${line.slice(0, 240)}`);
  // Economics: turn ledger events into a coarse policy-feedback signal so noisy
  // vs load-bearing incident classes are visible (narrow / retire / strengthen).
  const economics = require('../proxy/coherence_economics');
  const incidentEvents = events.filter((e) => e && e.kind === 'incident');
  const resolverEvents = events.filter((e) => e && e.kind === 'resolver');
  const fb = economics.policyFeedback({
    policy: 'incident_surface',
    prevented_failures: resolverEvents.length,
    noise_events: Math.max(0, incidentEvents.length - resolverEvents.length),
  });
  console.log(`policy_feedback incident_surface: action=${fb.action} prevented=${fb.prevented_failures} noise=${fb.noise_events}`);
  // claim_proof shadow signal-vs-noise: split denies by meta.verified --
  // verified=false = genuine catch (signal), verified=true = false alarm (noise).
  const cpDenies = events.filter((e) => e && e.subject === 'stop:claim_proof' && e.meta && e.meta.decision === 'deny');
  const cpScored = cpDenies.filter((e) => typeof e.meta.verified === 'boolean');
  const cpSignal = cpScored.filter((e) => !e.meta.verified).length;
  const cpNoise = cpScored.filter((e) => e.meta.verified).length;
  const cpFb = economics.policyFeedback({ policy: 'claim_proof_shadow', prevented_failures: cpSignal, noise_events: cpNoise });
  const cpLegacy = cpDenies.length - cpScored.length;
  console.log(`policy_feedback claim_proof_shadow: action=${cpFb.action} signal=${cpSignal} noise=${cpNoise} legacy_unscored=${cpLegacy} -- flip non-strict to hard-deny only when action=keep and signal>0`);
  // Surface durable invariants the metabolism pass has distilled from raw traces.
  const facts = require('../proxy/context_metabolism').readFacts(root);
  const durable = facts.filter((f) => f && (f.stage === 'durable_invariant' || f.stage === 'compact_doctrine'));
  console.log(`durable_invariants=${durable.length} (raw_facts=${facts.length})`);
  for (const f of durable.slice(0, 10)) console.log(`- invariant: ${f.subject}: ${String(f.content).slice(0, 120)}`);
  printPolicyDeadWeight();
}

// P1 (phase 2): diff the builtin registry against policies seen firing (deny or
// rewrite) over the recorded hook-decision window. A 0-fire policy is a REVIEW
function printPolicyDeadWeight() {
  let registry;
  try { registry = require('../policies/registry'); registry.loadBuiltins(); }
  catch (_e) { return; }
  let rows = [];
  try {
    rows = fs.readFileSync(path.join(root, 'tools/HME/runtime/hook-decisions.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } }).filter(Boolean);
  } catch (_e) { rows = []; }
  const window = Number(arg('policy_window', 2000)) || 2000;
  const seen = new Set();
  for (const r of rows.slice(-window)) {
    if (r && (r.kind === 'policy_deny' || r.kind === 'policy_rewrite')) {
      for (const name of r.policies || []) seen.add(name);
    }
  }
  const builtins = registry.list().map((p) => p.name);
  const zeroFire = builtins.filter((n) => !seen.has(n)).sort();
  console.log(`policy_dead_weight: ${zeroFire.length}/${builtins.length} builtin policies 0-fire over last ${Math.min(window, rows.length)} hook-decision rows (REVIEW, not auto-retire)`);
  for (const n of zeroFire.slice(0, 30)) console.log(`- 0-fire: ${n}`);
}

function runMetabolize() {
  const m = require('../proxy/context_metabolism').runMetabolismPass(root);
  console.log('mode=metabolize');
  console.log(`facts_before=${m.before} facts_after=${m.after} composted=${m.composted} durable=${m.durable.length}`);
  for (const f of m.durable.slice(0, 10)) console.log(`- durable ${f.stage}: ${f.subject}`);
}

function runResolve() {
  // Deliberate, on-demand (NOT hot-path): record a structured resolved-incident
  // row for every error-log line a resolver can PROVE fixed. Dedupes by line so
  const incidents = require('../proxy/incident_registry');
  const resolvers = require('../proxy/incident_resolvers');
  const lines = recentErrorLines(Number(arg('limit', 200)) || 200);
  const seen = new Set();
  let recorded = 0;
  console.log('mode=resolve');
  for (const line of lines) {
    const r = resolvers.resolveLine(root, line);
    if (!r.resolved || r.kind === 'observation' || r.kind === 'self_origin') continue;
    const key = `${r.kind}:${line.replace(/^\[[^\]]*\]\s*/, '').slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // dedupeKey keyed on the line so resolveIncident stays idempotent across runs.
    // Carry the resolver-known braid fields so i/why mode=causal-braid reconstructs
    // a complete chain instead of mostly-missing links.
    const before = incidents.readIncidents(root).length;
    incidents.resolveIncident(root, {
      id: r.kind, component: r.kind || 'hme', summary: r.reason || 'resolver-proven',
      resolver: r.resolver, proof: r.proof || {}, dedupeKey: key,
      invariant: r.invariant || '', runtimeState: r.runtimeState || '',
      regressionTest: r.recurrenceTest || '', rootCause: r.reason || '',
    });
    if (incidents.readIncidents(root).length > before) {
      recorded += 1;
      console.log(`- resolved ${r.kind} via ${r.resolver}`);
    }
  }
  console.log(`recorded_resolved=${recorded} (idempotent; already-recorded skipped)`);
}

function runMesh() {
  const { buildMesh, queryMesh } = require('../proxy/invariant_mesh');
  const view = arg('view', 'summary');
  console.log('mode=mesh');
  if (view === 'summary') console.log(JSON.stringify(buildMesh(root).counts, null, 2));
  else console.log(JSON.stringify(queryMesh(root, view), null, 2));
}

function runCoherenceField() {
  const organs = require('../proxy/coherence_organs');
  const events = require('../proxy/coherence_events').readEvents(root, { limit: Number(arg('limit', 200)) || 200 });
  const summary = organs.summarizeCoherenceField(events);
  console.log('mode=coherence-field');
  console.log(`events=${summary.count} net_coherence=${summary.net_coherence}`);
  console.log(`effects=${JSON.stringify(summary.effects)}`);
  for (const ev of events.slice(-10)) {
    const f = ev.field || organs.projectCoherenceField(ev);
    console.log(`- ${ev.kind} ${ev.subject || '(no subject)'} effect=${f.effect} net=${f.net_coherence}`);
  }
  if (summary.high_noise.length) console.log(`high_noise=${summary.high_noise.slice(0, 10).join(', ')}`);
}

function runProofCapsules() {
  const organs = require('../proxy/coherence_organs');
  const capsules = organs.readProofCapsules(root);
  const proved = capsules.filter((c) => c && c.proof_status === 'proved');
  const debt = capsules.filter((c) => c && c.proof_status === 'debt');
  console.log('mode=proof-capsules');
  console.log(`capsules=${capsules.length} proved=${proved.length} debt=${debt.length}`);
  for (const c of debt.slice(-10)) console.log(`- DEBT: ${String(c.claim).slice(0, 100)} (confidence=${c.confidence} freshness=${c.freshness})`);
  for (const c of proved.slice(-5)) console.log(`- proved: ${String(c.claim).slice(0, 80)} via ${c.verifier}`);
}

function runCausalBraid() {
  const organs = require('../proxy/coherence_organs');
  const incidents = require('../proxy/incident_registry');
  const rows = incidents.readIncidents(root).slice(-Number(arg('limit', 5) || 5));
  console.log('mode=causal-braid');
  if (!rows.length) { console.log('no incidents to braid'); return; }
  for (const inc of rows) {
    const proofText = inc.proof && Object.keys(inc.proof).length ? JSON.stringify(inc.proof) : '';
    const braid = organs.causalBraid({
      id: inc.id, user_pain: inc.summary, violated_invariant: inc.invariant || inc.component,
      responsible_subsystem: inc.component, runtime_state: inc.runtimeState,
      code_cause: inc.rootCause || inc.repair, verification: proofText,
      recurrence_guard: inc.regressionTest, memory_crystallization: inc.status === 'resolved' ? (inc.resolver || inc.fixedBy) : '',
    });
    console.log(`- ${braid.id}: proved=${braid.chain.filter((s) => s.proved).length}/${braid.chain.length} missing=[${braid.missing.join(',')}]`);
  }
}

function runImmune() {
  const organs = require('../proxy/coherence_organs');
  const lines = recentErrorLines(Number(arg('limit', 80)) || 80);
  const counts = {};
  let metabolized = 0;
  for (const line of lines) {
    const r = organs.immuneResponse({ text: line });
    if (r.classification === 'none') continue;
    counts[r.classification] = (counts[r.classification] || 0) + 1;
    if (r.action === 'metabolize') metabolized += 1;
  }
  console.log('mode=immune');
  const keys = Object.keys(counts);
  if (!keys.length) { console.log('no DDoC/noise signals in recent error lines'); return; }
  for (const k of keys) console.log(`- ${k}: ${counts[k]} (action=${organs.immuneResponse({ text: k.replace(/_/g, ' ') }).action})`);
  console.log(`metabolize_candidates=${metabolized}`);
}

function runPolicyGenome() {
  const organs = require('../proxy/coherence_organs');
  const registry = require('../policies/registry');
  registry.loadBuiltins();
  const policies = registry.list();
  const invalid = [];
  console.log('mode=policy-genome');
  for (const p of policies) {
    const v = organs.validatePolicyGenome(registry.genomeInput(p));
    if (!v.ok) invalid.push(`${p.name}: missing ${v.missing.join(',')}`);
  }
  console.log(`policies=${policies.length} valid_genomes=${policies.length - invalid.length} invalid=${invalid.length}`);
  for (const line of invalid.slice(0, 20)) console.log(`- ${line}`);
}

function runFreshness() {
  const organs = require('../proxy/coherence_organs');
  const { currentRuntimeFingerprint } = require('../proxy/proxy_runtime_fingerprint');
  let runtimeMeta = {};
  try { runtimeMeta = JSON.parse(fs.readFileSync(path.join(root, 'tools/HME/runtime/proxy-runtime.json'), 'utf8')); } catch (_e) { runtimeMeta = {}; }
  const wanted = (() => { try { return currentRuntimeFingerprint(root); } catch (_e) { return ''; } })();
  const status = organs.freshnessStatus({ runtimeFingerprint: runtimeMeta.runtime_fingerprint || '', wantedFingerprint: wanted });
  console.log('mode=freshness');
  console.log(`runtime=${status.runtime_fingerprint || '?'} wanted=${status.wanted_fingerprint || '?'} status=${status.status}`);
  const capsules = organs.readProofCapsules(root);
  const decayed = capsules.filter((c) => c && c.freshness < 0.4);
  console.log(`proof_capsules=${capsules.length} decayed=${decayed.length}`);
}

const m = mode();
if (m === 'debt') runDebt();
else if (m === 'mesh') runMesh();
else if (m === 'resolve') runResolve();
else if (m === 'metabolize') runMetabolize();
else if (m === 'coherence-field') runCoherenceField();
else if (m === 'proof-capsules') runProofCapsules();
else if (m === 'causal-braid') runCausalBraid();
else if (m === 'immune') runImmune();
else if (m === 'policy-genome') runPolicyGenome();
else if (m === 'freshness') runFreshness();
else runProof();
