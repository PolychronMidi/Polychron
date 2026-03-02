# Tuning Map - Feedback Loop Constants

> Cartography of the ~30 most critical numeric constants governing the four
> feedback loops and the trust system. Every constant below has at least one
> interaction partner - changing one in isolation **will** shift the system's
> emergent behavior.

---

## 1. Density Correction - `coherenceMonitor`

Compares actual vs intended note output. Feeds a correction bias back into
the density product so the system listens to its own song.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| `SMOOTHING` | 0.55 | EMA factor for `coherenceBias` - higher = slower adaptation | `BIAS_FLOOR/CEILING`, `phaseGain` |
| `BIAS_FLOOR` | 0.60 | Min density correction multiplier | `SMOOTHING`, conductorConfig density range |
| `BIAS_CEILING` | 1.3 | Max density correction multiplier | `SMOOTHING`, profileAdaptation restrained hint |
| `WINDOW_SIZE` | 16 | Rolling observation window (beats) | `decayFactor`, entropy variance calc |
| `ENTROPY_DECAY` | 0.92 | Exponential decay for entropy signal | `rawEntropy` offset/scale, entropyRegulator strength |
| `phaseGain` bell | 0.25 + 0.3·sin(π·phraseProgress) | Correction strength peaks mid-phrase (0.55), drops at edges (0.25) | `SMOOTHING`, attribution spread boost |
| `decayFactor` | 0.5 | Phrase-boundary decay for window entries - prevents stale data from dominating | `WINDOW_SIZE` |
| `rawEntropy` offset | 0.04 | Variance baseline subtracted before scaling | `ENTROPY_DECAY`, scale factor 2 |
| Attribution spread boost | 1.0 + clamp(spread - 0.25, 0, 0.5) | When density biases disagree (spread > 0.25), correction gets up to 50% stronger | `phaseGain`, `SMOOTHING` |

**Sensitivity:** `SMOOTHING` is the single most impactful constant - current value 0.55 provides responsive correction with moderate oscillation risk. Raising above 0.85 makes correction sluggish; lowering below 0.4 causes visible density oscillation. `BIAS_CEILING` must stay below the negotiation `playScale` upper clamp (1.8) to avoid runaway density gain.

---

## 2. Entropy Steering - `entropyRegulator`

Measures combined pitch/velocity/rhythmic entropy. Steers cross-layer
systems toward a target curve driven by section position.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| `SMOOTHING` | 0.3 | EMA factor for smoothed entropy | Pitch/velocity/rhythm weights |
| `WINDOW_NOTES` | 10 | Max note history per layer (halved for faster turnover) | Pitch entropy uniqueness calc |
| Pitch weight | 0.4 | Contribution of pitch diversity to combined entropy | Velocity weight (0.3), rhythm weight (0.3) |
| Velocity weight | 0.3 | Contribution of velocity variance to combined entropy | Pitch weight, rhythm weight |
| Rhythm weight | 0.3 | Contribution of rhythmic irregularity | Pitch weight, velocity weight, rhythm divisor (2) |
| Arc floor | 0.2 | Minimum target entropy from section-shape arc | Arc amplitude (0.6) - range is [0.2, 0.8] |
| Arc amplitude | 0.6 | Bell curve amplitude: 0.2 + 0.6·sin(π·progress) | Arc floor, section length |
| Arc-intent blend | 0.3 / 0.7 | 30% section arc, 70% sectionIntentCurves target | sectionIntentCurves.entropyTarget |
| PID gain | 2.0 | Proportional response: scale = 1 + error·strength·2 | `regulationStrength`, scale clamp |
| Scale clamp | [0.3, 2.0] | Min/max regulation scale - prevents extinction or explosion | PID gain, negotiation entropy modulation |

**Sensitivity:** The 0.3/0.7 arc-intent blend is a critical mixing ratio. Raising arc weight above 0.5 makes section shape dominate, reducing intent responsiveness. The PID gain of 2 is aggressive - lowering to 1.5 yields smoother but slower correction.

---

## 3. Sustained-Condition Hints - `profileAdaptation`

Watches for sustained low-density / high-tension / flat-flicker streaks.
Produces advisory hints consumed by `conductorConfig`.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| `DENSITY_LOW_THRESHOLD` | 0.55 | Density below this increments low-density streak | `STREAK_TRIGGER`, coherenceMonitor bias |
| `TENSION_HIGH_THRESHOLD` | 1.4 | Tension above this increments high-tension streak | `STREAK_TRIGGER`, negotiation conflict threshold |
| `FLICKER_FLAT_THRESHOLD` | 1.05 | Flicker within 0.05 of 1.0 counts as flat | `STREAK_TRIGGER` |
| `STREAK_TRIGGER` | 6 | Beats before a hint activates | Hint ramp divisor, conductorConfig consumption |
| Trend mods (density) | 0.75 rising / 1.25 falling | Streak increment varies with signal telemetry trend | signalTelemetry.getTrend() |
| Trend mods (tension) | 1.25 rising / 0.75 falling | Tension trend amplifies/dampens streak | signalTelemetry.getTrend() |
| Hint ramp divisor | 8 | Beats past trigger before hint reaches 1.0: `(streak − trigger) / 8` | `STREAK_TRIGGER`, conductorConfig phase profiles |

**Sensitivity:** `STREAK_TRIGGER` = 6 at default tempo (72 BPM) means ~5 seconds of sustained condition before hints activate. The ramp divisor of 8 means full hint intensity at streak = 14 (~12 sec). Lowering `STREAK_TRIGGER` below 4 risks false positives from momentary lulls.

---

## 4. Negotiation - `negotiationEngine`

Integrates trust scores, entropy regulation, and intent targets to produce
final `playProb` / `stutterProb` values.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| Play scale formula | (0.75 + density·0.45) * (0.9 + trust·0.08) | Computes play probability scale from intent + trust | `playScale` clamp, adaptiveTrustScores |
| `playScale` clamp | [0.4, 1.8] | Prevents play probability extinction or saturation | coherenceMonitor `BIAS_CEILING` (1.3) |
| stutter scale formula | (0.6 + interaction·0.75) * (0.85 + trust·0.1) | Computes stutter scale from interaction target + trust | `stutterScale` clamp |
| `stutterScale` clamp | [0.25, 2.2] | Wider range than play - stutter is more exploratory | Play scale clamp |
| Entropy play modulator | 0.7 + entropy·0.3, clamp [0.5, 1.5] | Entropy regulation adjusts play probability | entropyRegulator scale output |
| Entropy stutter modulator | 0.75 + entropy·0.25, clamp [0.5, 1.5] | Entropy regulation adjusts stutter probability | entropyRegulator scale output |
| Conflict threshold | 0.8 | Trust conflict above this triggers dampening | adaptiveTrustScores conflict detection |
| Play conflict dampen | 0.92 | 8% play reduction during high conflict | Conflict threshold |
| stutter conflict dampen | 0.9 | 10% stutter reduction during high conflict | Conflict threshold |
| Cadence gate: phase | ≥ 0.45 | Min phase confidence for cadence allowance | phaseAwareCadenceWindow confidence |
| Cadence gate: trust | ≥ 0.7 | Min cadence trust weight for cadence allowance | adaptiveTrustScores weight |

**Sensitivity:** The play scale clamp [0.4, 1.8] is the single most important range in the system. If `BIAS_CEILING` (1.3) * `playScale` max (1.8) were to compound, density could exceed 2.3×. The cadence gate thresholds (0.45/0.7) determine how often cadences fire - lowering them increases cadence frequency dramatically.

---

## 5. Trust Governance - `adaptiveTrustScores`

EMA-based trust weights per cross-layer module. Payoff table defined in
`MAIN_LOOP_CONTROLS.trustPayoffs`. All trust system names are canonical
constants defined in `trustSystems` (`src/utils/trustSystems.js`) — 9 scored
systems in `trustSystems.names`, 13 heat-map systems in
`trustSystems.heatMapSystems`. Never hardcode trust name strings.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| EMA decay | 0.9 | Weight on previous score: `score = score·0.9 + payoff·0.1` | Weight formula, payoff clamp |
| EMA new-data | 0.1 | Weight on new payoff observation | EMA decay |
| Score clamp | [−1, 1] | Trust score range | Weight formula |
| Weight formula | 1 + score * 0.75 | Converts score to multiplicative weight | Weight clamp |
| Weight clamp | [0.4, 1.8] | Same range as negotiation play scale - by design | negotiationEngine play scale clamp |
| Default decay rate | 0.01 | Per-call decay toward neutral when no observations | Score clamp, EMA factors |

**Sensitivity:** The weight multiplier 0.75 means a score of 1.0 yields weight 1.75, and score −0.8 yields weight 0.4 (floor). The EMA rate 0.9/0.1 means ~10 observations to converge halfway. Lowering to 0.8/0.2 doubles learning speed but risks oscillation.

---

## 6. Breathing & Probability Adjust - `processBeat`

Final probability adjustments applied in the `probability-adjust` pipeline stage.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| Complement fill urgency | 0.3 | `playProb *= (1 + fillUrgency * 0.3)` - max 30% boost | restSynchronizer complementary rest |
| Breathing decrease: play | 0.96 | 4% play reduction on heat-map breathing decrease | interactionHeatMap heat level |
| Breathing decrease: stutter | 0.94 | 6% stutter reduction on decrease | interactionHeatMap heat level |
| Breathing increase: play | 1.03 | 3% play boost on breathing increase | interactionHeatMap heat level |
| Breathing increase: stutter | 1.04 | 4% stutter boost on increase | interactionHeatMap heat level |

---

## Cross-Constant Invariants

These relationships must hold to prevent runaway behavior:

1. **Density ceiling chain:** `coherenceMonitor.BIAS_CEILING` (1.3) * `negotiationEngine.playScale` max (1.8) = 2.34. This is the theoretical maximum density amplification. The floor chain: `BIAS_FLOOR` (0.60) * `playScale` min (0.4) = 0.24. Exceeding ~2.5 on the ceiling causes audible note-cramming.

2. **Trust-weight symmetry:** `adaptiveTrustScores.weight` clamp [0.4, 1.8] matches `negotiationEngine.playScale` clamp [0.4, 1.8]. This ensures trust cannot push play probability outside the negotiation's own range.

3. **Entropy regulation headroom:** `entropyRegulator.scale` clamp [0.3, 2.0] * negotiation entropy modulator [0.5, 1.5] gives effective range [0.15, 3.0]. The negotiation's own clamps prevent this from manifesting fully.

4. **Streak - hint timing:** At 72 BPM, `STREAK_TRIGGER` = 6 ≈ 5 seconds. Full hint (`ramp / 8`) at 14 beats ≈ 12 seconds. Section lengths are typically 16-64 beats, so hints activate within one section.

5. **Coherence monitor responsiveness:** `coherenceMonitor.SMOOTHING` (0.55) means correction responds within ~2 beats (half-life). At `BIAS_FLOOR` 0.60, correction can reduce density by up to 40%. The `check-tuning-invariants.js` script validates all cross-constant invariants automatically on every run.

6. **Coupling tail regime scaling:** `check-manifest-health.js` applies the same regime scale factors to coupling tail p90 and exceedance thresholds as to the coupling matrix gate. Exploring regime relaxes thresholds by 10% (x1.10), coherent tightens by 5% (x0.95). This prevents transient sectional coupling spikes from failing the health gate during exploratory behavior.
