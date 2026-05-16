// lab/sketches.js - Tier 3 remaining: conductor intelligence frontiers.
// Each sketch creates AUDIBLE musical behavior from predictive awareness.
//
// Every sketch MUST declare a patches: [] array listing globals monkey-patched
// in postBoot(). Empty array is valid for sketches that only call setters.
// Enforced by lab/run.js at sketch-load time.

module.exports = [

  // METAPROFILE A/B: Run atmospheric for first half, switch to chaotic at midpoint.
  // Validates: hot-switching, regime distribution shift, coupling ceiling scaling,
  // trust ecology reconfiguration, CIM independence bias. Listen for the pivot.
  {
    name: 'metaprofile-atmospheric-to-chaotic',
    patches: ['conductorConfig.applyPhaseProfile'],
    overrides: {
      SECTIONS: { min: 6, max: 6 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      metaProfiles.setActive('atmospheric');
      console.log('Lab: metaprofile=atmospheric (sections 0-2), chaotic (sections 3-5)');

      const origApply = conductorConfig.applyPhaseProfile;
      conductorConfig.applyPhaseProfile = function(opts) {
        if (sectionIndex === 3) {
          metaProfiles.setActive('chaotic');
          console.log('Lab: PIVOT → metaprofile=chaotic at section 3');
        }
        return origApply.call(conductorConfig, opts);
      };
    }
  },

  // METAPROFILE MEDITATIVE: Full run with meditative profile.
  // Validates: high coherence target, low density, tight flicker, locked phases.
  {
    name: 'metaprofile-meditative',
    patches: [],
    overrides: {
      SECTIONS: { min: 5, max: 5 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      metaProfiles.setActive('meditative');
      console.log('Lab: metaprofile=meditative (full run)');
    }
  },

  // METAPROFILE VOLATILE: Maximum exploring, independent layers, sharp tension.
  {
    name: 'metaprofile-volatile',
    patches: [],
    overrides: {
      SECTIONS: { min: 5, max: 5 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      metaProfiles.setActive('volatile');
      console.log('Lab: metaprofile=volatile (full run)');
    }
  },

  // METAPROFILE ELEGIAC: Coherent + descending tension across the run.
  // Validates: the new 'descending' tension shape produces a release/denouement
  // arc — tension should start near ceiling (0.55) and trend toward floor (0.20)
  // across sections. Listen for the falling pressure curve.
  {
    name: 'metaprofile-elegiac',
    patches: [],
    overrides: {
      SECTIONS: { min: 5, max: 5 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      metaProfiles.setActive('elegiac');
      console.log('Lab: metaprofile=elegiac (full run, descending tension)');
    }
  },

  // METAPROFILE ANTHEMIC: High coherent + high coupling + arch tension.
  // Validates: the locked-step shared-peak character. Different from `tense`
  // (competitive) and `chaotic` (volatile peak) — listen for synchronized
  // crescendo with high concentration in trust ecology (incumbents dominate
  // the climax).
  {
    name: 'metaprofile-anthemic',
    patches: [],
    overrides: {
      SECTIONS: { min: 5, max: 5 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      metaProfiles.setActive('anthemic');
      console.log('Lab: metaprofile=anthemic (full run, arch tension + locked phases)');
    }
  },

  {
    // REGIME EXIT FORECAST: track velocity trend across last 8 beats. When
    // velocity predicts regime exit in ~4 beats, pre-adapt stutter density
    // and play probability. Coherent exit -> boost stutter (anticipatory
    // nervousness). Exploring exit -> calm stutter (approaching settlement).
    // The system HEARS its own regime transitions coming.
    name: 'regime-exit-forecast',
    patches: ['playNotesEmitPick'],
    overrides: {
      SECTIONS: { min: 5, max: 5 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      conductorConfig.setActiveProfile('atmospheric');
      const velocityHistory = [];
      const origEmitPick = playNotesEmitPick;
      playNotesEmitPick = function(opts) {
        const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
        const velocity = snap ? snap.velocity : 0;
        velocityHistory.push(velocity);
        if (velocityHistory.length > 8) velocityHistory.shift();
        // Predict regime exit: rising velocity in coherent = exit coming
        if (velocityHistory.length >= 4) {
          const recent = velocityHistory.slice(-4);
          const slope = (recent[3] - recent[0]) / 3;
          const regime = snap ? snap.regime : 'evolving';
          if (regime === 'coherent' && slope > 0.02) {
            // Coherent exit predicted: anticipatory stutter boost
            const adjusted = Object.assign({}, opts, {
              resolvedStutterProb: clamp((opts.resolvedStutterProb || 0.3) * (1 + slope * 8), 0, 0.95)
            });
            return origEmitPick(adjusted);
          }
          if (regime === 'exploring' && slope < -0.015) {
            // Exploring exit predicted: calming, reduce stutter
            const adjusted = Object.assign({}, opts, {
              resolvedStutterProb: clamp((opts.resolvedStutterProb || 0.3) * (1 - m.abs(slope) * 5), 0.05, 0.95)
            });
            return origEmitPick(adjusted);
          }
        }
        return origEmitPick(opts);
      };
    }
  },

  {
    // COUPLING DECAY PREDICTOR: track coupling strength trend over 12 beats.
    // When coupling is decaying rapidly, boost convergenceTarget via L0 to
    // prevent phase collapse. When coupling is building, relax convergence
    // to let organic growth continue. Self-stabilizing coupling awareness.
    name: 'coupling-decay-predictor',
    patches: ['playNotesEmitPick'],
    overrides: {
      SECTIONS: { min: 4, max: 4 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      conductorConfig.setActiveProfile('atmospheric');
      const couplingHistory = [];
      const origEmitPick = playNotesEmitPick;
      playNotesEmitPick = function(opts) {
        const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
        const coupling = snap ? snap.couplingStrength : 0.3;
        couplingHistory.push(coupling);
        if (couplingHistory.length > 12) couplingHistory.shift();
        if (couplingHistory.length >= 6) {
          const firstHalf = couplingHistory.slice(0, 3).reduce((a, b) => a + b) / 3;
          const secondHalf = couplingHistory.slice(-3).reduce((a, b) => a + b) / 3;
          const trend = secondHalf - firstHalf;
          // Rapid decay: boost convergence to prevent collapse
          if (trend < -0.05) {
            L0.post('section-quality', 'both', beatStartTime, {
              quality: 0.3, bias: clamp(m.abs(trend) * 0.5, 0, 0.10)
            });
          }
        }
        return origEmitPick(opts);
      };
    }
  },

  {
    // DIMENSIONALITY COLLAPSE RESPONSE: when effective dimensionality drops
    // below 2.5, inject register spread and entropy boost to re-diversify
    // the phase space. When dimensionality is high (>4), tighten register
    // and reduce entropy for focused expression. The system adapts its
    // musical palette width to match its dimensional complexity.
    name: 'dimensionality-response',
    patches: ['playNotesEmitPick'],
    overrides: {
      SECTIONS: { min: 4, max: 4 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      conductorConfig.setActiveProfile('atmospheric');
      const origEmitPick = playNotesEmitPick;
      playNotesEmitPick = function(opts) {
        const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
        const effDim = snap ? snap.effectiveDimensionality : 3;
        if (effDim < 2.5) {
          // Collapsed dimensionality: widen palette
          const collapseDepth = clamp((2.5 - effDim) / 1.5, 0, 1);
          const adjusted = Object.assign({}, opts, {
            resolvedRegisterBias: (opts.resolvedRegisterBias || 0) + collapseDepth * 4,
            resolvedVelocity: m.max(30, m.round((opts.resolvedVelocity || 80) * (1 + collapseDepth * 0.15)))
          });
          return origEmitPick(adjusted);
        }
        if (effDim > 4.0) {
          // High dimensionality: focus expression
          const focusDepth = clamp((effDim - 4.0) / 2.0, 0, 1);
          const adjusted = Object.assign({}, opts, {
            resolvedRegisterBias: (opts.resolvedRegisterBias || 0) - focusDepth * 2
          });
          return origEmitPick(adjusted);
        }
        return origEmitPick(opts);
      };
    }
  },

  {
    // TRUST VELOCITY ANTICIPATION: when a system's trust is rapidly changing
    // (velocity > 0.01/beat), pre-adapt the corresponding musical parameter.
    // motifEcho trust rising -> boost motif echo probability. stutterContagion
    // trust falling -> reduce contagion decay. The system anticipates its own
    // trust ecology shifts and leans into them.
    name: 'trust-velocity-anticipation',
    patches: ['playNotesEmitPick'],
    overrides: {
      SECTIONS: { min: 4, max: 4 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      conductorConfig.setActiveProfile('atmospheric');
      let lastMotifTrust = 1.0;
      let lastStutterTrust = 1.0;
      const origEmitPick = playNotesEmitPick;
      playNotesEmitPick = function(opts) {
        const motifTrust = safePreBoot.call(
          () => adaptiveTrustScores.getWeight(trustSystems.names.MOTIF_ECHO), 1.0
        );
        const stutterTrust = safePreBoot.call(
          () => adaptiveTrustScores.getWeight(trustSystems.names.STUTTER_CONTAGION), 1.0
        );
        const mt = Number.isFinite(motifTrust) ? motifTrust : 1.0;
        const st = Number.isFinite(stutterTrust) ? stutterTrust : 1.0;
        const motifVelocity = mt - lastMotifTrust;
        const stutterVelocity = st - lastStutterTrust;
        lastMotifTrust = mt;
        lastStutterTrust = st;
        // Motif trust rising rapidly -> lean into echo-friendly register
        if (motifVelocity > 0.01) {
          const adjusted = Object.assign({}, opts, {
            resolvedRegisterBias: (opts.resolvedRegisterBias || 0) + motifVelocity * 20
          });
          return origEmitPick(adjusted);
        }
        // Stutter trust dropping -> reduce stutter to let it recover
        if (stutterVelocity < -0.01) {
          const adjusted = Object.assign({}, opts, {
            resolvedStutterProb: clamp((opts.resolvedStutterProb || 0.3) * 0.7, 0, 0.95)
          });
          return origEmitPick(adjusted);
        }
        return origEmitPick(opts);
      };
    }
  },

  {
    // FORGE: convergenceHarmonicTrigger <-> verticalIntervalMonitor (r=-0.626, 3rd bridge)
    // densitySurprise as antagonist signal: surprise events trigger MORE harmonic changes
    // (convergenceHarmonicTrigger) AND tighten collision penalty (verticalIntervalMonitor).
    // Same signal → opposite structural effects: harmonic richness + harmonic discipline.
    name: 'forge-convergenceHarmonicTrigger-verticalIntervalMonitor',
    patches: ['convergenceHarmonicTrigger.onConvergence', 'verticalIntervalMonitor.process'],
    overrides: {
      SECTIONS: { min: 4, max: 4 },
      PHRASES_PER_SECTION: { min: 3, max: 3 }
    },
    postBoot() {
      // Patch convergenceHarmonicTrigger: densitySurprise boosts event rarity
      // → flows into triggerChance = BASE * (0.5 + rarity*0.5) * ... → more triggers during surprise
      const origOnConvergence = convergenceHarmonicTrigger.onConvergence;
      convergenceHarmonicTrigger.onConvergence = function(event) {
        const rhythmEntry = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
        const ds = rhythmEntry && Number.isFinite(rhythmEntry.densitySurprise) ? rhythmEntry.densitySurprise : 1.0;
        const boostedEvent = (ds !== 1.0)
          ? Object.assign({}, event, { rarity: clamp((event.rarity || 0.5) * clamp(ds, 0.7, 1.5), 0, 1) })
          : event;
        return origOnConvergence.call(this, boostedEvent);
      };

      // Patch verticalIntervalMonitor: densitySurprise tightens collision penalty (antagonist direction)
      // result is negative (penalty), multiplying > 1 makes it more negative → stricter
      const origProcess = verticalIntervalMonitor.process;
      verticalIntervalMonitor.process = function(absoluteSeconds, layer) {
        const result = origProcess.call(this, absoluteSeconds, layer);
        if (result === 0) return 0;
        const rhythmEntry = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
        const ds = rhythmEntry && Number.isFinite(rhythmEntry.densitySurprise) ? rhythmEntry.densitySurprise : 1.0;
        const penaltyScale = ds > 1.1 ? 1.15 : ds < 0.9 ? 0.88 : 1.0;
        return result * penaltyScale;
      };
    }
  },

];
