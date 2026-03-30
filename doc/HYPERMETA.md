# Hypermeta Self-Calibrating Controllers

16 meta-controllers auto-tune parameters that previously required manual adjustment. Queryable via `metaControllerRegistry.getAll()` / `getById()` / `getByAxis()` / `getInteractors()`.

**Rule:** Never hand-tune constants a meta-controller manages. Modify the controller logic instead. Pipeline script `check-hypermeta-jurisdiction.js` enforces this across 4 phases.

## Controllers

| # | Name | Owner | What it tunes |
|---|------|-------|---------------|
| 1 | Self-Calibrating Coupling Targets | `pipelineCouplingManager` | Per-pair rolling \|r\| EMA. Intractable pairs relax upward; resolved pairs tighten. |
| 2 | Regime Distribution Equilibrator | `regimeReactiveDamping` | 64-beat rolling histogram vs target budget {exploring:35%, coherent:35%, evolving:20%}. |
| 3 | Pipeline Product Centroid | `conductorDampening` | 20-beat product EMA. Corrective multiplier (+-25%) counteracts drift from 1.0. Density/tension only. |
| 4 | Flicker Range Elasticity | `conductorDampening` | 32-beat rolling flicker range. 3x accelerated rate (0.015/beat). |
| 5 | Trust Starvation Auto-Nourishment | `adaptiveTrustScores` | Per-system velocity EMA (50-beat). Injects synthetic payoff when stagnant 100+ beats. |
| 6 | Adaptive Coherent Relaxation | `pipelineCouplingManager` | Coupling relaxation derived from rolling regime share. |
| 7 | Entropy PI Controller | `systemDynamicsProfiler` | Integral term + adaptive alpha + anti-windup (Ki=0.05, clamp +-3.0). |
| 8 | Progressive Strength Auto-Scaling | `conductorDampening` | Dampening strength from active contributor count. |
| 9 | Coupling Gain Budget Manager | `pipelineCouplingManager` | Per-axis budget cap (0.24, flicker 0.36). |
| 10 | Meta-Observation Telemetry | `conductorDampening` | Per-beat snapshots to explainabilityBus + watchdog feed. |
| 11 | Meta-Controller Interaction Watchdog | `conductorMetaWatchdog` | Detects opposing corrections on same axis. Attenuates weaker controller 50%. |
| 12 | Coupling Energy Homeostasis | `couplingHomeostasis` | Total \|r\| scalar tracking, redistribution detection, global gain throttle, Gini guard. |
| 13 | Axis Energy Equilibrator | `axisEnergyEquilibrator` | Two-layer: pair hotspot detection + axis energy balancing. Graduated coherent gate. |
| 14 | Phase Energy Floor | `phaseFloorController` | Adaptive collapse detection and graduated boost for phase axis. |
| 15 | Per-Pair Gain Ceilings | `pairGainCeilingController` | Adaptive ceiling from rolling p95 EMA. |
| 16 | Section-0 Warmup Ramps | `sectionWarmupRampController` | Adaptive per-pair ramp from S0 exceedance history. |

Plus: regime classifier self-balances coherent share via `coherentThresholdScale` (target 10-32%, nudge 0.006/beat, range [0.55, 1.20]). Not a meta-controller — intrinsic regime self-regulation.

## Jurisdiction Enforcement

`check-hypermeta-jurisdiction.js` runs on every pipeline and enforces 4 phases:

1. **SpecialCaps overrides** — no manual axis floors/caps in equilibrator adjustments
2. **Coupling matrix reads** — firewall: only coupling engine, meta-controllers, profiler, diagnostics
3. **Bias registration bounds lock** — 92 registrations locked against `scripts/bias-bounds-manifest.json`
4. **Watched constants** — 5 controller-managed constants must not be manually set

To update bounds after structural changes: `node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds`

## Interaction Topology

Controllers interact through shared state. Key interaction chains are documented in [TUNING_MAP.md](TUNING_MAP.md) cross-constant invariants section, especially:
- Equilibrator (#13) tightening -> gain escalation -> homeostasis (#12) throttling (negative feedback)
- Graduated coherent gate: exploring 1.5x, evolving 0.6x, coherent 0.0x
- Gain budget (#9) caps per-axis total, preventing coupling manager from dominating any pipeline
