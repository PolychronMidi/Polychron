# Hypermeta Self-Calibrating Controllers

19 meta-controllers auto-tune parameters that previously required manual adjustment. Queryable via `metaControllerRegistry.getAll()` / `getById()` / `getByAxis()` / `getInteractors()`.

**Rule:** Never hand-tune constants a meta-controller manages. Modify the controller logic instead. Pipeline script `check-hypermeta-jurisdiction.js` enforces this across 4 phases.

## Controllers

| # | Name | Owner | What it tunes |
--
| 1 | Self-Calibrating Coupling Targets | `pipelineCouplingManager` | Per-pair rolling \|r\| EMA. Intractable pairs relax upward; resolved pairs tighten. |
| 2 | Regime Distribution Equilibrator | `regimeReactiveDamping` | 64-beat rolling histogram. Intent-aware exploring brake (onset 60 ticks, phase-scaled). |
| 3 | Pipeline Product Centroid | `conductorDampening` | 20-beat product EMA. Corrective multiplier (+-25%) counteracts drift. Density/tension only. |
| 4 | Flicker Range Elasticity | `conductorDampening` | 32-beat rolling flicker range. 3x accelerated rate (0.015/beat). |
| 5 | Trust Starvation Auto-Nourishment | `adaptiveTrustScores` | Per-system velocity EMA. Injects synthetic payoff when stagnant 70-100+ beats (regime-dependent). |
| 6 | Adaptive Coherent Relaxation | `pipelineCouplingManager` | Coupling relaxation derived from rolling coherent regime share. |
| 7 | Entropy PI Controller | `systemDynamicsProfiler` | Integral term + adaptive alpha + anti-windup (Ki=0.05, clamp +-3.0). |
| 8 | Progressive Strength Auto-Scaling | `conductorDampening` | Dampening strength from active contributor count. Dimensionality guard: 1.5x when effectiveDim < 2.0. |
| 9 | Coupling Gain Budget Manager | `pipelineCouplingManager` | Per-axis budget cap (0.24, flicker 0.36). |
| 10 | Meta-Observation Telemetry | `conductorDampening` | Per-beat snapshots to explainabilityBus + watchdog feed. |
| 11 | Meta-Controller Interaction Watchdog | `conductorMetaWatchdog` | Detects opposing corrections (>55/100 beats). Attenuates weaker controller 50%. Relaxes +0.1/check. |
| 12 | Coupling Energy Homeostasis | `couplingHomeostasis` | Total \|r\| scalar, redistribution detection, global gain throttle, Gini guard. |
| 13 | Axis Energy Equilibrator | `axisEnergyEquilibrator` | Two-layer: pair hotspot (1.5x baseline) + axis energy balancing (>0.22 or <0.12). Graduated coherent gate. |
| 14 | Phase Energy Floor | `phaseFloorController` | Self-calibrating thresholds from volatility EMA. Continuous graduated boost (deficit x recovery x phase). |
| 15 | Per-Pair Gain Ceilings | `pairGainCeilingController` | Adaptive ceiling from rolling p95 EMA and exceedance rate EMA. |
| 16 | Section-0 Warmup Ramps | `warmupRampController` | Adaptive per-pair ramp from S0 exceedance history and section length EMA. |
| 17 | Orchestrator (hyperMetaManager) | `hyperMetaManager` | Master: health composite, contradiction detection, rate multipliers, E18 scaling. 25-tick cadence (L1-only). |
| 18 | Correlation Shuffler | `correlationShuffler` | Feedback loop correlation detection + perturbation. Inversely health-gated. |

Plus: regime classifier self-balances coherent share via `coherentThresholdScale` (nudge 0.006/beat, range [0.55, 1.20]).

## Operational Mechanics

### Health Detection (#17)

Composite health score [0,1] updated every 25 L1-only ticks:
- Phase health (0.25 weight): penalizes collapsed phase share
- Exceedance health (0.30): penalizes p95 EMA above 0.80
- Watchdog conflicts (0.25): counts active attenuations
- Energy balance (0.20): penalizes homeostasis throttle below 0.8

E18 gating: `e18Scale = healthScale * exceedanceScale` (range [0.25, 1.0]). All evolution strengths multiply by e18Scale.

### Contradiction Detection (#17)

5 cross-controller contradiction patterns:
1. Phase-homeostasis conflict: phase floor active while homeostasis throttling
2. Ceiling-warmup clash: both at minimum on same pair
3. Phase-floor vs pair-ceiling: phase boosting while ceiling very tight
4. Coherent suppression: coherent regime + low phase + no throttle
5. E6+E11 compound tightening: both reducing density ceiling simultaneously

### Graduated Boost Pattern (#14)

Phase floor controller replaces hardcoded step-functions with continuous formulas:
- Collapse threshold: `0.015 + volatilityEma * 0.5` (range [0.01, 0.04])
- Boost: `3.5 + (streak-4)/12 * 5.5 * recoveryFactor * phaseScaling` (range [3.0, 25.0])
- Recovery attribution: 12-beat window, success EMA decays unsuccessful boosts

### Topology Intelligence (#17)

Shannon entropy of coupling matrix classifies topology:
- `crystallized` (entropy < 0.50): stasis risk, creativity suppressed 0.75-0.95x
- `resonant` (0.50-0.72): balanced emergence zone
- `fluid` (> 0.72): diffuse, chaotic

Cross-state: regime + topology + health -> emergence/locked/dampened/seeking

### Fast EMA Transient Detection (#17)

Per-beat energy proxy (density+tension deviation) at alpha=0.22 (~4-beat time constant). Detects spikes within 3-5 beats before slow EMA responds. Used by E21 (flicker cap), E24 (correlation flip dampening), E23 (rest pressure).

## Jurisdiction Enforcement

`check-hypermeta-jurisdiction.js` runs on every pipeline and enforces 4 phases:

1. **SpecialCaps overrides** -- no manual axis floors/caps in equilibrator adjustments
2. **Coupling matrix reads** -- firewall: only coupling engine, meta-controllers, profiler, diagnostics
3. **Bias registration bounds lock** -- 93 registrations locked against `scripts/bias-bounds-manifest.json`
4. **Watched constants** -- 5 controller-managed constants must not be manually set

To update bounds after structural changes: `node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds`

## Interaction Topology

Key interaction chains:
- Equilibrator (#13) tightening -> gain escalation -> homeostasis (#12) throttling (negative feedback)
- Graduated coherent gate: exploring 1.5x, evolving 0.6x, coherent 0.0x
- Gain budget (#9) caps per-axis total
- Watchdog (#11) attenuates weaker of opposing controller pair
- Correlation shuffler (#18) perturbs feedback loops when correlated >0.65 for 40+ beats
- Reconvergence accelerator spikes all alphas on structural discontinuity detection
