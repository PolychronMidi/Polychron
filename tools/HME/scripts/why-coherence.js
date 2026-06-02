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
  return ['proof', 'debt', 'mesh'].includes(m) ? m : 'proof';
}

function recentErrorLines(limit = 40) {
  try {
    return fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8').split('\n').filter(Boolean).slice(-limit);
  } catch (_e) {
    return [];
  }
}

function runProof() {
  const events = require('../proxy/coherence_events').readEvents(root, { limit: Number(arg('limit', 20)) || 20 });
  const incidents = require('../proxy/incident_registry');
  const unresolved = incidents.unresolvedLines(root, recentErrorLines(80));
  console.log('mode=proof');
  console.log(`coherence_events=${events.length}`);
  for (const ev of events.slice(-10)) console.log(`- ${ev.kind} ${ev.subject || '(no subject)'} proof=${ev.proof_class} evidence=${(ev.evidence || []).length}`);
  console.log(`unresolved_incidents=${unresolved.length}`);
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
else runProof();
