# Trust Ecology

27 cross-layer systems compete for influence through EMA-weighted trust scores. The trust landscape creates emergent "personality" as dominant systems shape the composition's character.

## Trust Scoring

Each system's trust score is an EMA (exponential moving average) of payoff outcomes registered per-beat in `crossLayerBeatRecord`. Scores range [-1, 1] with practical range [0.1, 0.7].

**Weight formula**: `1 + score * 0.75` (range ~0.85-1.55). Higher trust = more influence on negotiation outcomes, stutter probability, and density gating.

### Payoff Registration

`adaptiveTrustScores.registerOutcome(systemName, payoff)` called per-beat. Payoff is a [-1, 1] value computed from whether the system's contribution improved the current beat's quality (convergence alignment, coherence, spectral balance, etc.).

### Score Dynamics

- **Exploration nudge**: when score drops below 0.10, small positive injection (0.03/cycle) prevents permanent death
- **Decay floor**: scores cannot drop below 0.05
- **Trust ceiling**: capped system-specifically (e.g., stutterContagion capped at 0.55)
- **CIM coordination scale**: modulates exploration nudge (independent = more nudge, coordinated = less)

## 27 Trust-Scored Systems

Top 3 consistently: motifEcho (~0.67), temporalGravity (~0.67), harmonicIntervalGuard (~0.66)

Bottom 3 consistently: convergence (~0.26), texturalMirror (~0.27), roleSwap (~0.27)

Full list: motifEcho, temporalGravity, harmonicIntervalGuard, convergenceHarmonicTrigger, articulationComplement, crossLayerSilhouette, dynamicEnvelope, coherenceMonitor, grooveTransfer, rhythmicComplement, phaseLock, climaxEngine, velocityInterference, restSynchronizer, stutterContagion, spectralComplementarity, entropyRegulator, registerCollisionAvoider, verticalIntervalMonitor, polyrhythmicPhasePredictor, feedbackOscillator, cadenceAlignment, roleSwap, emergentDownbeat, phaseAwareCadenceWindow, convergence, texturalMirror

### Notable System Behaviors

**motifEcho** — highest trust system (avg weight 1.48, score 0.69). Creates fugue-like imitative counterpoint: captures motifs from L1, injects transformed versions (retrograde, inversion, augmentation) into L2. Consistently #1 in 6/7 sections. Only yields to phaseLock during atmospheric resolution.

**feedbackOscillator** — chronically lowest score (avg 0.32) with highest hotspot rate (31%). Creates round-trip rhythmic impulses between layers with damping=0.55. EMA floor prevents weight collapse. Performs well in high-tension sections, badly in atmospheric.

**stutterContagion** — largest score swing of any system (0.22-0.70). Regime-dependent: surges during coherent (stable rhythms for prediction), collapses during exploring (unpredictable patterns). In 50/50 rivalry with phaseLock (116 overtakes/run).

**coherenceMonitor** — systematic weight decline across sections (S0 1.45 → S6 1.25). Performs well when coherent regime dominates, deteriorates when exploring takes over. Largest single-beat weight drop of any system (Δ0.79).

**roleSwap** — collapses in explosive sections (Δ-0.26 S3→S4) because tension valleys trigger excessive profile swaps. Trust inflation in S4-S6 (weight > 1.1 despite score < 0.31).

## Trust Starvation Auto-Nourishment (#5)

When a system's trust velocity stagnates for >70-100 beats (regime-dependent), synthetic positive payoff is injected:
- `syntheticPayoff = clamp(gapFromMean * effectiveStrength, 0, 0.10)`
- Nourishment strength decays 10% per application (prevents inflation)
- Minimum strength floor: 0.05
- Hysteresis: engage at velocity < 0.001, disengage at velocity > 0.003 after 50 beats

Emits to `explainabilityBus` with systemName, syntheticPayoff, gap, newScore.

## Trust Ecology Character

`src/crossLayer/structure/trust/trustEcologyCharacter.js` tracks dominant trust system and biases composer family weights:

| Dominant System | Favored Family | Boost |
|----------------|---------------|-------|
| stutterContagion | rhythmicDrive | 1.5x |
| harmonicIntervalGuard | diatonicCore | 1.5x |
| convergenceHarmonicTrigger | harmonicMotion | 1.5x |
| motifEcho | development | 1.5x |
| temporalGravity | tonalExploration | 1.5x |

Updated per-beat in `crossLayerBeatRecord`. Applied via `factoryFamilies.js` during composer pool resolution.

## Trust-Driven Timbral Mapping

`src/crossLayer/structure/trust/trustTimbreMapping.js` maps trust dominance to GM instrument pools:

- convergenceHarmonicTrigger -> pads [89, 92, 97, 98]
- stutterContagion -> percussive [9, 12, 13, 14]
- harmonicIntervalGuard -> keys [0, 4, 6, 11]
- motifEcho -> strings [48, 49, 50, 51]
- temporalGravity -> synth [79, 89, 104, 112]

Applied with 10-second cooldown via `suggest(absoluteSeconds)`, wired into `setOtherInstruments()`. Regime-driven reflection pool also applies (coherent=pads, exploring=synths, evolving=strings) at 35% probability.

## Section Memory Trend Bias

Previous section's energy trend (rising/falling/steady) biases current section's composer families:

- Rising -> development 1.4x, harmonicMotion 1.3x, rhythmicDrive 1.2x
- Falling -> diatonicCore 1.5x, tonalExploration 1.3x
- Steady -> minimal bias

Wired in `factoryFamilies.js` alongside trustEcologyCharacter bias.
