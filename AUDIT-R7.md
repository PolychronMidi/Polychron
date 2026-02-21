# Round 7 — Comprehensive Coherence Audit

> Scope: all `src/` files.
> Format per finding: Category · File:Line · Current code · Suggested fix · Priority.

---

## A. Validation & Safety

### A1. `typeof` guard on non-VALIDATED global `rotate`

**File:** `src/rhythm/PhaseLockedRhythmGenerator.js:110`
**Priority:** Medium

`rotate` is declared in `globals.d.ts` and assigned in `rhythm/patterns.js`, but **not listed in VALIDATED\_GLOBALS**.
The `typeof` guard is therefore technically valid — but the real fix is to add `rotate` to VALIDATED\_GLOBALS and remove the guard.

```js
// Current
if (typeof rotate === 'undefined') {
  throw new Error('PhaseLockedRhythmGenerator.generate: rotate() function not available');
}
```

```js
// Fix — after adding 'rotate' to VALIDATED_GLOBALS in fullBootstrap.js
// (and to mainBootstrap.assertBootstrapGlobals):
// DELETE the typeof block entirely. Trust bootstrap.
```

---

### A2. `|| 0.35` falsifies legitimate zero — use `??`

**File:** `src/conductor/texture/LayerCoherenceScorer.js:61`
**Priority:** Medium

If a caller passes `threshold = 0`, the `||` coerces it to `0.35`.
`??` preserves an explicit zero while still defaulting `undefined`/`null`.

```js
// Current
return lastCoherence < (threshold || 0.35);
```

```js
// Fix
return lastCoherence < (threshold ?? 0.35);
```

---

### A3. `|| 0` on config properties — use `??`

**File:** `src/fx/stutter/stutterNotes.js:147, 150`
**Priority:** Low

These properties come from `STUTTER_CROSSMOD_RULES` config objects.
`|| 0` is semantically wrong if the config legitimately stores `0`.

```js
// Current (line 147)
shiftRangeBias += Math.round((crossRules.pan.shiftRangeBias || 0) * panAbs);
// Current (line 150)
velocityScaleBias += (crossRules.fade.velocityScaleBias || 0) * modBus.fade;
```

```js
// Fix
shiftRangeBias += Math.round((crossRules.pan.shiftRangeBias ?? 0) * panAbs);
velocityScaleBias += (crossRules.fade.velocityScaleBias ?? 0) * modBus.fade;
```

---

### A4. `|| []` on instance property — use `??`

**File:** `src/composers/ScaleComposer.js:74`
**Priority:** Low

`this.voiceHistory` is guarded above (throw if exists but not an array), then used with `|| []`.
`??` is more precise — only replaces `undefined`/`null`.

```js
// Current
selectedNote = this.VoiceLeadingScore.selectNextNote(this.voiceHistory || [], candidates, {});
```

```js
// Fix
selectedNote = this.VoiceLeadingScore.selectNextNote(this.voiceHistory ?? [], candidates, {});
```

---

### A5. `Map.get() || []` — use `??`

**File:** `src/fx/stutter/stutterPlanScheduler.js:27, 62`
**Priority:** Low

`Map.get()` returns `undefined` when the key is absent. `??` is the correct null-coalescing operator.

```js
// Current (line 27)
const arr = stutterMgr.scheduledPlans.get(key) || [];
// Current (line 62)
const arr = stutterMgr.scheduledPlans.get(k) || [];
```

```js
// Fix
const arr = stutterMgr.scheduledPlans.get(key) ?? [];
const arr = stutterMgr.scheduledPlans.get(k) ?? [];
```

---

### A6. 26× inline `Number.isFinite(x) ? x : fallback` — use `V.optionalFinite`

**Priority:** High (systematic convention violation)

The project guide explicitly bans `Number.isFinite(x) ? x : fallback` — use `Validator.optionalFinite` instead.
26 instances across crossLayer and conductor modules:

| File | Line | Current Pattern |
|------|------|-----------------|
| `src/crossLayer/crossLayerDynamicEnvelope.js` | 31 | `Number.isFinite(intent.densityTarget) ? intent.densityTarget : 0.5` |
| `src/crossLayer/crossLayerDynamicEnvelope.js` | 100 | `Number.isFinite(intent.interactionTarget) ? intent.interactionTarget : 0.5` |
| `src/crossLayer/crossLayerSilhouette.js` | 45, 73, 74 | same pattern on `currentEntropy`, `densityTarget`, `entropyTarget` |
| `src/crossLayer/texturalMirror.js` | 42, 46, 47 | same pattern on `interactionTarget`, `chordalBias`, `melodicBias` |
| `src/crossLayer/rhythmicComplementEngine.js` | 72, 79, 117, 118 | `tpBeat`, `intent.interactionTarget`, `intent.densityTarget` |
| `src/crossLayer/harmonicIntervalGuard.js` | 68 | `intent.dissonanceTarget` |
| `src/crossLayer/articulationComplement.js` | 41, 65 | `tpBeat`, `intent.interactionTarget` |
| `src/crossLayer/restSynchronizer.js` | 35, 38 | `sig.heatLevel`, `sig.densityTarget` |
| `src/crossLayer/convergenceDetector.js` | 152 | `windowMs` |
| `src/crossLayer/negotiationEngine.js` | 26 | `context.entropyScale` |
| `src/crossLayer/explainabilityBus.js` | 38 | `limit` |
| `src/crossLayer/adaptiveTrustScores.js` | 27, 47 | `beatStartTime`, `rate` |
| `src/crossLayer/registerCollisionAvoider.js` | 12 | `beatStartTime` |
| `src/crossLayer/pitchMemoryRecall.js` | 45 | `beatStartTime` |
| `src/fx/stutter/stutterManager.js` | 90 | `tpUnit` |
| `src/conductor/TextureBlender.js` | 95 | `beatStart` |

**Suggested fix pattern** (each file needs `const V = Validator.create('ModuleName')` stamp first):

```js
// Current
const densityTarget = Number.isFinite(intent.densityTarget) ? intent.densityTarget : 0.5;

// Fix
const densityTarget = V.optionalFinite(intent.densityTarget, 0.5);
```

**Sub-finding: 4 of these guard boot-validated globals** (`beatStartTime`, `tpBeat`, `tpUnit`, `beatStart`) — these are in VALIDATED\_GLOBALS, so the source guarantees them.
Per Principle 2 ("the source must guarantee it — not the consumer") and the project guide ("Globals are truth: initialize correctly at the source. Never 'sanitize' downstream."), **these guards are doubly wrong**: they're both inline-validated AND redundant.

```js
// Current (adaptiveTrustScores.js:27) — beatStartTime is boot-validated
state.lastMs = Number.isFinite(beatStartTime) ? beatStartTime * 1000 : 0;

// Fix — trust the boot check
state.lastMs = beatStartTime * 1000;
```

---

### A7. Inline `Number.isFinite` throw guards in EnergyMomentumTracker

**File:** `src/conductor/dynamics/EnergyMomentumTracker.js:16`
**Priority:** Low

```js
// Current
if (typeof energy !== 'number' || !Number.isFinite(energy)) {
  throw new Error('EnergyMomentumTracker.recordEnergy: energy must be a finite number');
}

// Fix — add Validator stamp and use it
const V = Validator.create('EnergyMomentumTracker');
// Then in recordEnergy:
V.requireFinite(energy, 'energy');
```

This finding applies broadly — see F1.

---

## B. Return-Type Bugs

No new findings. R6 fixed the `InteractionHeatMap.getTrend()` object-vs-number bug.

---

## C. Registration Completeness

### C1. `rotate` missing from VALIDATED\_GLOBALS

**File:** `src/play/fullBootstrap.js` (rhythm section, ~line 175)
**Priority:** Medium

`rotate` is a naked global assigned in `src/rhythm/patterns.js:51`, declared in `globals.d.ts:259`, and used by multiple consumers.
It satisfies all criteria for boot validation.

```js
// Fix — add to the rhythm section of VALIDATED_GLOBALS:
    'PhaseLockedRhythmGenerator',
    'rotate',          // ← ADD
    'RHYTHM_PRIOR_TABLES',
```

Also add to `mainBootstrap.assertBootstrapGlobals()`.

---

### C2. `p` missing from VALIDATED\_GLOBALS

**File:** `src/play/fullBootstrap.js` (writer section, ~line 287)
**Priority:** Medium

`p` (alias for `pushMultiple`) is assigned in `src/writer/index.js:29`, declared in `globals.d.ts:427`, and used by `VelocityInterference`, `EmergentDownbeat`, and other crossLayer/play modules.

```js
// Fix — add to the writer section of VALIDATED_GLOBALS:
    'grandFinale',
    'p',               // ← ADD
```

After adding, remove the `typeof p !== 'function'` guards in:
- `src/crossLayer/velocityInterference.js:113`
- `src/crossLayer/emergentDownbeat.js:73, 95`

---

### C3. All CrossLayerRegistry registrations present ✓

31 modules registered with appropriate scopes. No gaps found.

---

### C4. All ConductorIntelligence registrations present ✓

100+ registrations across 16 recorders, density biases, tension biases, flicker modifiers, and state providers. All recorder-holding modules also have `reset()` functions. No gaps found.

---

## D. Smoothing & State Initialization

### D1. All exponential smoothing patterns properly initialized ✓

13 smoothing patterns found. All have:
- Correct initial values at declaration
- Proper `reset()` functions that restore initial values
- Clamped alpha factors

No issues found.

---

## E. API Consistency

### E1. `isInTension(threshold)` falsifies zero threshold

**File:** `src/conductor/texture/LayerCoherenceScorer.js:61`
**Priority:** Medium (same as A2 — listed here for API completeness)

A caller passing `threshold = 0` (meaning "any coherence counts as tension") gets treated as `0.35` instead.
Fix: use `??` (see A2).

---

### E2. `SectionIntentCurves.getLastIntent()` consumers have inconsistent guard style

**Priority:** Low

9 consumers of `intent.densityTarget`, `intent.interactionTarget`, etc. all use inline `Number.isFinite(intent.field) ? intent.field : 0.5`.
This should be standardized to `V.optionalFinite(intent.field, 0.5)` (see A6).

---

## F. Code Quality & Conventions

### F1. ~60 conductor intelligence modules missing `Validator.create()` stamps

**Priority:** High (systematic)

Per project convention, every module that validates input should use a stamped `Validator` for traceable errors.
The following subdirectories have **zero** stamps:

| Subdirectory | File Count | Stamps Found |
|---|---|---|
| `src/conductor/dynamics/` | 8 files | 0 |
| `src/conductor/melodic/` | 15 files | 0 |
| `src/conductor/texture/` | 19 files | 0 |
| `src/conductor/harmonic/` | 13 files | 1 (`CadenceAdvisor.js`) |
| `src/conductor/rhythmic/` | 14 files | 2 (`AccentPatternTracker.js`, `beatGridHelpers.js`) |

**Total: ~57 modules without stamps.**

**Fix pattern** (add to the top of each IIFE):

```js
// Current (e.g., DynamicArchitectPlanner.js)
DynamicArchitectPlanner = (() => {
  const MAX_SNAPSHOTS = 64;
  // ...

// Fix
DynamicArchitectPlanner = (() => {
  const V = Validator.create('DynamicArchitectPlanner');
  const MAX_SNAPSHOTS = 64;
  // ...
```

Once stamped, inline `Number.isFinite` checks can be replaced with `V.requireFinite` / `V.optionalFinite`.

---

### F2. Files exceeding 200-line target

| File | Lines | Suggested extraction |
|---|---|---|
| `src/play/playNotes.js` | 297 | Already has `playNotesEmitPick` extracted; further extraction may reduce coupling |
| `src/conductor/rhythmic/InterLayerRhythmAnalyzer.js` | 276 | Extract phase analysis or polyrhythmic ratio helpers |
| `src/rhythm/PhaseLockedRhythmGenerator.js` | 267 | Extract drift calculation and texture-metric helpers |
| `src/conductor/CoherenceMonitor.js` | 208 | Marginal — could extract `computeCoherenceContributions` |

**Priority:** Low (functional, just oversized per the ≤200 line target)

---

## G. Architectural Gaps

### G1. `p` and `rotate` not boot-validated (see C1, C2)

Both are stable globals assigned once at load time, declared in `globals.d.ts`, and consumed by multiple modules — they satisfy all criteria for VALIDATED\_GLOBALS inclusion.

After adding them, three `typeof` guards become violations of `no-typeof-validated-global` and should be deleted:

| File | Line | Guard |
|---|---|---|
| `src/rhythm/PhaseLockedRhythmGenerator.js` | 110 | `typeof rotate === 'undefined'` |
| `src/crossLayer/velocityInterference.js` | 113 | `typeof p !== 'function'` |
| `src/crossLayer/emergentDownbeat.js` | 73, 95 | `typeof p !== 'function'` |

**Priority:** Medium

---

### G2. `typeof c` guards are correct (NOT a gap)

`c` is declared in `globals.d.ts` but intentionally **excluded** from VALIDATED\_GLOBALS because it mutates per-layer (points to `c1` or `c2`). The `typeof c === 'undefined'` guard in `VelocityInterference.js:116` is therefore valid and NOT redundant.

---

## H. Defensive Coding — Fail-Fast Violations

### H1. 12× silent `if (!Number.isFinite(x)) return;` in recorder functions

**Priority:** High (violates Principle #2 — "Loud Crashes, Never Silent Corruption")

These recorder functions silently swallow invalid input. If `absTime` or `density` is `NaN`, the recorder silently no-ops, and downstream query functions return stale data without any signal that something is wrong. This means bad data propagates as "slightly wrong music" instead of a traceable crash.

| File | Line | Silent guard |
|---|---|---|
| `src/conductor/dynamics/DynamicArchitectPlanner.js` | 19 | `if (!Number.isFinite(intensity) \|\| !Number.isFinite(absTime)) return;` |
| `src/conductor/dynamics/DynamicPeakMemory.js` | 19 | `if (!Number.isFinite(intensity) \|\| !Number.isFinite(absTime)) return;` |
| `src/conductor/dynamics/EnergyMomentumTracker.js` | ~20 | inline throw, but other recorders don't |
| `src/conductor/harmonic/HarmonicDensityOscillator.js` | 17 | `if (!Number.isFinite(changeRate) \|\| !Number.isFinite(absTime)) return;` |
| `src/conductor/harmonic/HarmonicPedalFieldTracker.js` | 22 | `if (!Number.isFinite(absTime)) return;` |
| `src/conductor/melodic/AmbitusMigrationTracker.js` | 41 | `if (!Number.isFinite(absTime)) return;` |
| `src/conductor/melodic/IntervalExpansionContractor.js` | 17 | `if (!Number.isFinite(absTime)) return;` |
| `src/conductor/rhythmic/RhythmicDensityContrastTracker.js` | 16 | `if (!Number.isFinite(density)) return;` |
| `src/conductor/rhythmic/TemporalProportionTracker.js` | 22, 32 | `if (!Number.isFinite(durationBeats) \|\| durationBeats <= 0) return;` |
| `src/conductor/texture/TexturalGradientTracker.js` | 18 | `if (!Number.isFinite(density) \|\| !Number.isFinite(absTime)) return;` |
| `src/conductor/texture/SectionLengthAdvisor.js` | 15 | `if (!Number.isFinite(compositeIntensity)) return;` |
| `src/conductor/texture/LayerEntryExitTracker.js` | 16 | `if (!Number.isFinite(absTime)) return;` |

**Suggested fix** (after adding `V = Validator.create(...)` stamp):

```js
// Current (DynamicArchitectPlanner.js:19)
function recordIntensity(intensity, absTime) {
  if (!Number.isFinite(intensity) || !Number.isFinite(absTime)) return;

// Fix
function recordIntensity(intensity, absTime) {
  V.requireFinite(intensity, 'intensity');
  V.requireFinite(absTime, 'absTime');
```

The `TemporalProportionTracker` cases at lines 22 and 32 also guard `durationBeats <= 0`. This is a domain constraint, not a validation gap — keep as `V.assertRange(durationBeats, 0, Infinity, 'durationBeats')` or similar.

---

### H2. `|| ''` patterns in string parsing (informational — no action needed)

**Files:** `src/composers/chord/chordUtils.js:20, 21, 27`, `src/composers/chord/ProgressionGenerator.js:92`

These are idiomatic for regex `.split()` results where trailing segments may be undefined. No violation — documented for completeness.

---

### H3. `(obj[key] || 0) + 1` counter patterns (informational — no action needed)

**Files:** `StutterMetrics.js`, `TimbreBalanceTracker.js`, `StructuralFormTracker.js`, `RepetitionFatigueMonitor.js`, `PedalPointDetector.js`, `CrossLayerDensityBalancer.js`, `InteractionHeatMap.js`, `IntervalDirectionMemory.js`, `HarmonicSurpriseIndex.js`, `motifSpreader.js`

Standard sparse-counter accumulation. `(undefined || 0) + 1 = 1` is correct.
`?? 0` would be semantically cleaner but functionally identical in this use case.
**No change needed** — these are idiomatic counter increments, not null-coalescing semantics.

---

## Summary

| Cat | Count | High | Medium | Low |
|-----|-------|------|--------|-----|
| A   | 7     | 1    | 2      | 4   |
| B   | 0     | —    | —      | —   |
| C   | 2     | —    | 2      | —   |
| D   | 0     | —    | —      | —   |
| E   | 2     | —    | 1      | 1   |
| F   | 2     | 1    | —      | 1   |
| G   | 1     | —    | 1      | —   |
| H   | 1     | 1    | —      | —   |

**Top 3 highest-impact fixes:**

1. **F1 + A6 + H1 (combined):** Add `Validator.create()` stamps to ~57 conductor intelligence modules, then replace all inline `Number.isFinite` guards (both silent-return and ternary-fallback patterns) with `V.requireFinite` / `V.optionalFinite`. This is the single largest coherence improvement available — it brings ~60 modules into alignment with the project's Validator convention, adds traceability to every thrown error, and eliminates Principle #2 violations.

2. **C1 + C2 + G1:** Add `rotate` and `p` to VALIDATED\_GLOBALS and remove the three `typeof` guards that become redundant. Small change, big convention alignment.

3. **A6 sub-finding:** Remove 4 redundant `Number.isFinite` guards on boot-validated globals (`beatStartTime`, `tpBeat`, `tpUnit`, `beatStart`). These directly contradict the "globals are truth" principle.
