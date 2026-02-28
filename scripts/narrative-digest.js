// scripts/narrative-digest.js
// Generates a human-readable prose narrative of the composition run.
// Instead of raw data, this produces a STORY: what the system did, why it
// did it, and how it felt about it (trust scores, regime transitions, etc.)
//
// Sources: output/trace-summary.json, output/system-manifest.json, output/trace.jsonl
// Output: output/narrative-digest.md
//
// This is the most compelling artifact for understanding a composition run
// without reading thousands of lines of trace data.
//
// Run: node scripts/narrative-digest.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'trace-summary.json');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'system-manifest.json');
const TRACE_PATH = path.join(OUTPUT_DIR, 'trace.jsonl');
const DIGEST_PATH = path.join(OUTPUT_DIR, 'narrative-digest.md');

// ---- Utility ----

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) { return (v * 100).toFixed(1) + '%'; }
function dec(v, d) { return Number(v).toFixed(d || 2); }

function describeRegime(regime) {
  const descriptions = {
    exploring: 'searching for coherence',
    coherent: 'operating in harmony',
    evolving: 'developing new musical ideas',
    drifting: 'losing focus and needing redirection',
    oscillating: 'experiencing feedback interference',
    fragmented: 'pulled in multiple directions',
    stagnant: 'settled into musical stasis',
    initializing: 'warming up'
  };
  return descriptions[regime] || regime;
}

function describeTrustLevel(weight) {
  if (weight >= 1.5) return 'highly trusted';
  if (weight >= 1.2) return 'trusted';
  if (weight >= 0.9) return 'neutral';
  if (weight >= 0.6) return 'distrusted';
  return 'heavily penalized';
}

// ---- Parse trace for section/regime transitions ----

function extractNarrativeEvents(tracePath) {
  if (!fs.existsSync(tracePath)) return { sections: [], regimeTransitions: [], trustJourney: [] };

  const raw = fs.readFileSync(tracePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const sections = [];
  const regimeTransitions = [];
  let prevRegime = null;
  let prevSection = null;
  let sectionStartBeat = 0;

  for (let i = 0; i < lines.length; i++) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch (_) { continue; }

    const regime = entry.regime || 'unknown';
    const section = entry.section !== undefined ? entry.section : null;
    const beatKey = entry.beatKey || 'beat-' + i;

    // Track regime transitions
    if (regime !== prevRegime && prevRegime !== null) {
      regimeTransitions.push({
        beat: i,
        beatKey,
        from: prevRegime,
        to: regime,
        section: section
      });
    }
    prevRegime = regime;

    // Track section boundaries
    if (section !== prevSection && section !== null) {
      if (prevSection !== null) {
        sections.push({
          section: prevSection,
          startBeat: sectionStartBeat,
          endBeat: i - 1,
          length: i - sectionStartBeat
        });
      }
      prevSection = section;
      sectionStartBeat = i;
    }
  }

  // Close last section
  if (prevSection !== null) {
    sections.push({
      section: prevSection,
      startBeat: sectionStartBeat,
      endBeat: lines.length - 1,
      length: lines.length - sectionStartBeat
    });
  }

  return { sections, regimeTransitions };
}

// ---- Generate the narrative ----

function generateNarrative() {
  const summary = loadJSON(SUMMARY_PATH);
  const manifest = loadJSON(MANIFEST_PATH);
  const { sections, regimeTransitions } = extractNarrativeEvents(TRACE_PATH);

  const lines = [];
  lines.push('# Composition Narrative Digest');
  lines.push('');
  lines.push('> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.');
  lines.push('> Generated: ' + new Date().toISOString());
  lines.push('');

  // ---- Overview ----
  lines.push('## Overview');
  lines.push('');

  if (manifest) {
    const bpm = manifest.config && manifest.config.BPM ? manifest.config.BPM : '?';
    const tuning = manifest.config && manifest.config.TUNING_FREQ ? manifest.config.TUNING_FREQ : '?';
    const profile = manifest.config && manifest.config.activeProfile ? manifest.config.activeProfile : 'default';
    lines.push(`The composition was generated at **${bpm} BPM** with a tuning reference of **${tuning} Hz**, ` +
      `using the **${profile}** conductor profile.`);
    lines.push('');
  }

  if (summary && summary.beats) {
    const totalBeats = summary.beats.totalEntries;
    const spanMs = toNum(summary.beats.spanMs, 0);
    const spanSec = (spanMs / 1000).toFixed(1);
    lines.push(`The system processed **${totalBeats} beats** spanning **${spanSec} seconds** of musical time.`);
    if (summary.beats.byLayer) {
      lines.push(`Layer 1 experienced ${summary.beats.byLayer.L1 || 0} beats; Layer 2 experienced ${summary.beats.byLayer.L2 || 0} beats.`);
    }
    lines.push('');
  }

  // ---- Harmonic Journey ----
  if (manifest && manifest.journey) {
    lines.push('## Harmonic Journey');
    lines.push('');
    const journey = manifest.journey;
    if (Array.isArray(journey)) {
      for (let i = 0; i < journey.length; i++) {
        const j = journey[i];
        const key = j.key || '?';
        const mode = j.mode || '?';
        const move = j.move || 'start';
        lines.push(`- **Section ${i + 1}:** ${key} ${mode} (${move})`);
      }
    }
    lines.push('');
  }

  // ---- Regime Story ----
  lines.push('## The System\'s Inner Life');
  lines.push('');

  if (summary && summary.regimes) {
    const regimes = summary.regimes;
    const totalBeats = Object.values(regimes).reduce((s, v) => s + v, 0);
    const dominant = Object.entries(regimes).sort((a, b) => b[1] - a[1])[0];

    lines.push(`The system spent most of its time **${describeRegime(dominant[0])}** ` +
      `(${pct(dominant[1] / totalBeats)} of beats in the \`${dominant[0]}\` regime).`);
    lines.push('');

    // Detail all regimes
    lines.push('Regime breakdown:');
    lines.push('');
    for (const [regime, count] of Object.entries(regimes).sort((a, b) => b[1] - a[1])) {
      lines.push(`- **\`${regime}\`** - ${count} beats (${pct(count / totalBeats)}) - ${describeRegime(regime)}`);
    }
    lines.push('');
  }

  // Regime transitions narrative
  if (regimeTransitions.length > 0) {
    lines.push('### Regime Transitions');
    lines.push('');
    const maxTransitions = Math.min(regimeTransitions.length, 15);
    lines.push(`The system underwent **${regimeTransitions.length} regime transitions** during the composition.`);
    if (regimeTransitions.length > maxTransitions) {
      lines.push(`Here are the ${maxTransitions} most significant:`);
    }
    lines.push('');
    for (let i = 0; i < maxTransitions; i++) {
      const t = regimeTransitions[i];
      lines.push(`- Beat ${t.beat}: transitioned from **${t.from}** to **${t.to}** ` +
        `(the system went from ${describeRegime(t.from)} to ${describeRegime(t.to)})`);
    }
    lines.push('');
  }

  // ---- Conductor Signals ----
  lines.push('## Signal Landscape');
  lines.push('');

  if (summary && summary.conductor) {
    const c = summary.conductor;
    if (c.density) {
      lines.push(`**Density** ranged from ${dec(c.density.min)} to ${dec(c.density.max)} ` +
        `(avg ${dec(c.density.avg)}). ` +
        (c.density.avg < 0.4 ? 'The composition leaned toward sparseness.' :
         c.density.avg > 0.7 ? 'The composition was notably dense.' :
         'The density was balanced.'));
    }
    if (c.tension) {
      lines.push(`**Tension** ranged from ${dec(c.tension.min)} to ${dec(c.tension.max)} ` +
        `(avg ${dec(c.tension.avg)}). ` +
        (c.tension.avg > 1.3 ? 'High sustained tension characterized this composition.' :
         c.tension.avg < 0.8 ? 'The composition maintained a relaxed tension profile.' :
         'Tension levels were moderate throughout.'));
    }
    if (c.flicker) {
      lines.push(`**Flicker** ranged from ${dec(c.flicker.min)} to ${dec(c.flicker.max)} ` +
        `(avg ${dec(c.flicker.avg)}). ` +
        (c.flicker.avg > 1.3 ? 'Rhythmic variation was high - the system was exploratory.' :
         c.flicker.avg < 0.8 ? 'The rhythmic character was steady and predictable.' :
         'Rhythmic variation was moderate.'));
    }
    lines.push('');
  }

  // ---- Trust Governance ----
  lines.push('## Trust Governance');
  lines.push('');

  if (summary && summary.trustAbs) {
    const trusted = Object.entries(summary.trustAbs)
      .map(([name, stat]) => ({ name, avg: toNum(stat.avg, 0) }))
      .sort((a, b) => b.avg - a.avg);

    if (trusted.length > 0) {
      lines.push('The trust system governed cross-layer module influence through EMA-weighted scores:');
      lines.push('');
      for (const t of trusted) {
        const weight = 1 + t.avg * 0.75;
        lines.push(`- **${t.name}**: average score ${dec(t.avg)} (weight ${dec(weight)}, ${describeTrustLevel(weight)})`);
      }
      lines.push('');

      const mostTrusted = trusted[0];
      const leastTrusted = trusted[trusted.length - 1];
      lines.push(`The system placed the most faith in **${mostTrusted.name}** and was most skeptical of **${leastTrusted.name}**.`);
      lines.push('');
    }
  }

  // ---- Coupling Health ----
  if (summary && summary.couplingAbs) {
    lines.push('## Pipeline Coupling');
    lines.push('');

    const pairs = Object.entries(summary.couplingAbs)
      .map(([pair, stat]) => ({ pair, avg: toNum(stat.avg, 0), max: toNum(stat.max, 0) }))
      .sort((a, b) => b.avg - a.avg);

    if (pairs.length > 0) {
      const highCoupling = pairs.filter(p => p.avg > 0.5);
      if (highCoupling.length > 0) {
        lines.push('The decorrelation engine flagged elevated coupling in:');
        lines.push('');
        for (const p of highCoupling) {
          lines.push(`- **${p.pair}**: avg |r| = ${dec(p.avg, 3)}, peak |r| = ${dec(p.max, 3)}`);
        }
        lines.push('');
      } else {
        lines.push('All compositional dimension pairs maintained healthy decorrelation levels.');
        lines.push('');
      }
    }
  }

  // ---- Output Summary ----
  if (manifest && manifest.output) {
    lines.push('## Output');
    lines.push('');
    const out = manifest.output;
    if (out.L1) lines.push(`- **Layer 1:** ${out.L1.noteCount || '?'} notes`);
    if (out.L2) lines.push(`- **Layer 2:** ${out.L2.noteCount || '?'} notes`);
    lines.push('');
  }

  // ---- Coherence Verdicts ----
  if (manifest && Array.isArray(manifest.coherenceVerdicts)) {
    const verdicts = manifest.coherenceVerdicts;
    const critical = verdicts.filter(v => v.severity === 'critical');
    const warnings = verdicts.filter(v => v.severity === 'warning');
    const info = verdicts.filter(v => v.severity === 'info');

    lines.push('## Coherence Verdicts');
    lines.push('');
    lines.push(`The system issued **${critical.length} critical**, **${warnings.length} warning**, and **${info.length} informational** findings.`);
    lines.push('');

    if (critical.length > 0) {
      lines.push('### Critical Findings');
      lines.push('');
      for (const v of critical) {
        lines.push('- ' + (v.finding || v.message || JSON.stringify(v)));
      }
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push('### Warnings');
      lines.push('');
      for (const v of warnings.slice(0, 10)) {
        lines.push('- ' + (v.finding || v.message || JSON.stringify(v)));
      }
      if (warnings.length > 10) lines.push('- ... and ' + (warnings.length - 10) + ' more');
      lines.push('');
    }
  }

  // ---- Closing ----
  lines.push('---');
  lines.push('');
  lines.push('*This narrative was generated automatically from composition telemetry. ' +
    'For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*');
  lines.push('');

  return lines.join('\n');
}

// ---- Main ----

function main() {
  const summary = loadJSON(SUMMARY_PATH);
  if (!summary) {
    console.log('narrative-digest: trace-summary.json not found, skipping.');
    return;
  }

  const narrative = generateNarrative();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(DIGEST_PATH, narrative, 'utf8');

  console.log('narrative-digest: composition story generated -> output/narrative-digest.md');
}

main();
