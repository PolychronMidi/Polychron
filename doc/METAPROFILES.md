# Metaprofiles

Coordinated initial conditions for the relationship layer. Conductor profiles set per-beat parameters. Composer profiles select which composers are active. Metaprofiles configure the *meta-layer* — the 19 hypermeta controllers, coupling topology, trust ecology bias, and regime targets — so the system self-calibrates toward a specific musical character.

Metaprofiles don't override controllers. They set targets that controllers self-calibrate toward. The regime self-balancer already has a target distribution; a metaprofile changes what that target is. The coupling gain escalation already has a ceiling; a metaprofile raises or lowers it.

## How it works

At boot, `hyperMetaManager.initialize()` reads the active metaprofile from `conductor.getActiveMetaProfile()`. Each meta-controller checks the profile for its axis and adjusts its target/ceiling/floor. If no metaprofile is set, controllers use their current hardcoded defaults — backward compatible.

A metaprofile is a JSON object with per-axis overrides. Controllers that aren't mentioned keep their defaults. This means a minimal metaprofile can tweak just regime targets and leave everything else alone, or a maximal one can configure every axis.

## Profile dimensions

### Regime distribution targets
What the regime self-balancer steers toward. The most audible dimension — determines whether the composition feels settled, searching, or volatile.

| Profile | coherent | evolving | exploring |
|---|---|---|---|
| atmospheric | 60% | 30% | 10% |
| tense | 30% | 50% | 20% |
| chaotic | 15% | 35% | 50% |
| meditative | 75% | 20% | 5% |
| volatile | 10% | 30% | 60% |

### Coupling topology bias
How aggressively cross-layer modules couple. Sparse coupling = independent voices. Dense coupling = fused texture.

- **strength range**: [lo, hi] for the coupling gain escalation controller
- **pair density target**: fraction of possible pairs that should be actively coupled
- **antagonism threshold**: minimum |r| for negative-correlation pairs to become antagonism bridges

| Profile | strength | density | antagonism |
|---|---|---|---|
| atmospheric | [0.2, 0.5] | 0.15 | -0.35 |
| tense | [0.5, 0.8] | 0.30 | -0.25 |
| chaotic | [0.7, 1.0] | 0.50 | -0.15 |
| meditative | [0.1, 0.4] | 0.10 | -0.40 |
| volatile | [0.6, 0.9] | 0.40 | -0.10 |

### Trust ecology shape
How many trust systems dominate and how competitive the landscape is.

- **concentration**: how sharply trust is distributed (low = many competitors, high = few dominants)
- **dominant_cap**: maximum trust weight for any single system (prevents monopoly)
- **starvation_floor**: minimum trust weight (prevents total suppression)

| Profile | concentration | dominant_cap | starvation_floor |
|---|---|---|---|
| atmospheric | high (0.7) | 1.8 | 0.8 |
| tense | medium (0.5) | 1.6 | 0.6 |
| chaotic | low (0.3) | 1.4 | 0.4 |
| meditative | very high (0.8) | 1.9 | 0.9 |
| volatile | very low (0.2) | 1.3 | 0.3 |

### Tension arc shape
How tension builds across sections. Defines the target tension curve that the tension controller follows.

- **shape**: named curve (flat, ascending, arch, sawtooth, erratic)
- **floor**: minimum tension (0-1)
- **ceiling**: maximum tension (0-1)

| Profile | shape | floor | ceiling |
|---|---|---|---|
| atmospheric | flat | 0.15 | 0.45 |
| tense | ascending | 0.40 | 0.90 |
| chaotic | erratic | 0.20 | 0.95 |
| meditative | flat | 0.05 | 0.30 |
| volatile | sawtooth | 0.10 | 0.85 |

### Energy envelope
Density and flicker range — overall energy level and rhythmic volatility.

- **density_target**: target density mean (0-1)
- **flicker_range**: [lo, hi] for per-beat flicker

| Profile | density_target | flicker_range |
|---|---|---|
| atmospheric | 0.35 | [0.02, 0.08] |
| tense | 0.55 | [0.05, 0.15] |
| chaotic | 0.75 | [0.10, 0.30] |
| meditative | 0.25 | [0.01, 0.05] |
| volatile | 0.60 | [0.08, 0.25] |

### Phase energy
How the polyrhythmic layers interact — locked, drifting, or repelling.

- **lock_bias**: tendency toward phase-locked behavior (0 = free, 1 = locked)
- **layer_independence**: CIM base level (0 = fully coordinated, 1 = fully independent)

| Profile | lock_bias | layer_independence |
|---|---|---|
| atmospheric | 0.6 | 0.3 |
| tense | 0.4 | 0.5 |
| chaotic | 0.2 | 0.8 |
| meditative | 0.8 | 0.2 |
| volatile | 0.1 | 0.9 |

## Implementation

### File structure

```
src/conductor/metaProfiles.js          — profile registry + loader
src/conductor/metaProfileDefinitions.js — built-in profile definitions
metrics/metaprofile-active.json         — current active profile (set by conductor config)
```

### Profile schema

```json
{
  "name": "atmospheric",
  "description": "Sparse, ambient, slowly evolving texture with dominant coherence",
  "regime": {
    "coherent": 0.60,
    "evolving": 0.30,
    "exploring": 0.10
  },
  "coupling": {
    "strength": [0.2, 0.5],
    "density": 0.15,
    "antagonism_threshold": -0.35
  },
  "trust": {
    "concentration": 0.7,
    "dominant_cap": 1.8,
    "starvation_floor": 0.8
  },
  "tension": {
    "shape": "flat",
    "floor": 0.15,
    "ceiling": 0.45
  },
  "energy": {
    "density_target": 0.35,
    "flicker_range": [0.02, 0.08]
  },
  "phase": {
    "lock_bias": 0.6,
    "layer_independence": 0.3
  }
}
```

### Controller integration (all 6 axes wired)

Every axis is connected to a real controller. All read dynamically per-tick so mid-run profile switches take effect immediately.

| Axis | Controller | Method | What changes |
|---|---|---|---|
| Regime | `regimeReactiveDamping` | `_getRegimeBudget()` | Target coherent/evolving/exploring share |
| Tension | `regimeReactiveDamping` | `_getMaxTension()` + shape curve | Swing amplitude + curve shape (flat/ascending/arch/sawtooth/erratic) |
| Density | `regimeReactiveDamping` | `_getMaxDensity()` | Swing amplitude scaled by densityTarget |
| Coupling | `pairGainCeilingController` | `_couplingScale()` | Scales all pair gain ceilings (base, min, max) |
| Trust cap/floor | `adaptiveTrustScores` | `_getTrustCeiling()`/`_getDecayFloor()` | Dominance cap + starvation floor |
| Trust concentration | `adaptiveTrustScores` | `_getConcentrationScale()` | EMA learning rate → narrows or widens competition |
| Phase/CIM | `coordinationIndependenceManager` | `_getRegimeTarget()` | Biases coordination dial toward independence or lock |
| Antagonism threshold | `coupling_bridges.py` | reads `metaprofile-active.json` | Qualification cutoff for antagonism bridge candidates |

### Tension shape curves

The `tension.shape` field drives a per-section tension modulation curve:

- **flat** — constant 0.5 across all sections (ambient, no arc)
- **ascending** — linear 0→1 across sections (building to climax)
- **arch** — sine curve peaking at mid-piece (default, classic arc)
- **sawtooth** — repeating 0→1 ramp with resets (pulsing tension)
- **erratic** — quasi-random multi-frequency oscillation (chaotic texture)

### Selection

Set `ACTIVE_META_PROFILE` in `src/conductor/config.js`:

```js
ACTIVE_META_PROFILE = 'atmospheric';  // or null for no metaprofile
```

Override per-lab-sketch via `postBoot()`:

```js
postBoot() {
  metaProfiles.setActive('chaotic');
}
```

Hot-switch mid-composition (controllers smooth the transition via their own EMAs):

```js
// At section 3 of 6, pivot from atmospheric to chaotic
if (sectionIndex === 3) metaProfiles.setActive('chaotic');
```

When activated, the profile is persisted to `metrics/metaprofile-active.json` so HME Python tools (coupling_bridges, evolution suggestions) can read it.

### Interaction with conductor profiles

Orthogonal. Conductor profiles set what happens *within each beat* (composers, volume, articulation). Metaprofiles set *relationships between systems across the piece* (regime targets, coupling topology, trust ecology). You can freely combine any conductor profile with any metaprofile:

- `atmospheric` conductor + `atmospheric` meta = maximally ambient
- `atmospheric` conductor + `chaotic` meta = ambient timbres with volatile structure
- `varied` conductor + `tense` meta = diverse textures building toward climax

### Lab sketches

Three test sketches in `lab/sketches.js`:

- **metaprofile-atmospheric-to-chaotic** — A/B test: atmospheric for sections 0-2, hot-switch to chaotic at section 3. Validates pivot behavior.
- **metaprofile-meditative** — full run with meditative profile. Validates high coherence, low density, tight flicker.
- **metaprofile-volatile** — full run with volatile. Validates maximum exploring, independent layers.

You can combine any conductor profile with any metaprofile:
- `atmospheric` conductor + `atmospheric` meta = maximally ambient
- `atmospheric` conductor + `chaotic` meta = ambient timbres with volatile structure
- `varied` conductor + `tense` meta = diverse textures building toward climax

### Pipeline integration

`main-pipeline.js` already reads the conductor profile. Metaprofile selection is logged alongside it in `pipeline-summary.json`. The fingerprint comparison includes the metaprofile name so drift detection accounts for intentional character changes.

### Evolution implications

Metaprofiles are a new evolution axis. HME can:
- Propose metaprofile changes when the compositional trajectory plateaus
- A/B test metaprofiles in lab sketches
- Crystallize "this metaprofile + this conductor profile produced LEGENDARY" patterns
- Auto-derive new metaprofiles from empirically successful parameter combinations

The evolution priority system (`compute-evolution-priority.js`) gains a new signal: when the trajectory shows plateau, it can suggest a metaprofile switch rather than a code change — the cheapest possible intervention with the largest behavioral impact.
