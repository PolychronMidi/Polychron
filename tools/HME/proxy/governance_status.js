'use strict';
// Governance status reader (TODO #15 enforcement half -- AUDIT-ONLY v1).
//

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const BRIEFS_REL = 'teams/rounds/review-briefs.json';
const LEDGER_REL = 'teams/runtime/round-progress.jsonl';
const AUDIT_REL = 'tools/HME/runtime/governance-audit.jsonl';

// Parse review-briefs.json -> [{ key, evidence: [repo-relative paths] }].
function loadBriefSurfaces(root = PROJECT_ROOT) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, BRIEFS_REL), 'utf8'));
    const briefs = (data && data.briefs) || {};
    return Object.entries(briefs).map(([key, b]) => ({
      key,
      evidence: Array.isArray(b && b.evidence) ? b.evidence.map(String) : [],
    }));
  } catch (_e) { return []; /* fail-open: no briefs => no surface mapping */ }
}

// Map a repo-relative path to the owning brief key, or null. Longest evidence
// match wins so the most specific surface owns the path.
function surfaceForPath(relPath, root = PROJECT_ROOT) {
  const rel = String(relPath || '').replace(/^\.\//, '');
  if (!rel) return null;
  let best = null;
  let bestLen = -1;
  for (const { key, evidence } of loadBriefSurfaces(root)) {
    for (const ev of evidence) {
      const e = ev.replace(/^\.\//, '');
      const owns = rel === e || (e.endsWith('/') ? rel.startsWith(e) : rel === e);
      if (owns && e.length > bestLen) { best = key; bestLen = e.length; }
    }
  }
  return best;
}

// Read round-progress.jsonl; 'reviewed' if a completed round maps to this brief
// key, else 'pending'. 'unknown' when the ledger is absent/unreadable.
function reviewStatusForSurface(key, root = PROJECT_ROOT) {
  let lines;
  try { lines = fs.readFileSync(path.join(root, LEDGER_REL), 'utf8').split(/\r?\n/); }
  catch (_e) { return 'unknown'; /* fail-open: no ledger => unknown, never blocks */ }
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch (_e) { continue; }
    const round = String(row.round || '');
    if (row.step === 'round' && row.status === 'done' && key && round.includes(key)) return 'reviewed';
  }
  return 'pending';
}

// Fail-OPEN audit: append one JSON row to the runtime audit ledger. Always
// returns null (allow). Never throws into the caller's policy decision.
function auditAutonomousAction({ command, relPath, surface, status, override }, root = PROJECT_ROOT) {
  try {
    const file = path.join(root, AUDIT_REL);
    const row = {
      ts: new Date().toISOString(),
      surface: surface || null,
      path: relPath || null,
      status: status || 'unknown',
      override: Boolean(override),
      command: String(command || '').slice(0, 500),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch (_e) { /* silent-ok: audit is advisory; never blocks the action */ }
  return null;
}

module.exports = { loadBriefSurfaces, surfaceForPath, reviewStatusForSurface, auditAutonomousAction };
