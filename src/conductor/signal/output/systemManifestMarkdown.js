// systemManifestMarkdown.js - Markdown renderer for capability-matrix.md.
// Extracted from systemManifest.js. Pure formatting - no side effects, no I/O.

systemManifestMarkdown = (() => {
  const V = validator.create('systemManifestMarkdown');

  /**
   * Build a Markdown capability matrix from the manifest data.
   * @param {object} manifest
   * @param {{ density: object, tension: object, flicker: object }} attribution
   * @returns {string}
   */
  function build(manifest, attribution) {
    const lines = [];
    lines.push('# Module Capability Matrix');
    lines.push('');
    lines.push('> Auto-generated per run by `systemManifest.js`. Do not edit by hand.');
    lines.push(`> Generated: ${manifest.timestamp}`);
    lines.push('');

    systemManifestMarkdownAppendConductorModules(lines, manifest, attribution);
    systemManifestMarkdownAppendCrossLayerModules(lines, manifest);
    systemManifestMarkdownAppendJourney(lines, manifest);
    systemManifestMarkdownAppendTrustScores(lines, manifest);
    systemManifestMarkdownAppendConfig(lines, manifest);
    systemManifestMarkdownAppendSignalHealth(lines, manifest);
    systemManifestMarkdownAppendSystemDynamics(lines, manifest);
    systemManifestMarkdownAppendCoherenceVerdicts(lines, manifest);

    return lines.join('\n');
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendConductorModules(lines, manifest, attribution) {
    lines.push('## Conductor Intelligence Modules');
    lines.push('');
    lines.push(`Total lifecycle-registered: **${manifest.registries.conductorIntelligence.moduleCount}** | Total signal contributors: **${manifest.registries.conductorIntelligence.contributorNames.length}**`);
    lines.push('');
    lines.push('Contribution counts:');
    const counts = manifest.registries.conductorIntelligence.contributions;
    lines.push(`- Density biases: ${counts.density}`);
    lines.push(`- Tension biases: ${counts.tension}`);
    lines.push(`- Flicker modifiers: ${counts.flicker}`);
    lines.push(`- Recorders: ${counts.recorders}`);
    lines.push(`- State providers: ${counts.stateProviders}`);
    lines.push('');

    systemManifestMarkdownAppendAttributionTable(lines, 'Density Bias', attribution.density);
    systemManifestMarkdownAppendAttributionTable(lines, 'Tension Bias', attribution.tension);
    systemManifestMarkdownAppendAttributionTable(lines, 'Flicker Modifier', attribution.flicker);

    lines.push('### Lifecycle-Registered Module Names');
    lines.push('');
    lines.push('| # | Module Name |');
    lines.push('|||');
    manifest.registries.conductorIntelligence.moduleNames.forEach((name, i) => {
      lines.push(`| ${i + 1} | ${name} |`);
    });
    lines.push('');

    const unreg = manifest.registries.conductorIntelligence.unregisteredContributors;
    if (unreg.length > 0) {
      lines.push('### Signal Contributors Without Lifecycle Registration');
      lines.push('');
      lines.push('> These modules provide density/tension/flicker/recorder/stateProvider contributions');
      lines.push('> but are stateless or beatCache-only - no section reset needed.');
      lines.push('');
      lines.push('| # | Module Name |');
      lines.push('|||');
      unreg.forEach((name, i) => {
        lines.push(`| ${i + 1} | ${name} |`);
      });
      lines.push('');
    }
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendCrossLayerModules(lines, manifest) {
    lines.push('## Cross-Layer Modules');
    lines.push('');
    lines.push(`Total registered: **${manifest.registries.crossLayer.moduleCount}**`);
    lines.push('');
    lines.push('| # | Module Name |');
    lines.push('|||');
    manifest.registries.crossLayer.moduleNames.forEach((name, i) => {
      lines.push(`| ${i + 1} | ${name} |`);
    });
    lines.push('');
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendJourney(lines, manifest) {
    if (manifest.journey.length === 0) return;
    lines.push('## Harmonic Journey');
    lines.push('');
    lines.push('| Section | Key | Mode | Move | Distance |');
    lines.push('||||||');
    manifest.journey.forEach(stop => {
      lines.push(`| ${stop.section} | ${stop.key} | ${stop.mode} | ${stop.move} | ${stop.distance} |`);
    });
    lines.push('');
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendTrustScores(lines, manifest) {
    const trustEntries = Object.entries(manifest.trustScoresEndOfRun);
    if (trustEntries.length === 0) return;
    lines.push('## Trust Scores (End of Run)');
    lines.push('');
    lines.push('| System | Score | Weight | Samples |');
    lines.push('|||||');
    trustEntries.forEach(([name, data]) => {
      if (data && typeof data === 'object') {
        const score = typeof data.score === 'number' ? data.score.toFixed(3) : '?';
        const weight = typeof data.weight === 'number' ? data.weight.toFixed(3) : '?';
        const samples = typeof data.samples === 'number' ? data.samples : '?';
        lines.push(`| ${name} | ${score} | ${weight} | ${samples} |`);
      }
    });
    lines.push('');
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendConfig(lines, manifest) {
    lines.push('## Config Summary');
    lines.push('');
    lines.push(`- BPM: ${manifest.config.BPM}`);
    lines.push(`- PPQ: ${manifest.config.PPQ}`);
    lines.push(`- Tuning: ${manifest.config.TUNING_FREQ} Hz`);
    lines.push(`- Total Sections: ${manifest.config.totalSections}`);
    lines.push(`- Active Profile: ${manifest.config.activeProfile}`);
    lines.push('');
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendAttributionTable(lines, title, attr) {
    lines.push(`### ${title} Attribution (end-of-run snapshot)`);
    lines.push('');
    const flooredNote = (attr.floored && attr.rawProduct !== undefined) ? ` (floored from ${attr.rawProduct.toFixed(4)})` : '';
    const cappedNote = (attr.capped && attr.rawProduct !== undefined) ? ` (capped from ${attr.rawProduct.toFixed(4)})` : '';
    lines.push(`Product: **${attr.product.toFixed(4)}**${flooredNote}${cappedNote}`);
    lines.push('');
    if (attr.contributions.length > 0) {
      lines.push('| Module | Raw | Clamped |');
      lines.push('||||');
      attr.contributions.forEach(c => {
        lines.push(`| ${c.name} | ${c.raw.toFixed(4)} | ${c.clamped.toFixed(4)} |`);
      });
    }
    lines.push('');
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendSignalHealth(lines, manifest) {
    const sh = manifest.signalHealth;
    if (!sh || !sh.lastHealth) return;

    lines.push('## Signal Health Report');
    lines.push('');
    lines.push(`> Overall: **${sh.lastHealth.overall || 'unknown'}** | Beats analyzed: ${V.optionalFinite(sh.beatsAnalyzed, 0)}`);
    lines.push('');

    lines.push('### Pipeline Health');
    lines.push('');
    lines.push('| Pipeline | Grade | Product | Crush Factor | Saturated | Pinned Rate |');
    lines.push('|||||||');
    const pipelines = ['density', 'tension', 'flicker'];
    for (let i = 0; i < pipelines.length; i++) {
      const p = pipelines[i];
      const h = sh.lastHealth[p];
      const pr = sh.pinnedRate ? sh.pinnedRate[p] : 0;
      const sr = sh.saturationRate ? sh.saturationRate[p] : undefined;
      if (h) {
        const productStr = typeof h.product === 'number' ? h.product.toFixed(4) : '?';
        const crushStr = typeof h.crushFactor === 'number' ? (h.crushFactor * 100).toFixed(0) + '%' : '?';
        const satStr = typeof h.saturated === 'boolean' ? (h.saturated ? 'YES' : 'no') : (sr !== undefined ? (sr > 0.5 ? 'frequent' : 'no') : '-');
        const pinnedStr = typeof pr === 'number' ? (pr * 100).toFixed(0) + '%' : '?';
        lines.push(`| ${p} | ${h.grade || '?'} | ${productStr} | ${crushStr} | ${satStr} | ${pinnedStr} |`);
      }
    }
    lines.push('');

    const allPinned = [];
    for (let i = 0; i < pipelines.length; i++) {
      const h = sh.lastHealth[pipelines[i]];
      if (h && h.pinnedModules && h.pinnedModules.length > 0) {
        for (let j = 0; j < h.pinnedModules.length; j++) {
          allPinned.push({ module: h.pinnedModules[j], pipeline: pipelines[i] });
        }
      }
    }
    if (allPinned.length > 0) {
      lines.push('### Boundary-Pinned Modules (end-of-run)');
      lines.push('');
      lines.push('> These modules\' raw values exceeded their registered clamp range.');
      lines.push('');
      lines.push('| Module | Pipeline |');
      lines.push('|||');
      allPinned.forEach(p => {
        lines.push(`| ${p.module} | ${p.pipeline} |`);
      });
      lines.push('');
    }

    const trust = sh.lastHealth.trust;
    if (trust) {
      lines.push('### Trust Ecosystem Health');
      lines.push('');
      lines.push(`Grade: **${trust.grade || 'unknown'}**`);
      lines.push('');
      if (trust.starvingSystems && trust.starvingSystems.length > 0) {
        lines.push(`Starving (score < 0.05): ${trust.starvingSystems.join(', ')}`);
        lines.push('');
      }
      if (trust.thrivingSystems && trust.thrivingSystems.length > 0) {
        lines.push(`Thriving (score > 0.40): ${trust.thrivingSystems.join(', ')}`);
        lines.push('');
      }
    }

    if (sh.saturationRate && sh.beatsAnalyzed > 0) {
      const satEntries = Object.entries(sh.saturationRate).filter(([, r]) => r > 0.1);
      if (satEntries.length > 0) {
        lines.push('### Pipeline Saturation Warning');
        lines.push('');
        lines.push('> These pipelines hit their floor/ceiling on a significant fraction of beats.');
        lines.push('');
        satEntries.forEach(([pipeline, rate]) => {
          lines.push(`- **${pipeline}**: saturated on ${(rate * 100).toFixed(0)}% of beats`);
        });
        lines.push('');
      }
    }
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendSystemDynamics(lines, manifest) {
    const sd = manifest.systemDynamics;
    if (!sd || !sd.snapshot || !sd.snapshot.regime) return;

    const s = sd.snapshot;
    lines.push('## System Dynamics Report');
    lines.push('');
    lines.push(`> Phase-space trajectory analysis | Regime: **${s.regime}** | Grade: **${s.grade}** | Beats: ${V.optionalFinite(sd.beatsAnalyzed, 0)}`);
    lines.push('');

    lines.push('### Trajectory Metrics');
    lines.push('');
    lines.push('| Metric | Value | Interpretation |');
    lines.push('||||');
    lines.push(`| Velocity | ${s.velocity} | ${s.velocity < 0.01 ? 'Barely moving - stuck in attractor' : s.velocity < 0.05 ? 'Slow evolution' : 'Active exploration'} |`);
    lines.push(`| Curvature | ${s.curvature} | ${s.curvature < 0.3 ? 'Straight-line drift' : s.curvature < 0.7 ? 'Gentle winding' : 'Frequent reversals'} |`);
    lines.push(`| Effective Dimensionality | ${s.effectiveDimensionality} / ${(Array.isArray(sd.dimensionNames) ? sd.dimensionNames : []).length} | ${s.effectiveDimensionality < 2 ? 'Collapsed to ~1 axis' : s.effectiveDimensionality < 3.5 ? 'Moderate spread' : 'Rich multi-dimensional'} |`);
    lines.push(`| Coupling Strength | ${s.couplingStrength} | ${s.couplingStrength < 0.2 ? 'Dimensions independent' : s.couplingStrength < 0.45 ? 'Moderate coupling' : 'Strong cross-coupling'} |`);
    lines.push('');

    const regimeDescriptions = {
      stagnant: 'System barely moving through state space - compositional stasis.',
      oscillating: 'Frequent direction reversals - pendulum-like behavior rather than true evolution.',
      exploring: 'High velocity + multi-dimensional - actively discovering new territory.',
      coherent: 'Strong cross-coupling - dimensions evolving together as a unified organism.',
      fragmented: 'Weak coupling + many axes - dimensions acting independently without coordination.',
      drifting: 'Slow monotonic change - one-directional evolution without surprise.',
      evolving: 'Moderate dynamic movement - healthy compositional development.',
      initializing: 'Insufficient beats for analysis.'
    };
    const desc = regimeDescriptions[s.regime] || '';
    if (desc) {
      lines.push(`**Regime interpretation:** ${desc}`);
      lines.push('');
    }

    if (s.couplingMatrix && Object.keys(s.couplingMatrix).length > 0) {
      const pairs = Object.entries(s.couplingMatrix)
        .filter(([, v]) => m.abs(v) > 0.25)
        .sort((a, b) => m.abs(b[1]) - m.abs(a[1]));

      if (pairs.length > 0) {
        lines.push('### Cross-Dimensional Coupling (|r| > 0.25)');
        lines.push('');
        lines.push('| Dimension Pair | Correlation | Relationship |');
        lines.push('||||');
        pairs.forEach(([pair, corr]) => {
          const direction = corr > 0 ? 'co-evolving' : 'anti-correlated';
          const strength = m.abs(corr) > 0.7 ? 'strong' : m.abs(corr) > 0.45 ? 'moderate' : 'weak';
          lines.push(`| ${pair} | ${corr.toFixed(3)} | ${strength} ${direction} |`);
        });
        lines.push('');
      }
    }

    if (sd.dimensionNames && sd.dimensionNames.length > 0) {
      lines.push(`> Dimensions: ${sd.dimensionNames.join(', ')}`);
      lines.push('');
    }
  }

  /** @param {string[]} lines */
  function systemManifestMarkdownAppendCoherenceVerdicts(lines, manifest) {
    const verdicts = manifest.coherenceVerdicts;
    if (!verdicts || verdicts.length === 0) return;

    lines.push('## Coherence Verdicts');
    lines.push('');
    lines.push('> Auto-diagnosed findings from signal health, dynamics, attribution, and trust data.');
    lines.push('');

    const criticals = verdicts.filter(v => v.severity === 'critical');
    const warnings = verdicts.filter(v => v.severity === 'warning');
    const infos = verdicts.filter(v => v.severity === 'info');

    if (criticals.length > 0) {
      lines.push('### Critical');
      lines.push('');
      criticals.forEach(v => {
        lines.push(`- **[${v.area}]** ${v.finding}`);
      });
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push('### Warnings');
      lines.push('');
      warnings.forEach(v => {
        lines.push(`- **[${v.area}]** ${v.finding}`);
      });
      lines.push('');
    }

    if (infos.length > 0) {
      lines.push('### Info');
      lines.push('');
      infos.forEach(v => {
        lines.push(`- **[${v.area}]** ${v.finding}`);
      });
      lines.push('');
    }
  }

  return { build };
})();
