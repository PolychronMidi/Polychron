const fs = require('fs');
const path = require('path');

/**
 * Check the output/critical-errors.ndjson for entries whose `when` is >= runStartIso.
 * Returns the array of matching parsed entries (may be empty).
 */
function checkCriticalsSince(runStartIso, critPathOverride, playRunId) {
  const critPath = typeof critPathOverride === 'string' ? critPathOverride : path.join(process.cwd(), 'output', 'critical-errors.ndjson');
  if (!fs.existsSync(critPath)) return [];
  const content = fs.readFileSync(critPath, 'utf8').trim();
  if (!content) return [];
  const runStart = new Date(runStartIso).getTime();
  const lines = content.split(/\r?\n/);
  const parsed = [];
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      if (j && j.when && (new Date(j.when).getTime() >= runStart)) {
        // If a play-run id was provided, only consider CRITICAL entries that match it.
        if (typeof playRunId === 'string' && playRunId.length) {
          if (j && j.playRunId === playRunId) parsed.push(j);
        } else {
          parsed.push(j);
        }
      }
    } catch (e) { /* ignore malformed lines */ }
  }
  // Returning parsed entries (filtered by timestamp and optional playRunId) so callers
  // can choose to enforce strict post-run invariants. Tests that intentionally expect
  // CRITICALs should use playRunId to isolate their CRITICALs or set ALLOW_PLAY_CRITICALS.
  return parsed;
}

module.exports = { checkCriticalsSince };
