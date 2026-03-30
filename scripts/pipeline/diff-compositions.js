// scripts/diff-compositions.js
// Structural diff between two composition runs. Compares the musical structure
// (sections, phrases, harmonic changes, tension arcs, regime transitions)
// rather than exact MIDI events.
//
// Usage:
//   node scripts/diff-compositions.js <dirA> <dirB>
//   node scripts/diff-compositions.js --against <snapshot>
//
// Input: trace.jsonl + output CSVs from each run
// Output: metrics/composition-diff.json + metrics/composition-diff.md

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const METRICS_DIR     = path.join(ROOT, 'metrics');
const COMPOSITION_DIR = path.join(ROOT, 'output');
const SNAPSHOT_DIR    = path.join(ROOT, 'metrics', 'snapshots');
const DIFF_JSON       = path.join(METRICS_DIR, 'composition-diff.json');
const DIFF_MD         = path.join(METRICS_DIR, 'composition-diff.md');

// -Helpers -

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function parseBeatKey(beatKey) {
  const parts = (beatKey || '').split(':').map(Number);
  return { section: parts[0] || 0, phrase: parts[1] || 0, measure: parts[2] || 0, beat: parts[3] || 0 };
}

// -Load Trace and Structure -

function loadTrace(dir) {
  const tracePath = path.join(dir, 'trace.jsonl');
  if (!fs.existsSync(tracePath)) return [];
  const raw = fs.readFileSync(tracePath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

function loadNotes(dir) {
  const notes = {};
  for (const layer of ['output1', 'output2']) {
    const csvPath = path.join(dir, layer + '.csv');
    if (!fs.existsSync(csvPath)) continue;
    const raw = fs.readFileSync(csvPath, 'utf8');
    const pitches = [];
    for (const line of raw.split(/\r?\n/)) {
      const cols = line.split(',');
      if (cols.length >= 6 && cols[2] && cols[2].trim() === 'note_on_c') {
        const pitch = toNum(cols[4], -1);
        const vel = toNum(cols[5], 0);
        if (pitch >= 0 && pitch < 128 && vel > 0) pitches.push(pitch);
      }
    }
    notes[layer] = pitches;
  }
  return notes;
}

// -Extract Structure -

function extractStructure(entries) {
  const sections = [];
  let currentSection = -1;
  let currentPhrase = -1;
  let sec = null;
  let ph = null;

  for (const e of entries) {
    if (e.layer !== 'L1') continue; // Use L1 as structural reference
    const bk = parseBeatKey(e.beatKey);
    const snap = e.snap || {};

    if (bk.section !== currentSection) {
      if (ph && sec) {
        sec.phrases.push(ph);
        ph = null;
      }
      if (sec) sections.push(sec);
      sec = {
        index: bk.section,
        key: snap.key || '?',
        mode: snap.mode || '?',
        sectionPhase: snap.sectionPhase || '?',
        phrases: [],
        tensions: [],
        regimes: {},
        beats: 0
      };
      currentSection = bk.section;
      currentPhrase = -1;
    }

    if (bk.phrase !== currentPhrase) {
      if (ph && sec) sec.phrases.push(ph);
      ph = {
        index: bk.phrase,
        profile: snap.activeProfile || '?',
        texture: snap.textureMode || '?',
        tensions: [],
        beats: 0,
        noteCount: 0
      };
      currentPhrase = bk.phrase;
    }

    sec.beats++;
    sec.tensions.push(toNum(snap.tension, 0));
    const regime = e.regime || 'unknown';
    sec.regimes[regime] = (sec.regimes[regime] || 0) + 1;

    ph.beats++;
    ph.tensions.push(toNum(snap.tension, 0));
    ph.noteCount += (e.notes ? e.notes.length : 0);
  }

  if (ph && sec) sec.phrases.push(ph);
  if (sec) sections.push(sec);

  return sections;
}

// -Compute Structural Diff -

function diffStructures(structA, structB) {
  const diffs = [];

  // Section count
  if (structA.length !== structB.length) {
    diffs.push({
      type: 'section-count',
      severity: 'major',
      detail: `Section count: ${structA.length} -> ${structB.length}`
    });
  }

  const maxSections = Math.max(structA.length, structB.length);
  for (let i = 0; i < maxSections; i++) {
    const sa = structA[i];
    const sb = structB[i];

    if (!sa) {
      diffs.push({ type: 'section-added', severity: 'major', section: i, detail: `Section ${i} added (key=${sb.key} ${sb.mode})` });
      continue;
    }
    if (!sb) {
      diffs.push({ type: 'section-removed', severity: 'major', section: i, detail: `Section ${i} removed (was key=${sa.key} ${sa.mode})` });
      continue;
    }

    // Key/mode change
    if (sa.key !== sb.key || sa.mode !== sb.mode) {
      diffs.push({
        type: 'harmonic-change',
        severity: 'notable',
        section: i,
        detail: `Section ${i}: ${sa.key} ${sa.mode} -> ${sb.key} ${sb.mode}`
      });
    }

    // Phrase count
    if (sa.phrases.length !== sb.phrases.length) {
      diffs.push({
        type: 'phrase-count',
        severity: 'moderate',
        section: i,
        detail: `Section ${i}: ${sa.phrases.length} phrases -> ${sb.phrases.length} phrases`
      });
    }

    // Tension arc comparison
    const tensionA = mean(sa.tensions);
    const tensionB = mean(sb.tensions);
    if (Math.abs(tensionA - tensionB) > 0.1) {
      diffs.push({
        type: 'tension-shift',
        severity: 'moderate',
        section: i,
        detail: `Section ${i} avg tension: ${tensionA.toFixed(3)} -> ${tensionB.toFixed(3)}`
      });
    }

    // Regime distribution shift
    const allRegimes = new Set([...Object.keys(sa.regimes), ...Object.keys(sb.regimes)]);
    for (const r of allRegimes) {
      const ratioA = (sa.regimes[r] || 0) / Math.max(1, sa.beats);
      const ratioB = (sb.regimes[r] || 0) / Math.max(1, sb.beats);
      if (Math.abs(ratioA - ratioB) > 0.2) {
        diffs.push({
          type: 'regime-shift',
          severity: 'minor',
          section: i,
          detail: `Section ${i} regime '${r}': ${(ratioA * 100).toFixed(1)}% -> ${(ratioB * 100).toFixed(1)}%`
        });
      }
    }

    // Per-phrase comparisons
    const maxPhrases = Math.max(sa.phrases.length, sb.phrases.length);
    for (let p = 0; p < maxPhrases; p++) {
      const pa = sa.phrases[p];
      const pb = sb.phrases[p];
      if (!pa || !pb) continue;

      if (pa.profile !== pb.profile) {
        diffs.push({
          type: 'profile-change',
          severity: 'minor',
          section: i,
          phrase: p,
          detail: `S${i}:P${p} profile: ${pa.profile} -> ${pb.profile}`
        });
      }

      if (pa.texture !== pb.texture) {
        diffs.push({
          type: 'texture-change',
          severity: 'minor',
          section: i,
          phrase: p,
          detail: `S${i}:P${p} texture: ${pa.texture} -> ${pb.texture}`
        });
      }
    }
  }

  return diffs;
}

// -Pitch Distribution Diff -

function diffPitchDistribution(notesA, notesB) {
  const diffs = [];

  for (const layer of ['output1', 'output2']) {
    const pA = notesA[layer] || [];
    const pB = notesB[layer] || [];

    // Note count diff
    const countDiff = Math.abs(pA.length - pB.length);
    const countRatio = pA.length > 0 ? countDiff / pA.length : (pB.length > 0 ? 1 : 0);
    if (countRatio > 0.2) {
      diffs.push({
        type: 'note-count',
        severity: countRatio > 0.5 ? 'major' : 'moderate',
        layer,
        detail: `${layer}: ${pA.length} notes -> ${pB.length} notes (${(countRatio * 100).toFixed(1)}% change)`
      });
    }

    // Pitch range diff
    if (pA.length > 0 && pB.length > 0) {
      const rangeA = [Math.min(...pA), Math.max(...pA)];
      const rangeB = [Math.min(...pB), Math.max(...pB)];
      if (Math.abs(rangeA[0] - rangeB[0]) > 12 || Math.abs(rangeA[1] - rangeB[1]) > 12) {
        diffs.push({
          type: 'pitch-range',
          severity: 'moderate',
          layer,
          detail: `${layer} range: [${rangeA[0]}-${rangeA[1]}] -> [${rangeB[0]}-${rangeB[1]}]`
        });
      }

      // Mean pitch diff
      const meanA = mean(pA);
      const meanB = mean(pB);
      if (Math.abs(meanA - meanB) > 6) {
        diffs.push({
          type: 'pitch-center',
          severity: 'moderate',
          layer,
          detail: `${layer} mean pitch: ${meanA.toFixed(1)} -> ${meanB.toFixed(1)} (${Math.abs(meanA - meanB).toFixed(1)} semitones)`
        });
      }
    }
  }

  return diffs;
}

// -Render Markdown -

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Composition Diff');
  lines.push('');
  lines.push('> Auto-generated by `scripts/diff-compositions.js`. Do not hand-edit.');
  lines.push('');
  lines.push(`**Run A**: ${report.meta.dirA}`);
  lines.push(`**Run B**: ${report.meta.dirB}`);
  lines.push('');

  const severityIcon = { major: '!!!', notable: '!!', moderate: '!', minor: '~' };

  // Group by severity
  for (const sev of ['major', 'notable', 'moderate', 'minor']) {
    const items = report.diffs.filter(d => d.severity === sev);
    if (items.length === 0) continue;
    lines.push(`## ${sev.charAt(0).toUpperCase() + sev.slice(1)} Changes (${items.length})`);
    lines.push('');
    for (const d of items) {
      lines.push(`- ${severityIcon[sev]} **${d.type}**: ${d.detail}`);
    }
    lines.push('');
  }

  if (report.diffs.length === 0) {
    lines.push('No structural differences detected.');
    lines.push('');
  }

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total differences: ${report.diffs.length}`);
  lines.push(`- Major: ${report.diffs.filter(d => d.severity === 'major').length}`);
  lines.push(`- Notable: ${report.diffs.filter(d => d.severity === 'notable').length}`);
  lines.push(`- Moderate: ${report.diffs.filter(d => d.severity === 'moderate').length}`);
  lines.push(`- Minor: ${report.diffs.filter(d => d.severity === 'minor').length}`);
  lines.push('');
  lines.push(`\n*Generated ${report.meta.generated}*`);

  return lines.join('\n');
}

// -Main -

function main() {
  const args = process.argv.slice(2);
  let traceDirA, traceDirB, notesDirA, notesDirB;

  if (args[0] === '--against' && args[1]) {
    const snapDir = path.join(SNAPSHOT_DIR, args[1]);
    if (!fs.existsSync(snapDir)) {
      throw new Error(`diff-compositions: snapshot '${args[1]}' not found at ${snapDir}`);
    }
    traceDirA = snapDir;
    notesDirA = snapDir;
    traceDirB = METRICS_DIR;
    notesDirB = COMPOSITION_DIR;
  } else if (args.length >= 2) {
    const dirA = path.resolve(args[0]);
    const dirB = path.resolve(args[1]);
    traceDirA = dirA;
    notesDirA = dirA;
    traceDirB = dirB;
    notesDirB = dirB;
    if (!fs.existsSync(dirA)) throw new Error(`diff-compositions: directory not found: ${dirA}`);
    if (!fs.existsSync(dirB)) throw new Error(`diff-compositions: directory not found: ${dirB}`);
  } else {
    console.log('Usage:');
    console.log('  node scripts/diff-compositions.js <dirA> <dirB>');
    console.log('  node scripts/diff-compositions.js --against <snapshot>');
    process.exit(1);
  }

  if (!fs.existsSync(traceDirA)) throw new Error(`diff-compositions: directory not found: ${traceDirA}`);
  if (!fs.existsSync(traceDirB)) throw new Error(`diff-compositions: directory not found: ${traceDirB}`);

  // Load data
  const traceA = loadTrace(traceDirA);
  const traceB = loadTrace(traceDirB);
  const notesA = loadNotes(notesDirA);
  const notesB = loadNotes(notesDirB);

  // Extract and diff structure
  const structA = extractStructure(traceA);
  const structB = extractStructure(traceB);
  const structDiffs = diffStructures(structA, structB);
  const pitchDiffs = diffPitchDistribution(notesA, notesB);

  const report = {
    meta: {
      generated: new Date().toISOString(),
      dirA: traceDirA,
      dirB: traceDirB,
      traceSizeA: traceA.length,
      traceSizeB: traceB.length,
      sectionsA: structA.length,
      sectionsB: structB.length
    },
    diffs: [...structDiffs, ...pitchDiffs]
  };

  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.writeFileSync(DIFF_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(DIFF_MD, renderMarkdown(report), 'utf8');

  const majorCount = report.diffs.filter(d => d.severity === 'major').length;
  console.log(`diff-compositions: ${report.diffs.length} differences (${majorCount} major) -> metrics/composition-diff.json + .md`);
}

main();
