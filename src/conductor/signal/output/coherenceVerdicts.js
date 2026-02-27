// coherenceVerdicts.js - Auto-diagnose coherence state from manifest data.
// Examines signal health, dynamics, attribution, trust, and coupling
// to produce actionable severity-graded verdicts. Pure computation -
// reads structured data, returns verdicts. No side effects.

coherenceVerdicts = (() => {

  /**
   * Compute coherence verdicts from a fully-built manifest.
   * @param {object} manifest - The manifest object from _buildManifest()
   * @param {{ density: object, tension: object, flicker: object }} attribution
   * @returns {Array<{ severity: string, area: string, finding: string }>}
   */
  function compute(manifest, attribution) {
    /** @type {Array<{ severity: string, area: string, finding: string }>} */
    const verdicts = [];

    _checkPipelineHealth(manifest, verdicts);
    _checkDynamicsRegime(manifest, verdicts);
    _checkCoupling(manifest, verdicts);
    _checkTrustEcosystem(manifest, verdicts);
    _checkAttributionExtremes(attribution, verdicts);
    _checkCoherenceMonitorFloor(attribution, verdicts);
    _checkStaleContributors(attribution, verdicts);

    // Sort by severity: critical > warning > info
    const order = { critical: 0, warning: 1, info: 2 };
    verdicts.sort((a, b) => (order[a.severity] || 3) - (order[b.severity] || 3));

    return verdicts;
  }

  /** Check each pipeline's health grade and crush factor. */
  function _checkPipelineHealth(manifest, verdicts) {
    const sh = manifest.signalHealth;
    if (!sh || !sh.lastHealth) return;

    const pipelines = ['density', 'tension', 'flicker'];
    for (let i = 0; i < pipelines.length; i++) {
      const p = pipelines[i];
      const h = sh.lastHealth[p];
      if (!h) continue;

      if (h.grade === 'critical') {
        verdicts.push({ severity: 'critical', area: 'pipeline', finding: `${p} pipeline critical - product ${h.product.toFixed(4)}, crush factor ${(h.crushFactor * 100).toFixed(0)}%.` });
      } else if (h.grade === 'stressed') {
        verdicts.push({ severity: 'warning', area: 'pipeline', finding: `${p} pipeline stressed - crush factor ${(h.crushFactor * 100).toFixed(0)}%.` });
      } else if (h.grade === 'strained' && h.crushFactor > 0.4) {
        verdicts.push({ severity: 'warning', area: 'pipeline', finding: `${p} pipeline strained with ${(h.crushFactor * 100).toFixed(0)}% crush - multiplicative suppression eroding signal range.` });
      }

      if (h.saturated) {
        verdicts.push({ severity: 'critical', area: 'pipeline', finding: `${p} pipeline saturated - product hitting floor/ceiling.` });
      }
    }

    // Overall assessment
    const sr = sh.saturationRate || {};
    const saturatedPipelines = Object.entries(sr).filter(([, r]) => r > 0.2);
    if (saturatedPipelines.length > 0) {
      const names = saturatedPipelines.map(([p, r]) => `${p} (${(r * 100).toFixed(0)}%)`).join(', ');
      verdicts.push({ severity: 'warning', area: 'pipeline', finding: `Pipelines hitting floor/ceiling frequently: ${names}.` });
    }
  }

  /** Check dynamics regime for compositional health. */
  function _checkDynamicsRegime(manifest, verdicts) {
    const sd = manifest.systemDynamics;
    if (!sd || !sd.snapshot) return;
    const s = sd.snapshot;

    if (s.regime === 'stagnant') {
      verdicts.push({ severity: 'critical', area: 'dynamics', finding: `Regime stagnant (velocity ${s.velocity}) - system stuck in attractor. Signal getters may be producing near-constant values.` });
    } else if (s.regime === 'oscillating' && s.curvature > 0.5) {
      verdicts.push({ severity: 'warning', area: 'dynamics', finding: `Regime oscillating with high curvature (${s.curvature.toFixed(3)}) - pendulum reversals rather than forward evolution. Look for bias getters that flip between two states.` });
    } else if (s.regime === 'fragmented') {
      verdicts.push({ severity: 'warning', area: 'dynamics', finding: `Regime fragmented - dimensions acting independently without coordination.` });
    } else if (s.regime === 'evolving' || s.regime === 'exploring' || s.regime === 'coherent') {
      verdicts.push({ severity: 'info', area: 'dynamics', finding: `Regime ${s.regime} - healthy compositional development.` });
    }

    if (s.effectiveDimensionality < 1.5) {
      verdicts.push({ severity: 'warning', area: 'dynamics', finding: `Effective dimensionality collapsed to ${s.effectiveDimensionality.toFixed(2)}/4 - system operating on fewer than 1.5 independent compositional axes. Severe variance imbalance or strong coupling.` });
    } else if (s.effectiveDimensionality < 2.0) {
      verdicts.push({ severity: 'info', area: 'dynamics', finding: `Effective dimensionality ${s.effectiveDimensionality.toFixed(2)}/4 - mild variance imbalance across compositional axes. Normal for short sections or pieces with a dominant signal.` });
    }

    if (s.velocity < 0.01 && s.regime !== 'stagnant') {
      verdicts.push({ severity: 'warning', area: 'dynamics', finding: `Very low velocity (${s.velocity}) despite non-stagnant regime - near stasis.` });
    }
  }

  /** Check cross-dimensional coupling for concerning correlations. */
  function _checkCoupling(manifest, verdicts) {
    const sd = manifest.systemDynamics;
    if (!sd || !sd.snapshot || !sd.snapshot.couplingMatrix) return;

    const matrix = sd.snapshot.couplingMatrix;

    // Only report correlations between compositional dimensions (density,
    // tension, flicker, entropy). Trust and phase are governance/position
    // signals excluded from velocity/curvature/dimensionality by the profiler.
    // Reporting trust-X or phase-X coupling as warnings creates false positives
    // - those correlations are structurally expected, not actionable.
    const compositionalPairs = Object.entries(matrix)
      .filter(([pair]) => !pair.includes('trust') && !pair.includes('phase'))
      .filter(([, v]) => m.abs(v) > 0.5)
      .sort((a, b) => m.abs(b[1]) - m.abs(a[1]));

    for (let i = 0; i < compositionalPairs.length; i++) {
      const [pair, corr] = compositionalPairs[i];
      const direction = corr > 0 ? 'co-evolving' : 'anti-correlated';
      const severity = m.abs(corr) > 0.7 ? 'warning' : 'info';
      verdicts.push({ severity, area: 'coupling', finding: `${pair} strongly ${direction} (r=${corr.toFixed(3)}) - these dimensions may be driven by a shared input or feedback loop.` });
    }

    // Governance coupling reported as info-only for diagnostic completeness
    const governancePairs = Object.entries(matrix)
      .filter(([pair]) => pair.includes('trust') || pair.includes('phase'))
      .filter(([, v]) => m.abs(v) > 0.5)
      .sort((a, b) => m.abs(b[1]) - m.abs(a[1]));

    for (let i = 0; i < governancePairs.length; i++) {
      const [pair, corr] = governancePairs[i];
      const direction = corr > 0 ? 'co-evolving' : 'anti-correlated';
      verdicts.push({ severity: 'info', area: 'coupling', finding: `${pair} strongly ${direction} (r=${corr.toFixed(3)}) - governance coupling (expected, not actionable).` });
    }
  }

  /** Check trust ecosystem for starvation or anomalies. */
  function _checkTrustEcosystem(manifest, verdicts) {
    const trust = manifest.trustScoresEndOfRun;
    if (!trust || typeof trust !== 'object') return;

    const entries = Object.entries(trust);
    for (let i = 0; i < entries.length; i++) {
      const [name, data] = entries[i];
      if (!data || typeof data.score !== 'number') continue;

      if (data.score < 0.03) {
        verdicts.push({ severity: 'warning', area: 'trust', finding: `${name} trust score near zero (${data.score.toFixed(3)}) - system effectively disabled by trust governance.` });
      } else if (data.score > 0.8) {
        verdicts.push({ severity: 'info', area: 'trust', finding: `${name} trust very high (${data.score.toFixed(3)}) - weight ${data.weight.toFixed(3)} may be amplifying this system disproportionately.` });
      }
    }

    const sh = manifest.signalHealth;
    if (sh && sh.lastHealth && sh.lastHealth.trust && sh.lastHealth.trust.grade === 'strained') {
      verdicts.push({ severity: 'warning', area: 'trust', finding: 'Trust ecosystem strained - some systems starving while others thrive.' });
    }
  }

  /**
   * Check attribution tables for modules at extreme values.
   * Detects floor/ceiling pinning and near-constant modules.
   */
  function _checkAttributionExtremes(attribution, verdicts) {
    if (!attribution) return;
    const tables = [
      { name: 'density', data: attribution.density },
      { name: 'tension', data: attribution.tension },
      { name: 'flicker', data: attribution.flicker }
    ];

    for (let i = 0; i < tables.length; i++) {
      const { name: pipeline, data } = tables[i];
      if (!data || !data.contributions) continue;

      for (let j = 0; j < data.contributions.length; j++) {
        const c = data.contributions[j];
        // Detect modules where raw !== clamped (being clipped)
        if (c.raw !== c.clamped) {
          verdicts.push({ severity: 'warning', area: 'attribution', finding: `${c.name} ${pipeline} bias clipped: raw ${c.raw.toFixed(4)} - clamped ${c.clamped.toFixed(4)}. Module exceeding its registered range.` });
        }
        // Detect modules stuck at exact floor/ceiling values (0.6000, 0.8000, etc.)
        // that suggest permanent pinning rather than dynamic response
        if (c.clamped === 0.6 && c.name === 'coherenceMonitor') {
          verdicts.push({ severity: 'info', area: 'attribution', finding: `coherenceMonitor density bias locked at floor (0.60) - system consistently emitting more notes than intended, suppressing density by 40%.` });
        }
      }

      // Check if product is floored or capped
      if (data.floored) {
        verdicts.push({ severity: 'warning', area: 'attribution', finding: `${pipeline} product soft-floored at ${data.product.toFixed(4)} (raw ${data.rawProduct.toFixed(4)}) - soft envelope compressing low product.` });
      }
      if (data.capped) {
        verdicts.push({ severity: 'warning', area: 'attribution', finding: `${pipeline} product soft-capped at ${data.product.toFixed(4)} (raw ${data.rawProduct.toFixed(4)}) - soft envelope compressing high product.` });
      }
    }
  }

  /** Special check for coherenceMonitor permanent floor state. */
  function _checkCoherenceMonitorFloor(attribution, verdicts) {
    if (!attribution || !attribution.density || !attribution.density.contributions) return;
    const cm = attribution.density.contributions.find(c => c.name === 'coherenceMonitor');
    if (!cm) return;
    // Already handled in _checkAttributionExtremes - but check if it's the
    // single largest density suppressor
    const sorted = attribution.density.contributions
      .filter(c => c.clamped < 1.0)
      .sort((a, b) => a.clamped - b.clamped);
    if (sorted.length > 0 && sorted[0].name === 'coherenceMonitor') {
      const suppressionPct = ((1 - sorted[0].clamped) * 100).toFixed(0);
      verdicts.push({ severity: 'warning', area: 'density', finding: `coherenceMonitor is the single largest density suppressor (${suppressionPct}% reduction) - the system's density floor may be structurally depressed.` });
    }
  }

  /**
   * Detect stale contributors: modules providing near-constant drag or boost.
   * When a module's clamped value is far from 1.0 (>5% deviation), it may be
   * stuck at a boundary. End-of-run snapshot only captures the final state,
   * but persistent boundary values indicate chronic static drag.
   */
  function _checkStaleContributors(attribution, verdicts) {
    if (!attribution) return;
    const STALE_THRESHOLD = 0.08; // >8% deviation from neutral (was 5% - too many false positives)
    const tables = [
      { name: 'density', data: attribution.density },
      { name: 'tension', data: attribution.tension },
      { name: 'flicker', data: attribution.flicker }
    ];

    for (let t = 0; t < tables.length; t++) {
      const { name: pipeline, data } = tables[t];
      if (!data || !data.contributions) continue;

      const stale = [];
      for (let j = 0; j < data.contributions.length; j++) {
        const c = data.contributions[j];
        const dev = m.abs(c.clamped - 1.0);
        // Stale: significant deviation AND raw equals clamped (not being clipped,
        // so the module itself is returning a boundary-like constant)
        if (dev > STALE_THRESHOLD && c.raw === c.clamped) {
          stale.push({ name: c.name, value: c.clamped });
        }
      }

      if (stale.length >= 7) {
        const names = stale.map(s => `${s.name} (${s.value.toFixed(2)})`).join(', ');
        const direction = stale.filter(s => s.value < 1.0).length > stale.length / 2 ? 'suppressing' : 'boosting';
        verdicts.push({
          severity: 'warning',
          area: 'attribution',
          finding: `${stale.length} ${pipeline} contributors ${direction} with constant drag: ${names}. Consider widening registration bounds or adding dynamic response.`
        });
      }
    }
  }

  return { compute };
})();
