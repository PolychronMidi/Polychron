'use strict';

const fs = require('fs');
const path = require('path');
const { requireEnv } = require('../proxy/shared/load_env');
const root = requireEnv('PROJECT_ROOT');

function arg(name, fallback = '') {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function mode() {
  const m = arg('mode', process.argv[2] || 'proof');
  return ['proof', 'debt', 'mesh', 'resolve'].includes(m) ? m : 'proof';
}

function recentErrorLines(limit = 40) {
  try {
    return fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8').split('\n').filter(Boolean).slice(-limit);
  } catch (_e) {
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
  const supported = verdict.supported && unresolved.length === 0;
  console.log(`claim "all incidents resolved": ${supported ? 'ALLOW (proof-backed)' : `${verdict.action.toUpperCase()} (${unresolved.length} unresolved, ${verdict.reason || 'no same-turn proof'})`}`);
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
    const before = incidents.readIncidents(root).length;
    incidents.resolveIncident(root, {
      id: r.kind, component: 'hme', summary: r.reason || 'resolver-proven',
      resolver: r.resolver, proof: r.proof || {}, dedupeKey: key,
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

const m = mode();
if (m === 'debt') runDebt();
else if (m === 'mesh') runMesh();
else if (m === 'resolve') runResolve();
else runProof();
