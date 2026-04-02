# Adaptive System Infrastructure

Cross-run persistence, structural discontinuity detection, regime-adaptive convergence, and effectiveness-weighted learning.

## Cross-Run Warm-Start

`metrics/adaptive-state.json` persists terminal EMA values at end of each composition (written by `grandFinale.js`):

```json
{
  "healthEma": 0.695,
  "exceedanceTrendEma": 0.5,
  "systemPhase": "converging",
  "savedAt": "2026-04-02T..."
}
```

Loaded by `hyperMetaManagerState` (state.js) on boot. Values are **clamped to safe ranges** to prevent stressed-state boot loops:
- `healthEma`: clamped to [0.4, 0.9]
- `exceedanceTrendEma`: clamped to [0, 0.5]

Without warm-start, the system starts from fixed defaults (healthEma=0.7, exceedanceTrendEma=0) and needs 200+ beats to calibrate. With warm-start, it begins from the previous run's converged state.

## Reconvergence Accelerator

`src/conductor/signal/meta/manager/reconvergenceAccelerator.js` -- detects structural input discontinuities and temporarily spikes EMA alphas for fast reconvergence.

### Detection

Maintains a rolling window of 16 system health inputs (8 recent, 8 prior). When the mean of the recent half differs from the prior half by > 0.25, triggers acceleration.

### Response

- Raises EMA alpha multiplier to ~5x (0.4 / 0.08 baseline)
- Decays at 0.92/tick for 50 ticks
- Disengages when multiplier drops below 1.1

### Integration

Wired into hyperMetaManager's health EMA update:
```
healthAlpha = HEALTH_EMA_ALPHA * reconvergenceAccelerator.getAlphaMultiplier()
```
Clamped to [HEALTH_EMA_ALPHA, 0.4] to prevent runaway.

## Regime-Adaptive Alphas

`regimeTransitionAlphaBoost` in hyperMetaManager state spikes on regime transitions to help EMAs snap to new operating points.

- **Detection**: compares current regime to previous tick's regime
- **Spike**: 3.0x multiplier on regime change
- **Decay**: 0.88/tick (drops to 1.0 in ~15 ticks)
- **Applied to**: exceedanceTrendEma (and any future adaptively-alphaed EMAs)

Distinct from reconvergence accelerator: this handles runtime musical regime changes (coherent->exploring), not architectural structural changes.

## Effectiveness-Weighted Convergence

Each hypermeta controller tracks an effectiveness EMA (0-1 scale, 0.5=neutral). The EMA alpha itself scales with effectiveness:

```
effAlpha = EFFECTIVENESS_EMA_ALPHA * (0.6 + effectivenessEma * 0.8)
```

Range: 0.02 (ineffective, slow learning) to 0.12 (effective, fast learning).

Proven controllers also get more authority: rate multiplier ranges from baseline to +25% (was +15%) based on effectiveness.

### Darwinian Dynamic

- Controller makes a correction that improves health -> effectivenessEma rises -> alpha increases -> faster future corrections -> more authority
- Controller makes corrections that hurt health -> effectivenessEma drops -> alpha decreases -> slower corrections -> less authority
- Self-reinforcing: good controllers get faster and more powerful, bad ones fade

## Musical Time Windows Utility

`src/utils/musicalTimeWindows.js` -- converts musical duration to tick counts based on current tempo/meter.

- `beatsForSeconds(seconds)`: how many beats fit in N seconds at current spBeat
- `ticksForSeconds(seconds)`: how many conductor recorder ticks fit in N seconds (accounts for numerator)

Available for modules to replace hardcoded window sizes with tempo-adaptive values.

## System Health Composite

Computed every 25 L1-only ticks by `systemHealth.computeSystemHealth()`:

- **Phase health** (weight 0.25): penalizes collapsed phase share
- **Exceedance health** (weight 0.30): penalizes high p95 EMA across pair ceilings
- **Watchdog conflicts** (weight 0.25): counts active controller attenuations
- **Energy balance** (weight 0.20): penalizes homeostasis throttling

Health drives E18 scaling: `e18Scale = clamp(healthEma/0.7, 0.5, 1.0) * clamp(1 - max(0, exceedanceTrend-0.4)*1.5, 0.5, 1.0)`. All evolution strengths scale by e18Scale.

## System Phase Classification

Every 25 ticks:
- **stabilized**: healthEma > 0.80 AND exceedanceTrendEma < 0.05
- **oscillating**: totalInterventionEma > 0.48 AND |healthEma - 0.7| > 0.15
- **converging**: default (recovery mode)

Phase affects: CIM dial adjustment speed, global rate multiplier (oscillating=0.5x, stabilized=1.3x), topology creativity.
