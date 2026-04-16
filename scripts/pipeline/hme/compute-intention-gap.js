// scripts/pipeline/compute-intention-gap.js
//
// Phase 4.3 -- intention vs execution gap tracking.
//
// The HME todo store (`.claude/mcp/HME/todos.json`) is the structured record
// of the Evolver's intentions within a session: every substantive plan item
// becomes a todo with a unique id, text, status, and timestamp. The activity
// bridge records every actual file_written event. Crossing these streams
// gives a mechanical "what did we say we'd do vs what did we actually do"
// report.
//
// Improvement vs doc: doc suggested parsing proposed evolutions out of the
// journal (prose). The todo store gives the same signal in clean JSON form --
// no fuzzy text parsing, no heuristics. Every todo entry has `text`,
// `status`, `done`, `ts`.
//
// Classification per todo:
//   completed+done=true, text mentions files that were written -> fully_executed
//   completed but no file activity in scope    -> partially_executed
//   pending/in_progress at round_complete      -> abandoned
//   completed with no scope mention anywhere   -> untrackable (dropped)
//
// Output: metrics/hme-intention-gap.json with per-round snapshot + rolling
// gap EMA. Surfaced via status(mode='intention_gap').
//
// Non-fatal diagnostic.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TODOS = path.join(ROOT, '.claude', 'mcp', 'HME', 'todos.json');
const ACTIVITY = path.join(ROOT, 'metrics', 'hme-activity.jsonl');
const OUT = path.join(ROOT, 'metrics', 'hme-intention-gap.json');

const ROLLING_WINDOW = 30;
const EMA_ALPHA = 0.2;

function loadJsonMaybe(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_e) { return null; }
}

function loadTodos() {
  const raw = loadJsonMaybe(TODOS);
  if (!Array.isArray(raw)) return [];
  // Skip the meta entry at position 0
  return raw.filter((t) => t && typeof t === 'object' && typeof t.id === 'number' && t.text);
}

function loadActivityEvents() {
  if (!fs.existsSync(ACTIVITY)) return [];
  const raw = fs.readFileSync(ACTIVITY, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (_e) { /* skip corrupt */ }
  }
  return out;
}

function sliceToRound(events) {
  // Events since the last round_complete
  let lastRound = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i] && events[i].event === 'round_complete') { lastRound = i; break; }
  }
  return lastRound >= 0 ? events.slice(lastRound + 1) : events;
}

function extractMentionedFiles(todoText) {
  // Pull out any "src/..." path, or any file mentioned with a .js/.py/.sh
  // extension, or any CamelCase module-name token >=4 chars. Heuristic but
  // stable -- the intent is to identify the files a todo nominally targets.
  if (!todoText) return { paths: [], modules: [] };
  const paths = Array.from(todoText.matchAll(/\b(?:src|tools\/HME|scripts)\/[A-Za-z0-9_\-./]+\.(?:js|py|sh|md|json)\b/g)).map((m) => m[0]);
  const modules = Array.from(todoText.matchAll(/\b([a-z][a-zA-Z0-9]{3,}(?:[A-Z][a-zA-Z0-9]+)+)\b/g)).map((m) => m[1]);
  return { paths, modules: Array.from(new Set(modules)) };
}

function main() {
  const todos = loadTodos();
  const events = loadActivityEvents();
  const roundEvents = sliceToRound(events);

  // Collect file_written targets in the current round
  const writtenPaths = new Set();
  const writtenModules = new Set();
  for (const e of roundEvents) {
    if (e && e.event === 'file_written') {
      if (e.file) writtenPaths.add(e.file);
      if (e.module) writtenModules.add(e.module);
    }
  }

  // Consider only todos that existed during this round -- we approximate by
  // filtering to todos with status in ('pending','in_progress','completed')
  // and any timestamp (no per-round history available yet). This captures
  // the current session's intentions.
  const scopedTodos = todos.filter((t) => t.status && t.text);
  if (scopedTodos.length === 0) {
    console.log('compute-intention-gap: no todos to evaluate');
    return;
  }

  const classification = {
    fully_executed: [],
    partially_executed: [],
    abandoned: [],
    untrackable: [],
  };

  for (const t of scopedTodos) {
    const { paths, modules } = extractMentionedFiles(t.text);
    const hasTargets = paths.length > 0 || modules.length > 0;
    const pathHit = paths.some((p) => Array.from(writtenPaths).some((w) => w.endsWith(p)));
    const moduleHit = modules.some((m) => writtenModules.has(m));

    if (t.status === 'completed' && t.done === true) {
      if (!hasTargets) {
        classification.untrackable.push({ id: t.id, text: t.text.slice(0, 80) });
      } else if (pathHit || moduleHit) {
        classification.fully_executed.push({ id: t.id, text: t.text.slice(0, 80) });
      } else {
        classification.partially_executed.push({
          id: t.id,
          text: t.text.slice(0, 80),
          expected: [...paths, ...modules].slice(0, 5),
        });
      }
    } else if (t.status === 'pending' || t.status === 'in_progress') {
      if (hasTargets) {
        classification.abandoned.push({
          id: t.id,
          text: t.text.slice(0, 80),
          status: t.status,
          expected: [...paths, ...modules].slice(0, 5),
        });
      } else {
        classification.untrackable.push({ id: t.id, text: t.text.slice(0, 80) });
      }
    } else {
      classification.untrackable.push({ id: t.id, text: t.text.slice(0, 80) });
    }
  }

  const trackable =
    classification.fully_executed.length +
    classification.partially_executed.length +
    classification.abandoned.length;
  const gap = trackable > 0
    ? (classification.partially_executed.length + classification.abandoned.length) / trackable
    : null;

  // EMA update
  const prev = loadJsonMaybe(OUT);
  const prevEma = prev && typeof prev.ema === 'number' ? prev.ema : null;
  let newEma;
  if (gap === null) newEma = prevEma;
  else if (prevEma === null) newEma = gap;
  else newEma = prevEma * (1 - EMA_ALPHA) + gap * EMA_ALPHA;

  const snapshot = {
    timestamp: new Date().toISOString(),
    todos_total: scopedTodos.length,
    trackable,
    fully_executed: classification.fully_executed.length,
    partially_executed: classification.partially_executed.length,
    abandoned: classification.abandoned.length,
    untrackable: classification.untrackable.length,
    gap: gap !== null ? Number(gap.toFixed(4)) : null,
    ema_after: newEma !== null ? Number(newEma.toFixed(4)) : null,
    abandoned_items: classification.abandoned.slice(0, 10),
  };

  const history = Array.isArray(prev && prev.history) ? prev.history.slice(-ROLLING_WINDOW + 1) : [];
  history.push(snapshot);

  const report = {
    meta: {
      script: 'compute-intention-gap.js',
      timestamp: new Date().toISOString(),
      window: ROLLING_WINDOW,
      ema_alpha: EMA_ALPHA,
    },
    ema: newEma !== null ? Number(newEma.toFixed(4)) : null,
    latest: snapshot,
    history,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  const gapPct = gap !== null ? `${(gap * 100).toFixed(0)}%` : 'n/a';
  const emaPct = newEma !== null ? `${(newEma * 100).toFixed(0)}%` : 'n/a';
  console.log(
    `compute-intention-gap: gap=${gapPct}  ema=${emaPct}  ` +
      `(${classification.fully_executed.length} full, ${classification.partially_executed.length} partial, ` +
      `${classification.abandoned.length} abandoned, ${classification.untrackable.length} untrackable)`,
  );
}

main();
