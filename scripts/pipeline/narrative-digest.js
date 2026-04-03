// scripts/narrative-digest.js
// Generates a human-readable prose narrative of the composition run.
// Instead of raw data, this produces a STORY: what the system did, why it
// did it, and how it felt about it (trust scores, regime transitions, etc.)
//
// Sources: metrics/trace-summary.json, metrics/system-manifest.json, metrics/trace.jsonl
// Output: metrics/narrative-digest.md
//
// This is the most compelling artifact for understanding a composition run
// without reading thousands of lines of trace data.
//
// Run: node scripts/narrative-digest.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const METRICS_DIR = path.join(ROOT, 'metrics');
const COMPOSITION_DIR = path.join(ROOT, 'output');
const SUMMARY_PATH = path.join(METRICS_DIR, 'trace-summary.json');
const MANIFEST_PATH = path.join(METRICS_DIR, 'system-manifest.json');
const TRACE_PATH = path.join(METRICS_DIR, 'trace.jsonl');
const DIGEST_PATH = path.join(METRICS_DIR, 'narrative-digest.md');

// -Utility -

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

// -Parse trace for section/regime transitions -

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
    const beatKey = entry.beatKey || 'beat-' + i;
    // beatKey format: "section:phrase:beat:subdivision"
    const section = beatKey.includes(':') ? parseInt(beatKey.split(':')[0], 10) : null;

    // Track regime transitions with causal attribution
    if (regime !== prevRegime && prevRegime !== null) {
      const forced = entry.forcedTransitionEvent;
      const cause = forced && forced.reason ? 'forced: ' + forced.reason : 'organic';
      regimeTransitions.push({
        beat: i,
        beatKey,
        from: prevRegime,
        to: regime,
        section: section,
        cause
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

// -Generate the narrative -

function generateNarrative() {
  const summary = loadJSON(SUMMARY_PATH);
  const manifest = loadJSON(MANIFEST_PATH);
  const { sections, regimeTransitions } = extractNarrativeEvents(TRACE_PATH);

  const lines = [];
  lines.push('# Composition Narrative Digest');
  lines.push('');
  lines.push('> Auto-generated per run by `narrative-digest.js`. A human-readable story of what the system did.');
  const traceGeneratedAt = summary && summary.generatedAt ? summary.generatedAt : 'unknown';
  lines.push('> Generated: ' + new Date().toISOString() + ' | Trace data from: ' + traceGeneratedAt);
  lines.push('');

  // -Overview -
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
    // Read actual musical duration from CSV end_track time
    let musicalDurationSec = '?';
    try {
      for (const csvFile of ['output/output1.csv', 'output/output2.csv']) {
        const csvPath = path.join(ROOT, csvFile);
        if (fs.existsSync(csvPath)) {
          const lastLine = fs.readFileSync(csvPath, 'utf8').trim().split('\n').pop();
          if (lastLine && lastLine.includes('end_track')) {
            const timePart = lastLine.split(',')[1];
            const sec = parseFloat(timePart.replace('s', ''));
            if (Number.isFinite(sec) && sec > toNum(musicalDurationSec, 0)) musicalDurationSec = sec.toFixed(0);
          }
        }
      }
    } catch (_) { /* */ }
    lines.push(`The system processed **${totalBeats} beats** spanning **${musicalDurationSec} seconds** of musical time.`);
    if (summary.beats.byLayer) {
      lines.push(`Layer 1 experienced ${summary.beats.byLayer.L1 || 0} beats; Layer 2 experienced ${summary.beats.byLayer.L2 || 0} beats.`);
    }
    lines.push('');
  }

  // -Harmonic Journey -
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

  // R26 E3: Per-section musical characterization
  if (summary && Array.isArray(summary.sectionStats) && summary.sectionStats.length > 0) {
    lines.push('## Section Character');
    lines.push('');
    const stats = summary.sectionStats;
    const maxTension = Math.max.apply(null, stats.map(function(s) { return s.avgTension; }));
    const minTension = Math.min.apply(null, stats.map(function(s) { return s.avgTension; }));
    for (let si = 0; si < stats.length; si++) {
      const s = stats[si];
      const tensionDesc = s.avgTension >= maxTension - 0.05 ? 'peak tension' :
        s.avgTension <= minTension + 0.05 ? 'lowest tension' :
        s.avgTension > 0.7 ? 'high tension' :
        s.avgTension > 0.5 ? 'moderate tension' : 'relaxed';
      const densityDesc = s.avgDensity > 0.65 ? 'dense' :
        s.avgDensity < 0.4 ? 'sparse' : 'balanced density';
      lines.push(`- **S${s.section}** (${s.beats} beats): ${tensionDesc}, ${densityDesc}, ` +
        `dominant regime \`${s.dominantRegime}\`, playProb ${dec(s.avgPlayProb)}`);
    }
    // Identify arc shape
    const halfIdx = Math.floor(stats.length / 2);
    const firstHalfAvg = stats.slice(0, halfIdx).reduce(function(sum, s) { return sum + s.avgTension; }, 0) / halfIdx;
    const secondHalfAvg = stats.slice(halfIdx).reduce(function(sum, s) { return sum + s.avgTension; }, 0) / (stats.length - halfIdx);
    const arcShape = firstHalfAvg > secondHalfAvg + 0.1 ? 'early-peak with resolution' :
      secondHalfAvg > firstHalfAvg + 0.1 ? 'building to late climax' : 'plateau arc';
    lines.push('');
    lines.push(`**Arc shape:** ${arcShape} (first-half tension ${dec(firstHalfAvg)} vs second-half ${dec(secondHalfAvg)})`);
    lines.push('');
  }

  // -Regime Story -
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
      const causeStr = t.cause && t.cause !== 'organic' ? ` [${t.cause}]` : '';
      lines.push(`- Beat ${t.beat}: transitioned from **${t.from}** to **${t.to}**${causeStr}` +
        ` (${describeRegime(t.from)} to ${describeRegime(t.to)})`);
    }
    lines.push('');
  }

  if (summary && summary.profilerCadence && summary.transitionReadiness) {
    const cadence = summary.profilerCadence;
    const readiness = summary.transitionReadiness;
    const totalTraceEntries = summary.beats && summary.beats.totalEntries ? summary.beats.totalEntries : 0;
    if (cadence.analysisTicks > 0 && totalTraceEntries > cadence.analysisTicks) {
      lines.push('### Controller Cadence');
      lines.push('');
      lines.push(`The emitted trace contains **${totalTraceEntries} beat entries**, but the regime controller advanced on only **${cadence.analysisTicks} ${cadence.cadence || 'analysis'} ticks**.`);
      lines.push(`**${cadence.snapshotReuseEntries}** entries reused an existing profiler snapshot and **${cadence.warmupEntries}** entries landed during warmup.`);
      if (toNum(cadence.escalatedEntries, 0) > 0) {
        lines.push(`Beat-level escalation refreshed the profiler on **${toNum(cadence.escalatedEntries, 0)}** traced entries.`);
      }
      if (readiness.runResolvedRegimeCounts && typeof readiness.runResolvedRegimeCounts === 'object') {
        const resolvedCounts = Object.entries(readiness.runResolvedRegimeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([regime, count]) => `\`${regime}\` ${count}`)
          .join(', ');
        if (resolvedCounts) {
          lines.push(`On the controller cadence, resolved regime time was: ${resolvedCounts}.`);
        }
      }
      const forcedCount = Array.isArray(summary.forcedTransitionEvents) ? summary.forcedTransitionEvents.length : 0;
      lines.push(forcedCount > 0
        ? `The controller recorded **${forcedCount} forced transition event${forcedCount !== 1 ? 's' : ''}**.`
        : 'No forced regime transition fired on the controller cadence.');
      if (summary.cadenceMonopoly && (summary.cadenceMonopoly.active || toNum(summary.cadenceMonopoly.opportunityGap, 0) > 0.08)) {
        const monopoly = summary.cadenceMonopoly;
        lines.push(`The cadence monopoly diagnostic stayed active at **${dec(monopoly.pressure, 3)}**: raw non-coherent opportunity reached **${pct(toNum(monopoly.rawNonCoherentOpportunityShare, 0))}**, but resolved non-coherent share closed at **${pct(toNum(monopoly.resolvedNonCoherentShare, 0))}** (gap **${pct(toNum(monopoly.opportunityGap, 0))}**).`);
        if (monopoly.reason) {
          lines.push(`Dominant monopoly mode: **${monopoly.reason}**.`);
        }
      }
      if (summary.phaseTelemetry) {
        const phaseTelemetry = summary.phaseTelemetry;
        lines.push(`Phase telemetry closed **${phaseTelemetry.integrity}** with **${pct(toNum(phaseTelemetry.validRate, 0))}** valid samples, **${pct(toNum(phaseTelemetry.changedRate, 0))}** changing samples, and average phase-coupling coverage **${pct(toNum(phaseTelemetry.avgCouplingCoverage, 0))}**.`);
        if (phaseTelemetry.maxStaleBeats > 0 || phaseTelemetry.zeroCouplingCoverageEntries > 0 || toNum(phaseTelemetry.staleEntries, 0) > 0) {
          lines.push(`The longest stale phase run was **${phaseTelemetry.maxStaleBeats}** beats, **${toNum(phaseTelemetry.staleEntries, 0)}** entries carried stale pair telemetry, and **${phaseTelemetry.zeroCouplingCoverageEntries}** entries reported zero phase-coupling coverage.`);
        }
        if (phaseTelemetry.pairStateCounts) {
          const available = toNum(phaseTelemetry.pairStateCounts.available, 0);
          const varianceGated = toNum(phaseTelemetry.pairStateCounts['variance-gated'], 0);
          const missing = toNum(phaseTelemetry.pairStateCounts.missing, 0);
          const stale = toNum(phaseTelemetry.pairStateCounts.stale, 0) + toNum(phaseTelemetry.pairStateCounts['stale-gated'], 0);
          lines.push(`Phase-surface availability resolved to **${available} available**, **${varianceGated} variance-gated**, **${stale} stale/stale-gated**, and **${missing} missing** pair observations across the trace.`);
        }
        if (phaseTelemetry.pairStateDetailCounts) {
          const stalePairs = Object.entries(phaseTelemetry.pairStateDetailCounts)
            .map(([pair, counts]) => ({
              pair,
              stale: toNum(counts.stale, 0) + toNum(counts['stale-gated'], 0),
              varianceGated: toNum(counts['variance-gated'], 0)
            }))
            .filter((entry) => entry.stale > 0 || entry.varianceGated > 0)
            .sort((a, b) => {
              if (b.stale !== a.stale) return b.stale - a.stale;
              return b.varianceGated - a.varianceGated;
            })
            .slice(0, 3);
          if (stalePairs.length > 0) {
            lines.push(`The most reconciliation-starved phase pairs were ${stalePairs.map((entry) => `**${entry.pair}** (${entry.stale} stale, ${entry.varianceGated} variance-gated)`).join(', ')}.`);
          }
        }
      } else if (summary.telemetryHealth) {
        lines.push('Phase telemetry was **missing from the trace payload**, so phase-surface diagnostics remain untrusted for this run.');
      }
      if (summary.telemetryHealth) {
        const telemetryHealth = summary.telemetryHealth;
        lines.push(`Telemetry health scored **${dec(toNum(telemetryHealth.score, 0), 3)}** with **${toNum(telemetryHealth.underSeenPairCount, 0)}** under-seen controller pairs and reconciliation gap **${dec(toNum(telemetryHealth.maxGap, 0), 3)}**.`);
        if (summary.adaptiveTelemetryReconciliation && Array.isArray(summary.adaptiveTelemetryReconciliation.pairs) && summary.adaptiveTelemetryReconciliation.pairs.length > 0) {
          const underSeenPairs = summary.adaptiveTelemetryReconciliation.pairs
            .slice(0, 3)
            .map((entry) => `**${entry.pair}** (gap ${dec(toNum(entry.gap, 0), 3)})`)
            .join(', ');
          lines.push(`The worst controller/trace reconciliation gaps remained in ${underSeenPairs}.`);
        }
      }
      if (summary.outputLoadGuard) {
        const outputLoadGuard = summary.outputLoadGuard;
        lines.push(`The output-load governor intervened on **${toNum(outputLoadGuard.guardedEntries, 0)}** entries (${pct(toNum(outputLoadGuard.guardedRate, 0))}), with average guard scale **${dec(toNum(outputLoadGuard.scale && outputLoadGuard.scale.avg, 1), 3)}** and **${toNum(outputLoadGuard.hardGuardEntries, 0)}** hard clamps.`);
      }
      // R58 E6: Guard/coupling interaction diagnostic
      if (summary.guardCouplingInteraction) {
        const gci = summary.guardCouplingInteraction;
        const delta = toNum(gci.exceedanceDelta, 0);
        const absDelta = Math.abs(delta);
        if (gci.guardedBeats > 0 && gci.unguardedBeats > 0 && absDelta > 0.03) {
          const direction = delta > 0 ? 'higher' : 'lower';
          lines.push(`Guard/coupling interaction: guarded beats had ${direction} exceedance rate (${pct(toNum(gci.guardedExceedanceRate, 0))}) vs unguarded (${pct(toNum(gci.unguardedExceedanceRate, 0))}), delta **${dec(absDelta, 3)}**.`);
        }
      }
      lines.push('');
    }
  }

  // -Conductor Signals -
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

  if (summary && summary.beatSetupBudget && summary.beatSetupBudget.exceededCount > 0) {
    const budget = summary.beatSetupBudget;
    lines.push('## Performance');
    lines.push('');
    lines.push(`Beat setup exceeded the **${budget.thresholdMs}ms** budget on **${budget.exceededCount}** beats ` +
      `(${pct(budget.exceededRate)} of the run).`);
    if (budget.worstSpike) {
      lines.push(`The worst spike landed at beat ${budget.worstSpike.index} with **${dec(budget.worstSpike.ms)}ms**, ` +
        `dominated by **${budget.worstSpike.dominantSubstage}** (${dec(budget.worstSpike.dominantSubstageMs)}ms).`);
    }
    if (Array.isArray(budget.topSubstages) && budget.topSubstages.length > 0) {
      lines.push('The most common spike drivers were:');
      lines.push('');
      for (const stage of budget.topSubstages.slice(0, 3)) {
        lines.push(`- **${stage.stage}**: ${stage.count} spikes (avg ${dec(stage.avgMs)}ms, peak ${dec(stage.maxMs)}ms)`);
      }
      lines.push('');
    }
  }

  // -Trust Governance -
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

  // -Coupling Health -
  if (summary && summary.couplingAbs) {
    lines.push('## Pipeline Coupling');
    lines.push('');

    const pairs = Object.entries(summary.couplingAbs)
      .map(([pair, stat]) => ({ pair, avg: toNum(stat.avg, 0), max: toNum(stat.max, 0) }))
      .sort((a, b) => b.avg - a.avg);
    const hotspotPairs = Array.isArray(summary.couplingHotspots)
      ? summary.couplingHotspots
        .map((p) => ({ pair: p.pair, p95: toNum(p.p95, 0), avg: toNum(p.avg, 0) }))
        .sort((a, b) => b.p95 - a.p95)
      : [];

    if (pairs.length > 0) {
      const highCoupling = pairs.filter(p => p.avg > 0.5);
      if (highCoupling.length > 0) {
        lines.push('The decorrelation engine flagged elevated coupling in:');
        lines.push('');
        for (const p of highCoupling) {
          lines.push(`- **${p.pair}**: avg |r| = ${dec(p.avg, 3)}, peak |r| = ${dec(p.max, 3)}`);
        }
        lines.push('');
      } else if (hotspotPairs.length > 0) {
        lines.push('Average pairwise decorrelation stayed controlled, but the tail still carried residual hotspot pressure.');
        lines.push('');
      } else if (summary.exceedanceComposite && toNum(summary.exceedanceComposite.totalPairExceedanceBeats, 0) > 0) {
        lines.push('Average pairwise decorrelation stayed controlled, but transient exceedance beats still appeared and should not be described as fully healthy.');
        lines.push('');
      } else {
        lines.push('All compositional dimension pairs maintained healthy decorrelation levels in both average and tail behavior.');
        lines.push('');
      }

      // R52 E5: Use p95 tail telemetry instead of beat-local maxima.
      const hotspots = hotspotPairs;
      if (hotspots.length === 0) {
        lines.push('**Coupling health:** All pairs within normal bounds (p95 < 0.70).');
        lines.push('');
      } else {
        const stress = hotspots.length <= 2 ? 'manageable' : hotspots.length <= 5 ? 'elevated' : 'stressed';
        lines.push(`**Coupling health:** ${hotspots.length} hotspot pair${hotspots.length !== 1 ? 's' : ''} (p95 > 0.70) -- system ${stress}.`);
        const severe = hotspots.filter(p => p.p95 > 0.85);
        if (severe.length > 0) {
          lines.push('Severe (p95 > 0.85): ' + severe.map(p => `**${p.pair}** (${dec(p.p95, 3)})`).join(', ') + '.');
        }
        lines.push('');
      }
    }
  }

  // R26 E2: Aggregate coupling labels in narrative
  if (summary && summary.aggregateCouplingLabels && typeof summary.aggregateCouplingLabels === 'object') {
    const aggLabels = Object.entries(summary.aggregateCouplingLabels);
    if (aggLabels.length > 0) {
      lines.push('## Coupling Semantics (whole-run)');
      lines.push('');
      lines.push('The following coupling relationships characterized this composition:');
      lines.push('');
      for (const [pair, label] of aggLabels) {
        const corr = summary.couplingCorrelation && summary.couplingCorrelation[pair];
        const meanStr = corr ? ` (mean r=${dec(corr.meanSigned, 3)})` : '';
        const trajStr = corr && corr.trajectory && corr.trajectory !== 'sustained' ? `, ${corr.trajectory}` : '';
        lines.push(`- **${pair}**: ${label}${meanStr}${trajStr}`);
      }
      lines.push('');
    }
  }

  // -Output Summary -
  {
    const csv1 = path.join(COMPOSITION_DIR, 'output1.csv');
    const csv2 = path.join(COMPOSITION_DIR, 'output2.csv');
    const countNotes = (csvPath) => {
      if (!fs.existsSync(csvPath)) return 0;
      let count = 0;
      for (const line of fs.readFileSync(csvPath, 'utf8').split(/\r?\n/)) {
        const cols = line.split(',');
        if (cols.length >= 6 && cols[2] && cols[2].trim() === 'note_on_c' && toNum(cols[5], 0) > 0) count++;
      }
      return count;
    };
    const n1 = countNotes(csv1);
    const n2 = countNotes(csv2);
    if (n1 > 0 || n2 > 0) {
      const totalNotes = n1 + n2;
      const uniqueBeatKeys = summary && summary.beats ? toNum(summary.beats.uniqueBeatKeys, 0) : 0;
      const spanMs = summary && summary.beats ? toNum(summary.beats.spanMs, 0) : 0;
      lines.push('## Output');
      lines.push('');
      lines.push(`- **Layer 1:** ${n1} notes`);
      lines.push(`- **Layer 2:** ${n2} notes`);
      if (uniqueBeatKeys > 0) {
        lines.push(`- **Load:** ${totalNotes} total notes, ${dec(totalNotes / uniqueBeatKeys, 2)} notes per traced beat${spanMs > 0 ? `, ${dec(totalNotes / (spanMs / 1000), 2)} notes per second` : ''}`);
      } else {
        lines.push(`- **Load:** ${totalNotes} total notes`);
      }
      lines.push('');
    }
  }

  // -Coherence Verdicts -
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

  // -Closing -
  lines.push('');
  lines.push('');
  lines.push('*This narrative was generated automatically from composition telemetry. ' +
    'For raw data, see `trace.jsonl`, `trace-summary.json`, and `system-manifest.json`.*');
  lines.push('');

  return lines.join('\n');
}

// -Main -

function main() {
  const summary = loadJSON(SUMMARY_PATH);
  if (!summary) {
    console.log('narrative-digest: trace-summary.json not found, skipping.');
    return;
  }

  const narrative = generateNarrative();
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.writeFileSync(DIGEST_PATH, narrative, 'utf8');

  console.log('narrative-digest: composition story generated -> metrics/narrative-digest.md');
}

main();
