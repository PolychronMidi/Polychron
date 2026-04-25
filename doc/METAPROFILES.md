# Metaprofiles

Coordinated initial conditions for the relationship layer. Conductor profiles set per-beat parameters. Composer profiles select which composers are active. Metaprofiles configure the *meta-layer* — the 18 hypermeta controllers, coupling topology, trust ecology bias, and regime targets — so the system self-calibrates toward a specific musical character.

Metaprofiles don't override controllers. They set targets that controllers self-calibrate toward. The regime self-balancer already has a target distribution; a metaprofile changes what that target is. The coupling gain escalation already has a ceiling; a metaprofile raises or lowers it.

## How it works

A metaprofile is a JSON object declaring six axes (regime, coupling, trust, tension, energy, phase) plus orchestration metadata (`sectionAffinity`, `minDwellSections`). Controllers read the active profile every tick, so mid-run switches propagate immediately.

The `default` metaprofile encodes the implicit baseline that every other profile is normalized against. Controllers call `metaProfiles.scaleFactor(axis, key)` — which returns `activeProfile[axis][key] / defaultProfile[axis][key]` — and multiply their `_BASE` constants by that factor. When no metaprofile is active or the axis is disabled, `scaleFactor` returns 1.0 and controllers fall through to their unmodified `_BASE` value.

Schema validation runs once at module load: every profile must declare every axis key with the correct type, regime targets must sum to 1.0, tension floor must be below ceiling, and `sectionAffinity` entries must be known section types. Malformed profiles fail fast with a named error.

## Profile dimensions

### Regime distribution targets
What the regime self-balancer steers toward. The most audible dimension — determines whether the composition feels settled, searching, or volatile.

| Profile | coherent | evolving | exploring |
-
| atmospheric | 60% | 30% | 10% |
| tense | 30% | 50% | 20% |
| chaotic | 15% | 35% | 50% |
| meditative | 75% | 20% | 5% |
| volatile | 10% | 30% | 60% |
| elegiac | 65% | 30% | 5% |
| anthemic | 50% | 40% | 10% |

### Coupling topology bias
How aggressively cross-layer modules couple. Sparse coupling = independent voices. Dense coupling = fused texture.

- **strength range**: [lo, hi] for the coupling gain escalation controller
- **pair density target**: fraction of possible pairs that should be actively coupled
- **antagonism threshold**: minimum |r| for negative-correlation pairs to become antagonism bridges

| Profile | strength | density | antagonism |
-
| atmospheric | [0.2, 0.5] | 0.15 | -0.35 |
| tense | [0.5, 0.8] | 0.30 | -0.25 |
| chaotic | [0.7, 1.0] | 0.50 | -0.15 |
| meditative | [0.1, 0.4] | 0.10 | -0.40 |
| volatile | [0.6, 0.9] | 0.40 | -0.10 |
| elegiac | [0.3, 0.6] | 0.20 | -0.30 |
| anthemic | [0.6, 0.9] | 0.40 | -0.20 |

### Trust ecology shape
How many trust systems dominate and how competitive the landscape is.

- **concentration**: how sharply trust is distributed (low = many competitors, high = few dominants)
- **dominantCap**: maximum trust weight for any single system (prevents monopoly)
- **starvationFloor**: minimum trust weight (prevents total suppression)

| Profile | concentration | dominantCap | starvationFloor |
-
| atmospheric | high (0.7) | 1.8 | 0.8 |
| tense | medium (0.5) | 1.6 | 0.6 |
| chaotic | low (0.3) | 1.4 | 0.4 |
| meditative | very high (0.8) | 1.9 | 0.9 |
| volatile | very low (0.2) | 1.3 | 0.3 |
| elegiac | high (0.75) | 1.85 | 0.85 |
| anthemic | medium-high (0.6) | 1.7 | 0.7 |

### Tension arc shape
How tension builds across sections. Defines the target tension curve that the tension controller follows.

- **shape**: named curve (flat, ascending, descending, arch, sawtooth, erratic)
- **floor**: minimum tension (0-1)
- **ceiling**: maximum tension (0-1)

| Profile | shape | floor | ceiling |
-
| atmospheric | flat | 0.15 | 0.45 |
| tense | ascending | 0.40 | 0.90 |
| chaotic | erratic | 0.20 | 0.95 |
| meditative | flat | 0.05 | 0.30 |
| volatile | sawtooth | 0.10 | 0.85 |
| elegiac | descending | 0.20 | 0.55 |
| anthemic | arch | 0.35 | 0.85 |

### Energy envelope
Density and flicker range — overall energy level and rhythmic volatility.

- **densityTarget**: target density mean (0-1)
- **flickerRange**: [lo, hi] for per-beat flicker

| Profile | densityTarget | flickerRange |
--
| atmospheric | 0.35 | [0.02, 0.08] |
| tense | 0.55 | [0.05, 0.15] |
| chaotic | 0.75 | [0.10, 0.30] |
| meditative | 0.25 | [0.01, 0.05] |
| volatile | 0.60 | [0.08, 0.25] |
| elegiac | 0.30 | [0.03, 0.10] |
| anthemic | 0.65 | [0.05, 0.18] |

### Phase energy
How the polyrhythmic layers interact — locked, drifting, or repelling.

- **lockBias**: tendency toward phase-locked behavior (0 = free, 1 = locked)
- **layerIndependence**: CIM base level (0 = fully coordinated, 1 = fully independent)

| Profile | lockBias | layerIndependence |
--
| atmospheric | 0.6 | 0.3 |
| tense | 0.4 | 0.5 |
| chaotic | 0.2 | 0.8 |
| meditative | 0.8 | 0.2 |
| volatile | 0.1 | 0.9 |
| elegiac | 0.7 | 0.3 |
| anthemic | 0.7 | 0.3 |

## Beyond scaffolding (next-level features)

Five orthogonal extensions sit on top of the static-profile foundation. Each is opt-in: built-in profiles ignore them unless they declare the relevant key.

### Inheritance + per-axis composition

Subvariants reuse a parent's axes and selectively override:

```json
{
  "name": "atmospheric_warm",
  "inherits": "atmospheric",
  "trust": { "concentration": 0.7, "dominantCap": 1.95, "starvationFloor": 0.85 }
}
```

For finer mixing, `compose` pulls each axis from a different parent:

```json
{
  "name": "meditative_climax",
  "compose": {
    "regime": "meditative", "coupling": "anthemic",
    "trust": "meditative", "tension": "anthemic",
    "energy": "anthemic", "phase": "meditative"
  }
}
```

Resolution runs once at module load before validation. The resolver deep-copies parent axes, then applies the child's overrides. Derived keys like `coupling.midpoint` are skipped during unknown-key checks.

### Time-varying axes (envelopes)

Any scalar or pair axis value can be replaced with an envelope `{from, to, curve?}` — the value evolves across the profile's activation.

**Live**: `tense.tension.ceiling` = `{from: 0.70, to: 0.90, curve: 'ascending'}` with `minDwellSections: 2`. `regimeReactiveDamping._getMaxTension` calls `metaProfiles.progressedScaleFactor('tension', 'ceiling')`, and `main.js` updates `metaProfiles.setActivationProgress(elapsed / minDwellSections)` per section. So when tense is active for its 2-section hold, the tension ceiling rises 0.70 → 0.80 → 0.90 across the activation, on top of the existing per-section ascending tension shape — building pressure realized in two dimensions.

Curves: `linear` (default), `ascending` (alias), `descending` (reverse), `arch` (sine peak at midpoint). `getAxisValue` collapses envelopes to mid-progress (0.5) for simple consumers; controllers wanting time resolution use either `getAxisValueAt(axis, key, fallback, progress)` (explicit progress) or `progressedScaleFactor(axis, key)` (reads internal `_activationProgress` set by main.js — the `_BASE * factor` pattern).

### Stochastic axes (distributions)

Scalar axis values can also be replaced with a distribution descriptor `{mean, std, skew?}` — controllers calling `metaProfiles.sampleAxisValue` or `metaProfiles.sampledScaleFactor` draw a fresh Box-Muller-Gaussian sample per tick, biased by `skew` (cubic warp on the standardized variate). Adds organic micro-variation without manual jitter.

**Live**: `chaotic.energy.densityTarget` = `{mean: 0.75, std: 0.06}`. `regimeReactiveDamping._getMaxDensity` uses `sampledScaleFactor` so density jitters around the mean each tick when chaotic is active — built-in flicker behavior with no manual feedback loop.

`getAxisValue` collapses distributions to mean (the deterministic stand-in); `sampleAxisValue` / `sampledScaleFactor` sample. Schema rejects negative `std`. `scaleFactor` collapses to mean for backwards-compatible callers.

### Profile embedding (vector space)

`metaProfileDefinitions.axisVector(profile)` flattens every axis-key into a fixed-length numeric vector (distributions → mean, envelopes → midpoint, pairs → both endpoints, categorical `tension.shape` → ordinal). `distance(a, b)` returns cosine distance in that space; `nearest(name, k)` returns the top-k closest profiles (excluding self and `default`).

**Live**: when no trigger fires, `main.js` rotation sorts the section-affinity candidate pool by axisVector distance to the previously-active profile and randomly picks from the nearest 3. Smoother sonic transitions — adjacent sections feel related rather than randomly different.

```js
metaProfileDefinitions.distance('chaotic', 'volatile');     // smaller — both high-exploring
metaProfileDefinitions.distance('chaotic', 'meditative');   // larger  — opposite poles
metaProfileDefinitions.nearest('atmospheric', 3);           // 3 profiles closest to atmospheric
```

### Reactive triggers

Profiles can declare entry conditions over runtime signals:

```json
{
  "triggers": {
    "enter": [{ "if": "entropy > 0.7", "priority": 80 }]
  }
}
```

Expressions parse as `<signal> <op> <value>` where op ∈ `> >= < <= == !=` and value is numeric or `true`/`false`. `metaProfiles.evaluateTriggers(snapshot)` walks every registered profile's `enter` list and returns the highest-priority match `{profile, priority, condition}` or `null`.

**Live**: `chaotic` declares `couplingStrength > 0.7`. `main.js` builds a snapshot from `systemDynamicsProfiler.getSnapshot()` (couplingStrength, effectiveDimensionality, velocity, curvature, entropyAmplification) and calls `evaluateTriggers` at every section boundary. Triggered profiles pre-empt section-affinity rotation, subject to dwell-guard and `canSwitch`. So when coupling spikes mid-piece, chaotic surfaces regardless of section type.

### Empirical-tuning attribution

`metaProfiles.recordAttribution(fields)` appends a JSONL entry to `output/metrics/metaprofile-attribution.jsonl`. `main.js` writes one entry per section with `{profile, section, sectionType, score, ts}` (score = section composite intensity).

The closing piece is `i/sensitivity`:

```bash
i/sensitivity
```

Reads the JSONL log, emits a per-profile score distribution (n, mean, std, p10/p50/p90, min/max), per-(profile, sectionType) breakdown, ranking by mean score, and a stability classification per profile (stable / moderate / volatile / insufficient — based on coefficient of variation `std/|mean|`). Writes machine-readable JSON to `output/metrics/metaprofile-sensitivity.json` and a Markdown summary to stdout. Evolution priority can later consume this to recommend profile changes when a low-ranked profile dominates the rotation, or when a top-ranked profile is volatile (high score but unstable).

### Substrate-level fields

The 6 axes (regime / coupling / trust / tension / energy / phase) are scaling layer — they multiply existing controllers. The substrate-level optional fields below let a metaprofile actively *choose what's playing*, not just *how loud each dial is*. All optional; profiles without them remain valid.

| Field | Schema | Live consumer | Effect |
|---|---|---|---|
| `composerFamilies` | `{ familyName: weight }` | `factoryFamilies.getComposerFamiliesOrFail` multiplies its computed weight by `metaProfiles.getComposerFamilyWeight(name)` | Biases the composer pool. `chaotic` favors development+rhythmicDrive; `meditative` favors harmonicMotion+diatonicCore. The composition's **emission strategy** changes with the metaprofile, not just its parameters. |
| `conductorAffinity` / `conductorAntipathy` | `string[]` | `conductorConfigDynamics.applyPhaseProfile` honors via `metaProfiles.preferConductorProfile` / `avoidConductorProfile` | Closes the orthogonality gap between meta and conductor profiles. `meditative` prefers `atmospheric`/`meditative` conductors; avoids `chaotic`. |
| `sectionArc` | `string[]` (one per section) | `main.js` section selection consults `metaProfiles.getSectionArcOverride()` | Profile owns the structural sequence when length matches `totalSections`, otherwise falls through to weighted-random. |
| `layerVariants` | `{ L1: name, L2: name }` | Accessor `metaProfiles.getLayerVariant(layer)` available; layer-aware controllers can resolve per-layer subprofile | Per-layer metaprofile assignment. Smaller-footprint version of full per-layer activation. |
| `disableControllers` | `string[]` | Accessor `metaProfiles.isControllerDisabled(name)` available; controllers consult to gate themselves. `meditative` lists `antagonism_bridges`. | Subtractive — silences entire subsystems instead of just damping them. |
| `couplingPairs` | `[[axisA, axisB], ...]` | Persisted in `output/metrics/metaprofile-active.json`; `coupling_bridges.py` and JS coupling controllers can consult `metaProfiles.getCouplingPairsHint()` | Prescribes coupling topology directly instead of letting it emerge from runtime correlation. |

### Three-scope custom registries

`metaProfileDefinitions.loadCustomProfiles()` reads `*.json` from `.hme/metaprofiles/` (project-local) at module load. Custom profiles register new names or override built-in axis values without forking the codebase. Each file is a single profile object using the same schema (including `inherits` / `compose`).

```bash
mkdir -p .hme/metaprofiles
echo '{"name":"my_drift","inherits":"atmospheric","tension":{"shape":"flat","floor":0.10,"ceiling":0.50}}' > .hme/metaprofiles/my_drift.json
```

## Implementation

### File structure

```
src/conductor/metaProfiles.js                  — registry, loader, scaleFactor, dwell, envelope/trigger/attribution
src/conductor/metaProfileDefinitions.js        — built-in definitions + schema validator + resolver
.hme/metaprofiles/*.json                       — project-local custom profiles (loaded at boot)
output/metrics/metaprofile-active.json         — current active profile (atomic write)
output/metrics/metaprofile-history.jsonl       — every transition this run, append-only
output/metrics/metaprofile-attribution.jsonl   — per-section attribution (profile + score) for empirical tuning
```

### Section rotation, dwell, env-var disable

When `ACTIVE_META_PROFILE` is null, `main.js` rotates profiles per section using each profile's `sectionAffinity`. The dwell guard skips a switch attempt if the active profile has not held for `minDwellSections` yet — controllers get time to converge toward the current targets before the next pivot.

For A/B debugging, set `METAPROFILE_DISABLE_AXES=tension,coupling` to suppress specific axes. Suppressed axes are read as null and controllers fall back to their `_BASE` constants — so you can isolate which axis is responsible for an observed behavioural change.

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
    "antagonismThreshold": -0.35
  },
  "trust": {
    "concentration": 0.7,
    "dominantCap": 1.8,
    "starvationFloor": 0.8
  },
  "tension": {
    "shape": "flat",
    "floor": 0.15,
    "ceiling": 0.45
  },
  "energy": {
    "densityTarget": 0.35,
    "flickerRange": [0.02, 0.08]
  },
  "phase": {
    "lockBias": 0.6,
    "layerIndependence": 0.3
  },
  "sectionAffinity": ["intro", "exposition", "resolution", "conclusion", "coda"],
  "minDwellSections": 2
}
```

### Controller integration (all 6 axes wired)

Every axis is connected to a real controller. All read dynamically per-tick so mid-run profile switches take effect immediately.

| Axis | Controller | Method | What changes |
-
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
- **descending** — linear 1→0 across sections (release / denouement)
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

When activated, the profile is persisted to `output/metrics/metaprofile-active.json` so HME Python tools (coupling_bridges, evolution suggestions) can read it.

### Interaction with conductor profiles

Orthogonal. Conductor profiles set what happens *within each beat* (composers, volume, articulation). Metaprofiles set *relationships between systems across the piece* (regime targets, coupling topology, trust ecology). You can freely combine any conductor profile with any metaprofile:

- `atmospheric` conductor + `atmospheric` meta = maximally ambient
- `atmospheric` conductor + `chaotic` meta = ambient timbres with volatile structure
- `varied` conductor + `tense` meta = diverse textures building toward climax

### Lab sketches

Test sketches in `lab/sketches.js`:

- **metaprofile-atmospheric-to-chaotic** — A/B test: atmospheric for sections 0-2, hot-switch to chaotic at section 3. Validates pivot behavior.
- **metaprofile-meditative** — full run with meditative profile. Validates high coherence, low density, tight flicker.
- **metaprofile-volatile** — full run with volatile. Validates maximum exploring, independent layers.
- **metaprofile-elegiac** — full run with elegiac. Validates the descending tension shape (release / denouement arc).
- **metaprofile-anthemic** — full run with anthemic. Validates locked-step shared peak (high coupling + arch tension + locked phases).

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
