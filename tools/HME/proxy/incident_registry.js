'use strict';
/**
 * Structured incident/LIFESAVER registry.
 *
 * Existing scanners are text-based and read log/hme-errors.log, so incidents
 * still render a compact LIFESAVER-compatible line there. Structured metadata is
 * appended separately for dedupe, status, and future `i/status incidents` views.
 */

const fs = require('fs');
const path = require('path');

const ERROR_LOG_REL = path.join('log', 'hme-errors.log');
const INCIDENT_LOG_REL = path.join('tools', 'HME', 'runtime', 'incidents.jsonl');
const LIFESAVER_TEXT_RE = /\[ALERT\]\s+LIFESAVER|\bLIFESAVER\s+--/;

function _ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function _singleLine(value, limit = 600) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeIncident(input) {
  if (!input || typeof input !== 'object') throw new Error('incident_registry: incident object required');
  const id = _singleLine(input.id || input.event || 'unknown-incident', 120).replace(/\s+/g, '-');
  const severity = _singleLine(input.severity || 'lifesaver', 40).toLowerCase();
  const component = _singleLine(input.component || 'hme', 80);
  const summary = _singleLine(input.summary || input.reason || id, 600);
  const repair = input.repair ? _singleLine(input.repair, 300) : '';
  const dedupeKey = _singleLine(input.dedupeKey || `${component}:${id}`, 200);
  const evidence = input.evidence && typeof input.evidence === 'object' ? { ...input.evidence } : {};
  const status = ['open', 'resolved', 'observation'].includes(input.status) ? input.status : 'open';
  const rootCause = _singleLine(input.rootCause || input.root_cause || '', 300);
  const fixedBy = _singleLine(input.fixedBy || input.fixed_by || '', 120);
  const regressionTest = _singleLine(input.regressionTest || input.regression_test || '', 240);
  const resolver = _singleLine(input.resolver || '', 240);
  const proof = input.proof && typeof input.proof === 'object' ? { ...input.proof } : {};
  const ts = input.ts || _ts();
  return { id, severity, component, summary, repair, dedupeKey, evidence, status, rootCause, fixedBy, regressionTest, resolver, proof, ts };
}

function formatIncidentLine(input) {
  const incident = normalizeIncident(input);
  const tag = incident.id;
  const prefix = incident.severity === 'lifesaver'
    ? `[${incident.ts}] [${tag}] LIFESAVER -- `
    : `[${incident.ts}] [${tag}] ${incident.severity.toUpperCase()} -- `;
  const repair = incident.repair ? ` repair=${incident.repair}` : '';
  return `${prefix}${incident.summary}${repair}`;
}

// Best-effort fan-out: every recorded incident becomes a coherence event (kind
// 'incident'|'resolver') and a raw-trace metabolism fact. Lazy-required to avoid
// a load cycle; wrapped so a ledger failure can never break incident recording.
function _emitCoherence(root, incident) {
  try {
    const events = require('./coherence_events');
    events.appendEvent(root, {
      kind: incident.status === 'resolved' ? 'resolver' : 'incident',
      subject: `${incident.component}:${incident.id}`,
      intent: incident.summary,
      evidence: incident.resolver ? [incident.resolver] : [],
      coherence_delta: incident.status === 'resolved' ? 1 : -1,
      entropy_delta: incident.status === 'resolved' ? -1 : 1,
      obligations: incident.status === 'open' && incident.repair ? [incident.repair] : [],
      proofClass: incident.status === 'resolved' ? 'derived' : (incident.severity === 'observation' ? 'observed' : 'policy'),
      meta: { severity: incident.severity, status: incident.status },
    });
  } catch (_e) { /* silent-ok: ledger is advisory; incident path must not break */ }
  try {
    const metabolism = require('./context_metabolism');
    metabolism.appendFact(root, {
      subject: `${incident.component}:${incident.id}`,
      content: incident.summary,
      stage: incident.status === 'resolved' ? 'verified_fact' : 'raw_trace',
      proof_strength: incident.status === 'resolved' ? 0.7 : 0.2,
      usefulness: incident.severity === 'lifesaver' ? 0.7 : 0.4,
      source: 'incident_registry',
    });
  } catch (_e) { /* silent-ok: metabolism is advisory */ }
}

function recordIncident(root, input, opts = {}) {
  const incident = normalizeIncident(input);
  const line = opts.line || formatIncidentLine(incident);
  const errorPath = path.join(root, ERROR_LOG_REL);
  const incidentPath = path.join(root, INCIDENT_LOG_REL);
  try {
    fs.mkdirSync(path.dirname(errorPath), { recursive: true });
    if (incident.status === 'open') fs.appendFileSync(errorPath, `${line}\n`);
    fs.mkdirSync(path.dirname(incidentPath), { recursive: true });
    fs.appendFileSync(incidentPath, `${JSON.stringify({ ...incident, line, lifesaver: LIFESAVER_TEXT_RE.test(line) })}\n`);
    if (opts.emitCoherence !== false) _emitCoherence(root, incident);
    return true;
  } catch (err) {
    process.stderr.write(`${line} (incident append failed: ${err.message})\n`);
    return false;
  }
}

function readIncidents(root) {
  try {
    return fs.readFileSync(path.join(root, INCIDENT_LOG_REL), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } }).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function resolveIncident(root, input) {
  // Idempotent: skip if a resolved row with this dedupeKey already exists, so
  // repeated deliberate resolve passes never spam the ledger.
  const incident = normalizeIncident({ ...input, status: 'resolved', severity: input.severity || 'lifesaver' });
  if (readIncidents(root).some((r) => r && r.status === 'resolved' && r.dedupeKey === incident.dedupeKey)) return true;
  return recordIncident(root, incident, { line: input.line || formatIncidentLine(incident) });
}

function resolutionForLine(root, line) {
  return require('./incident_resolvers').resolveLine(root, line);
}

function unresolvedLines(root, lines) {
  return (lines || []).filter((line) => !resolutionForLine(root, line).resolved);
}

module.exports = {
  ERROR_LOG_REL,
  INCIDENT_LOG_REL,
  LIFESAVER_TEXT_RE,
  normalizeIncident,
  formatIncidentLine,
  recordIncident,
  readIncidents,
  resolveIncident,
  resolutionForLine,
  unresolvedLines,
};
