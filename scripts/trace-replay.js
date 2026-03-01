// scripts/trace-replay.js
// Trace replay mode: replays a recorded trace.jsonl to reconstruct the
// composition's state timeline for analysis, debugging, or visualization.
//
// Modes:
//   --timeline   Print beat-by-beat state timeline to stdout (default)
//   --section N  Filter to section N only
//   --layer L    Filter to layer L only (L1 or L2)
//   --json       Output structured JSON instead of formatted text
//   --stats      Show aggregate statistics per section/phrase
//   --search K=V Filter beats where snap.K matches V
//
// Usage: node scripts/trace-replay.js [--timeline] [--section N] [--layer L] [--json] [--stats]
// Input: output/trace.jsonl
// Output: stdout or output/trace-replay.json (with --json)

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const TRACE_PATH = path.join(OUTPUT_DIR, 'trace.jsonl');
const REPLAY_JSON_PATH = path.join(OUTPUT_DIR, 'trace-replay.json');

// ---- Helpers ----

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseBeatKey(beatKey) {
  const parts = (beatKey || '').split(':').map(Number);
  return {
    section: parts[0] || 0,
    phrase: parts[1] || 0,
    measure: parts[2] || 0,
    beat: parts[3] || 0
  };
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ---- Load Trace ----

function loadTrace() {
  if (!fs.existsSync(TRACE_PATH)) {
    throw new Error('trace-replay: trace.jsonl not found at ' + TRACE_PATH);
  }
  const raw = fs.readFileSync(TRACE_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.map((line, idx) => {
    try {
      const entry = JSON.parse(line);
      entry._lineIndex = idx;
      return entry;
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

// ---- Timeline Rendering ----

function renderTimeline(entries) {
  const lines = [];
  let lastSection = -1;
  let lastPhrase = -1;

  for (const e of entries) {
    const bk = parseBeatKey(e.beatKey);
    const snap = e.snap || {};
    const neg = e.negotiation || {};

    // Section header
    if (bk.section !== lastSection) {
      lines.push('');
      lines.push(`=== Section ${bk.section} === key=${snap.key || '?'} mode=${snap.mode || '?'} phase=${snap.sectionPhase || '?'}`);
      lastSection = bk.section;
      lastPhrase = -1;
    }

    // Phrase header
    if (bk.phrase !== lastPhrase) {
      lines.push(`  --- Phrase ${bk.phrase} --- profile=${snap.activeProfile || '?'} texture=${snap.textureMode || '?'}`);
      lastPhrase = bk.phrase;
    }

    // Beat line
    const tension = toNum(snap.tension, 0).toFixed(3);
    const playProb = toNum(neg.playProb, toNum(snap.playProb, 0)).toFixed(3);
    const regime = e.regime || '?';
    const noteCount = e.notes ? e.notes.length : 0;
    const noteInfo = noteCount > 0 ? ` notes=[${e.notes.map(n => n.pitch).join(',')}]` : '';

    lines.push(`    ${e.layer} ${e.beatKey} t=${toNum(e.timeMs, 0).toFixed(0)}ms tens=${tension} pp=${playProb} reg=${regime}${noteInfo}`);
  }

  return lines.join('\n');
}

// ---- Section/Phrase Statistics ----

function computeStats(entries) {
  const sections = {};

  for (const e of entries) {
    const bk = parseBeatKey(e.beatKey);
    const sKey = `S${bk.section}`;
    const pKey = `${sKey}:P${bk.phrase}`;

    if (!sections[sKey]) {
      sections[sKey] = { beats: 0, tensions: [], playProbs: [], regimes: {}, phrases: {}, key: '', mode: '' };
    }
    const sec = sections[sKey];
    sec.beats++;
    const snap = e.snap || {};
    sec.key = snap.key || sec.key;
    sec.mode = snap.mode || sec.mode;
    sec.tensions.push(toNum(snap.tension, 0));
    sec.playProbs.push(toNum(e.negotiation && e.negotiation.playProb, toNum(snap.playProb, 0)));
    const reg = e.regime || 'unknown';
    sec.regimes[reg] = (sec.regimes[reg] || 0) + 1;

    if (!sec.phrases[pKey]) {
      sec.phrases[pKey] = { beats: 0, tensions: [], noteCount: 0, profile: snap.activeProfile || '?' };
    }
    const ph = sec.phrases[pKey];
    ph.beats++;
    ph.tensions.push(toNum(snap.tension, 0));
    ph.noteCount += (e.notes ? e.notes.length : 0);
  }

  // Summarize
  const summary = [];
  for (const [sKey, sec] of Object.entries(sections)) {
    const secSummary = {
      section: sKey,
      key: sec.key,
      mode: sec.mode,
      beats: sec.beats,
      avgTension: mean(sec.tensions).toFixed(3),
      avgPlayProb: mean(sec.playProbs).toFixed(3),
      dominantRegime: Object.entries(sec.regimes).sort((a, b) => b[1] - a[1])[0][0],
      phrases: []
    };
    for (const [pKey, ph] of Object.entries(sec.phrases)) {
      secSummary.phrases.push({
        phrase: pKey,
        beats: ph.beats,
        avgTension: mean(ph.tensions).toFixed(3),
        noteCount: ph.noteCount,
        profile: ph.profile
      });
    }
    summary.push(secSummary);
  }
  return summary;
}

function renderStats(stats) {
  const lines = [];
  for (const sec of stats) {
    lines.push(`${sec.section}: ${sec.key} ${sec.mode} | ${sec.beats} beats | tension=${sec.avgTension} | pp=${sec.avgPlayProb} | regime=${sec.dominantRegime}`);
    for (const ph of sec.phrases) {
      lines.push(`  ${ph.phrase}: ${ph.beats} beats | tension=${ph.avgTension} | notes=${ph.noteCount} | profile=${ph.profile}`);
    }
  }
  return lines.join('\n');
}

// ---- Search Filter ----

function parseSearch(searchStr) {
  const eqIdx = searchStr.indexOf('=');
  if (eqIdx === -1) throw new Error('trace-replay: --search format must be KEY=VALUE');
  return { key: searchStr.slice(0, eqIdx), value: searchStr.slice(eqIdx + 1) };
}

function matchesSearch(entry, search) {
  const snap = entry.snap || {};
  const val = snap[search.key];
  if (val === undefined) return false;
  return String(val) === search.value;
}

// ---- CLI ----

function main() {
  const args = process.argv.slice(2);
  const flagIdx = (flag) => args.indexOf(flag);

  const jsonMode = args.includes('--json');
  const statsMode = args.includes('--stats');

  const sectionIdx = flagIdx('--section');
  const sectionFilter = sectionIdx !== -1 ? Number(args[sectionIdx + 1]) : null;

  const layerIdx = flagIdx('--layer');
  const layerFilter = layerIdx !== -1 ? args[layerIdx + 1] : null;

  const searchIdx = flagIdx('--search');
  const searchFilter = searchIdx !== -1 ? parseSearch(args[searchIdx + 1]) : null;

  let entries = loadTrace();

  // Apply filters
  if (sectionFilter !== null && Number.isFinite(sectionFilter)) {
    entries = entries.filter(e => parseBeatKey(e.beatKey).section === sectionFilter);
  }
  if (layerFilter) {
    entries = entries.filter(e => e.layer === layerFilter);
  }
  if (searchFilter) {
    entries = entries.filter(e => matchesSearch(e, searchFilter));
  }

  if (entries.length === 0) {
    console.log('trace-replay: no matching entries found');
    return;
  }

  if (statsMode) {
    const stats = computeStats(entries);
    if (jsonMode) {
      const output = { meta: { generated: new Date().toISOString(), entryCount: entries.length }, stats };
      fs.writeFileSync(REPLAY_JSON_PATH, JSON.stringify(output, null, 2), 'utf8');
      console.log(`trace-replay: stats written -> output/trace-replay.json`);
    } else {
      console.log(`trace-replay: ${entries.length} entries\n`);
      console.log(renderStats(stats));
    }
    return;
  }

  // Timeline mode (default)
  if (jsonMode) {
    const output = {
      meta: { generated: new Date().toISOString(), entryCount: entries.length },
      entries: entries.map(e => ({
        layer: e.layer,
        beatKey: e.beatKey,
        timeMs: e.timeMs,
        key: (e.snap || {}).key,
        mode: (e.snap || {}).mode,
        tension: toNum((e.snap || {}).tension, 0),
        playProb: toNum((e.negotiation || {}).playProb, toNum((e.snap || {}).playProb, 0)),
        regime: e.regime,
        notes: e.notes || []
      }))
    };
    fs.writeFileSync(REPLAY_JSON_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`trace-replay: ${entries.length} entries written -> output/trace-replay.json`);
  } else {
    console.log(`trace-replay: ${entries.length} entries\n`);
    console.log(renderTimeline(entries));
  }
}

main();
