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

## 7. Pipeline Coupling Management - `pipelineCouplingManager`

Self-tuning decorrelation engine for all 15 compositional dimension pairs.
Nudges density/tension/flicker biases to reduce inter-signal correlation.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| `DEFAULT_TARGET` | 0.25 | Default coupling target for any pair | Per-pair overrides in `PAIR_TARGETS` |
| `GAIN_INIT` | 0.16 | Starting gain for new pairs | `GAIN_MIN`, `GAIN_MAX`, effectiveness gate |
| `GAIN_MIN` | 0.08 | Minimum gain floor | `GAIN_INIT` |
| `GAIN_MAX` | 0.60 | Maximum gain ceiling | `GAIN_INIT`, density-flicker scale, product guards |
| `GAIN_ESCALATE_RATE` | 0.02 | Per-beat gain increase when stuck | `GAIN_EMERGENCY_RATE`, effectiveness gate, floor dampening |
| `GAIN_EMERGENCY_RATE` | 0.06 | 3x escalation when \|r\| > 2x target | `GAIN_ESCALATE_RATE` |
| `GAIN_RELAX_RATE` | 0.02 | Per-beat gain decrease when resolved | Entropy pair 2x multiplier |
| `_TARGET_ADAPT_EMA` | 0.02 | ~50-beat horizon for rolling \|r\| | Entropy pair 2.5x multiplier |
| `_TARGET_RELAX_RATE` | 0.0015 | Per-beat target relaxation (intractable) | `_TARGET_TIGHTEN_RATE` |
| `_TARGET_TIGHTEN_RATE` | 0.0015 | Per-beat target tightening (resolved) | Density product sigmoid scalar |
| `_AXIS_BUDGET` | 0.24 | Per-axis gain budget cap (#9 hypermeta) | Product guards, axis coupling ceiling |
| Effectiveness gate threshold | 0.50 | Pairs below this get rate *= max(0.25, eff/0.50) | `GAIN_INIT`, gain ceiling cap |
| Effectiveness gain ceiling | eff < 0.40 | Cap = GAIN_INIT + (MAX-INIT) * max(0.40, eff) | `GAIN_MAX`, `GAIN_INIT` |
| Flicker product guard | hysteresis 0.90/0.96 | 'guarding' state caps flicker-pair gains at 0.45 | `_FLICKER_PAIR_GAIN_CAP`, flicker product |
| Density product guard | hysteresis 0.75/0.82 | 'guarding' state caps density-pair gains at 0.45 | `_DENSITY_PAIR_GAIN_CAP`, density product |
| Severe bypass | \|r\| > 2x target | Bypasses coherence gate for severely overcoupled pairs | Coherence gate values |
| Transition spike dampener | R33: velocity-based | Boosts effective gain when coupling velocity spikes | `_VELOCITY_EMA_ALPHA`, `_VELOCITY_TRIGGER_RATIO` |
| `_VELOCITY_EMA_ALPHA` | 0.08 | ~12-beat horizon for coupling velocity EMA | `_VELOCITY_TRIGGER_RATIO` |
| `_VELOCITY_TRIGGER_RATIO` | 2.0 | Boost when instantaneous velocity > 2x EMA | `_VELOCITY_EMA_ALPHA` |
| `_VELOCITY_BOOST_BEATS` | 3 | Cooldown beats after velocity spike trigger | `_VELOCITY_GAIN_BOOST` |
| `_VELOCITY_GAIN_BOOST` | 2.0 | Effective gain multiplier during velocity boost | `_VELOCITY_BOOST_BEATS` |
| Per-pair effectiveness temporal | min/max/activeBeats | R33 E5: Tracks effectiveness range across active beats | `effectivenessEma` |
| Heat-penalty cooldown threshold | 0.30 | R34 E5: Above this hp, rate scaled by max(0.35, 1-hp) | `heatPenalty`, escalation rate |
| Heat-penalty cooldown floor | 0.35 | R34 E5: Minimum rate multiplier at hp=1.0 | Heat-penalty cooldown threshold |
| `_AXIS_SMOOTH_ALPHA` | 0.15 | R34 E2: ~7-beat EMA horizon for axis coupling totals | `getAxisCouplingTotals()`, axis energy share |
| Phase-pair gain cap | 0.35 when \|r\| > 0.85 | R35 E3: Caps phase-pair max gain when correlation severe | Phase EMA rescue enabled sustained phase coupling |

**Sensitivity:** `GAIN_ESCALATE_RATE` (0.02) and `_globalGainMultiplier` (controlled by homeostasis) together determine effective escalation speed. The effectiveness gate (R32 E1) reduces rate for low-eff pairs to max 25% of normal. Floor dampening (from homeostasis) is multiplicative and can suppress 75%+ of all escalation. Product guards cap gains at 0.45 when pipeline products are severely compressed. R33 velocity-based spike dampener detects the spike beat itself (not the beat after), providing preemptive 2x gain boost for 4 beats total (trigger + 3 cooldown). R34 E2: Axis coupling totals are now returned as a running EMA (alpha=0.15) rather than per-beat snapshots, preventing phase axis collapse when phase pair correlations are intermittently null. Internal gain scaling still uses raw per-beat values. R34 E5: Heat-penalty escalation cooldown adds a second throttle layer: when hp > 0.30, the gain escalation rate is scaled by max(0.35, 1.0 - hp), creating graduated suppression that prevents density-flicker oscillation cycles from persisting.

---

## 8. Axis Energy Equilibrator - `axisEnergyEquilibrator` (#13)

Two-layer self-correcting controller. Layer 1 detects pair-level hotspots.
Layer 2 balances axis-level energy shares. Interacts with #1 (targets),
#9 (gain budget), #12 (homeostasis).

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| `_HOTSPOT_RATIO` | 2.0 | Pair hot when raw > 2.0x baseline | `_HOTSPOT_ABS_MIN`, Layer 1 tighten |
| `_HOTSPOT_ABS_MIN` | 0.25 | Ignore hotspot unless raw crosses this floor | `_HOTSPOT_RATIO` |
| `_COLDSPOT_RATIO` | 0.3 | Pair cold when raw < 0.3x baseline | `_COLDSPOT_ABS_MAX` |
| `_COLDSPOT_ABS_MAX` | 0.10 | Only relax if raw below this cap | `_COLDSPOT_RATIO` |
| `_PAIR_TIGHTEN_RATE` | 0.004 | Per-beat baseline tightening for hot pairs | `tightenScale` (graduated gate), giniMult |
| `_PAIR_RELAX_RATE` | 0.002 | Per-beat baseline relaxation for cold pairs | N/A |
| `_PAIR_COOLDOWN` | 3 | Beats before a pair can be readjusted (Layer 1) | `_AXIS_COOLDOWN` |
| `_AXIS_OVERSHOOT` | 0.22 | Axis share above this triggers tightening | `_FAIR_SHARE` (0.167) |
| `_AXIS_UNDERSHOOT` | 0.12 | Axis share below this triggers relaxation | `_FAIR_SHARE` |
| `_AXIS_TIGHTEN_RATE` | 0.002 | Per-beat tightening rate for overshoot axes | `tightenScale`, giniMult, pairScale |
| `_AXIS_RELAX_RATE` | 0.0012 | Per-beat relaxation rate for undershoot axes | `pairScale` (E2 nudgeable scaling) |
| `_AXIS_COOLDOWN` | 4 | Beats before axis pairs can be readjusted | `_PAIR_COOLDOWN` |
| `_SHARE_EMA_ALPHA` | 0.08 | ~12-beat horizon for smoothed axis shares | Raw shares from coupling manager |
| `_GINI_ESCALATION` | 0.40 | Gini above this → 1.5x rate multiplier | axisGini from coupling manager |
| `_EFFECTIVE_NUDGEABLE` | d/t/f=5, e/tr/ph=3 | Nudgeable pair count per axis | `_RELAX_RATE_REF` |
| `_RELAX_RATE_REF` | 5 | Reference count for rate scaling | Relaxation scaling = 5/count |
| Graduated coherent gate | evolving=0.6, coherent=0.0, exploring=1.5 | `tightenScale` multiplier for Layer 1+2 | regimeClassifier.getLastRegime() |

**Sensitivity:** The graduated coherent gate is the most critical interaction. R35 E4: Evolving tightenScale raised from 0.4 to 0.6 to compensate for exploring absence (R34: 0% exploring, tighten budget collapsed 35→14). R34 E4: Exploring 1.5x amplification. It prevents tightening from destabilizing coherent regime (0.0 during coherent) while allowing partial correction during evolving (0.4). The `_AXIS_OVERSHOOT`/`_UNDERSHOOT` thresholds (0.22/0.12) with fair share at 0.167 create a +/-33% deadband. `_RELAX_RATE_REF` scaling gives trust/entropy/phase 1.67x faster undershoot relaxation to compensate for fewer nudgeable pairs. R33 E2: Symmetric tighten-rate scaling applies the same `_EFFECTIVE_NUDGEABLE` / `_RELAX_RATE_REF` ratio to the overshoot tightening path. Entropy/trust/phase axes now tighten 1.67x faster (matching relaxation), preventing asymmetric response where overshoot persists because tightening is slower than relaxation.

---

## 9. Coupling Homeostasis - `couplingHomeostasis` (#12)

Global coupling energy governance. Tracks total energy, detects
redistribution, controls gain multiplier and floor dampening.

| Constant | Value | Role | Interaction Partners |
|---|---|---|---|
| `_GAIN_FLOOR` | 0.20 | Minimum global gain multiplier | `_globalGainMultiplier` in coupling manager |
| `_GINI_THRESHOLD` | 0.40 | Gini above this triggers redistribution detection | Pair-level Gini coefficient |
| `_REDIST_RELATIVE_THRESHOLD` | 0.008 | Redistribution detection: \|deltaEma\| < 0.008 AND turbulence > 0.008 | `pairTurbulenceEma` |
| Floor dampen window | 0.35 | `totalEnergy / floor` mapped to [min, 1.0] over [1.0, 1+window] | `_totalEnergyFloor`, floor dampen min |
| Floor dampen min | 0.20 | Minimum floor dampening value (base) | Floor dampen window, chronic decay |
| `_CHRONIC_DAMPEN_THRESHOLD` | 20 | Consecutive sub-0.50 beats before decay | `_CHRONIC_FLOOR_RELAX_RATE` |
| `_CHRONIC_FLOOR_RELAX_RATE` | 0.005 | Per-beat floor downward nudge during decay | `_CHRONIC_DAMPEN_THRESHOLD` |
| `_CHRONIC_FLOOR_RELAX_CAP` | 0.60 | Max effective floor dampen during chronic decay | Floor dampen min |
| `_totalEnergyFloor` | asymmetric tracking | Rises fast when energy drops (alpha=0.04), falls slowly when energy rises (alpha=0.005) | `totalEnergyEma`, `floorDampen` |
| Proportional control | Kp in [0.5, 2.0] | Multiplier adjustment: `target / max(totalEnergy, 0.1)` | `energyBudget`, `totalEnergyEma` |

**Sensitivity:** Floor dampening is the dominant throttle mechanism. When `totalEnergyEma` is close to `_totalEnergyFloor` (ratio < 1.35), `floorDampen` drops below 0.50, suppressing >50% of all gain escalation. The asymmetric floor tracking (fast up 0.04, slow down 0.005) means the floor quickly captures energy minima but very slowly releases them -- this can create chronic dampening lock. R33 E3 chronic decay breaks this lock: after 20 consecutive sub-0.50 beats, the floor is nudged downward (0.5%/beat) and the effective minimum rises toward 0.60 (0.01/beat). The floor never drops below 60% of EMA, maintaining minimum 40% suppression. Any energy surge that raises rawDampen above 0.50 resets the counter.

---

## Cross-Constant Invariants

These relationships must hold to prevent runaway behavior:

1. **Density ceiling chain:** `coherenceMonitor.BIAS_CEILING` (1.3) * `negotiationEngine.playScale` max (1.8) = 2.34. This is the theoretical maximum density amplification. The floor chain: `BIAS_FLOOR` (0.60) * `playScale` min (0.4) = 0.24. Exceeding ~2.5 on the ceiling causes audible note-cramming.

2. **Trust-weight symmetry:** `adaptiveTrustScores.weight` clamp [0.4, 1.8] matches `negotiationEngine.playScale` clamp [0.4, 1.8]. This ensures trust cannot push play probability outside the negotiation's own range.

3. **Entropy regulation headroom:** `entropyRegulator.scale` clamp [0.3, 2.0] * negotiation entropy modulator [0.5, 1.5] gives effective range [0.15, 3.0]. The negotiation's own clamps prevent this from manifesting fully.

4. **Streak - hint timing:** At 72 BPM, `STREAK_TRIGGER` = 6 ≈ 5 seconds. Full hint (`ramp / 8`) at 14 beats ≈ 12 seconds. Section lengths are typically 16-64 beats, so hints activate within one section.

5. **Coherence monitor responsiveness:** `coherenceMonitor.SMOOTHING` (0.55) means correction responds within ~2 beats (half-life). At `BIAS_FLOOR` 0.60, correction can reduce density by up to 40%. The `check-tuning-invariants.js` script validates all cross-constant invariants automatically on every run.

6. **Coupling tail regime scaling:** `check-manifest-health.js` applies the same regime scale factors to coupling tail p90 and exceedance thresholds as to the coupling matrix gate. Exploring regime relaxes thresholds by 10% (x1.10), coherent tightens by 5% (x0.95). This prevents transient sectional coupling spikes from failing the health gate during exploratory behavior.

7. **Equilibrator–homeostasis interaction:** The axis energy equilibrator (#13) tightens pair baselines (reducing targets), which increases gain escalation in the coupling manager, which increases total coupling energy, which triggers homeostasis (#12) to throttle `_globalGainMultiplier`. The throttled multiplier slows gain escalation, reducing tightening effectiveness. This creates a negative feedback loop: aggressive equilibrator tightening is self-limiting via homeostasis dampening. Floor dampening compounds this: when `floorDampen` < 0.50, equilibrator tightening produces <50% of intended decorrelation.

8. **Effectiveness–gain ceiling chain:** When `effectivenessEma` < 0.40, the gain ceiling cap limits max gain to `GAIN_INIT + (GAIN_MAX - GAIN_INIT) * max(0.40, eff)` with floor at `GAIN_INIT * 1.5 = 0.24`. This means low-effectiveness pairs cannot exceed gain 0.24-0.34 (depending on eff), far below `GAIN_MAX` (0.60). The freed budget is available to responsive pairs whose effectiveness > 0.50.

9. **Graduated gate–axis balance tradeoff:** Coherent gate (0.0 during coherent) freezes all equilibrator tightening. Long coherent phases (>100 beats) can cause axis imbalance (axisGini increase) because no rebalancing occurs. The evolving gate (0.4x) provides partial correction. System health requires coherent % < 50% to maintain axis balance; the regime self-balancer targets 15-35% coherent to ensure sufficient non-coherent beats for equilibrator operation.

10. **Coherent entry convergence (R35 E1):** `coherentThresholdScale` starts at 0.75 (was 0.90) with `_REGIME_SCALE_NUDGE` of 0.006/beat (was 0.004). Floor lowered to 0.55 (was 0.70). At 282 beats, scale can drop from 0.75 to 0.55 in ~33 beats after the EMA triggers nudging at ~beat 12. This produces baseCoherentThreshold of `0.30 * 0.85 * 0.55 = 0.14` which with evolving proximity bonus (0.07) yields effective threshold of 0.07. Exploring velocity threshold lowered to 0.015 (R35 E2) to prevent the velocity dead-zone that trapped R34 in 100% evolving.
