<!-- AUTO-GENERATED: DO NOT EDIT. To regenerate run: 'node scripts/docs.js index' or 'npm run docs:fix' -->

# Documentation Index

Complete reference documentation for all Polychron modules.

---

## Core & Orchestration

- **[play](play.md)** — `play.ts` is the main composition engine that orchestrates the section→phrase→measure→beat hierarchy. It manages the global mutable state for composition nesting levels, initializes the DI container with core services, and drives the composition loop across all temporal divisions.

- **[playNotes](playNotes.md)** — `playNotes.ts` contains the `PlayNotes` class that handles MIDI note generation with advanced stutter/shift/octave-modulation effects. It calculates timing and velocity parameters based on hierarchical polyrhythm state and outputs notes to both subdivision and sub-subdivision timescales.

- **[stage](stage.md)** — `stage.ts` contains the `Stage` class, the main audio processing engine that manages MIDI event generation, binaural beat shifting, stutter effects, balance/pan randomization, and FX parameter automation. It delegates note generation to `PlayNotes` while managing all stage-level effects and instrument routing.

- **[writer](writer.md)** — `writer.ts` encapsulates MIDI output and CSV export functionality. It provides the main `p()` function for writing MIDI events to the global buffer, CSV serialization helpers, and output finalization (grandFinale). It acts as the final stage where composed note/CC events are persisted to files.

## Timing & Rhythm

- **[index](time/index.md)** — Documentation for this module.

- **[LayerManager](time/LayerManager.md)** — `LayerManager` (LM) coordinates multiple independent timing layers for simultaneous composition streams. It manages layer registration, activation, buffer switching, and timing state advancement. This enables rendering separate melodic/harmonic layers that progress independently but output to different MIDI buffers.

- **[rhythm](rhythm.md)** — `rhythm.ts` builds drum/rhythm patterns, converts between durations and time, and drives MIDI CC accents. It provides binary/hex rhythm parsing, probabilistic and Euclidean generators, drummer playback utilities, and FX stutter helpers.

- **[time](time.md)** — `time.ts` re-exports and wraps timing calculation functions from the `time/` subdirectory and backstage globals. It provides a unified API for calculating beat/division/subdivision timings, managing temporal distributions, and interfacing with the LayerManager for multi-layer timing coordination.

- **[TimingCalculator](time/TimingCalculator.md)** — `TimingCalculator` handles the conversion between arbitrary time signatures (including non-power-of-2 denominators) and MIDI-compatible meters. It calculates all timing constants (ticks per measure, ticks per second, sync factors) needed for accurate MIDI rendering.

- **[TimingContext](time/TimingContext.md)** — `TimingContext` encapsulates all timing-related state for a single composition layer (phrase/measure/beat timing, polyrhythm ratios, on/off counts, tempo). Each layer maintains its own TimingContext instance, allowing independent timing progression while writing to separate MIDI buffers.

- **[TimingTree](TimingTree.md)** — `TimingTree.ts` provides a hierarchical tree structure for managing timing state across the composition hierarchy (sections, phrases, measures, beats, divisions, subdivisions). It enables rapid lookup of timing values, sync between global state and tree, and per-layer isolation for multi-layer rendering.

## Composition

- **[ChordComposer](composers/ChordComposer.md)** — `ChordComposer.ts` generates chord tones from a progression, supporting normalization, validation, and directional traversal. A random variant regenerates a new progression on each tick.

- **[ComposerRegistry](ComposerRegistry.md)** — `ComposerRegistry.ts` is the singleton registry that wires composer **type keys** (e.g., `scale`, `chords`, `mode`) to factory functions that construct composers. It centralizes registration, lookup, and default wiring for built-in composers while allowing custom composer injection.

- **[composers](composers.md)** — `composers.ts` is a stub module that re-exports composer classes and the registry from the global scope. It allows downstream modules to import composers via a single stable entry point rather than from the internal `composers/` subdirectory.

- **[GenericComposer](composers/GenericComposer.md)** — `GenericComposer.ts` provides the shared machinery for scale-like composers (scale, mode, chord, pentatonic). It handles item bookkeeping, delegates note generation to the MeasureComposer engine, and offers a randomized variant base. Subclasses only implement `itemSet()` to fetch a Tonal entity and populate `notes`.

- **[index](composers/index.md)** — `composers/index.ts` serves as the central export point for all composer classes and types from the composers subdirectory. It re-exports the individual composer implementations to provide a unified interface for importing composition strategies.

- **[MeasureComposer](composers/MeasureComposer.md)** — `MeasureComposer.ts` is the rhythmic and voice-leading backbone for all composers. It generates meters, subdivisions, and note selections with randomization, voice-leading scoring, and guardrails against invalid meters. Higher-level composers supply pitch collections while MeasureComposer shapes timing and registers.

- **[ModeComposer](composers/ModeComposer.md)** — `ModeComposer.ts` generates melodies from Tonal modes with scale fallback. It shares the GenericComposer rhythm/voice-leading engine and includes a random variant for exploring all modes.

- **[PentatonicComposer](composers/PentatonicComposer.md)** — `PentatonicComposer.ts` builds melodies from major or minor pentatonic collections, inheriting rhythm/voice-leading from GenericComposer. A random variant swaps root and pentatonic type on each tick.

- **[ProgressionGenerator](composers/ProgressionGenerator.md)** — `ProgressionGenerator.ts` converts Roman numeral patterns into concrete chord symbols for a given key/mode. It normalizes qualities (major/minor), handles accidentals, and ships with common patterns plus a random picker.

- **[ScaleComposer](composers/ScaleComposer.md)** — `ScaleComposer.ts` builds melodic material from a chosen scale and root, leveraging GenericComposer for rhythm/voice leading. A random variant picks both scale and root from global pools.

## Music Theory

- **[index](voiceLeading/index.md)** — Documentation for this module.

- **[motifs](motifs.md)** — `motifs.ts` defines the `Motif` class and helpers to create, transform, and apply melodic motifs to note streams. It offers inversion, transposition, augmentation/diminution, reversal, probabilistic development, and safe note clamping to keep pitches in range.

- **[venue](venue.md)** — `venue.ts` provides music theory constants, MIDI data tables, and lookup functions for scales, chords, modes, and pitch mappings. It centralizes all music theory knowledge to avoid duplication and ensure consistency across composers.

- **[voiceLeading](voiceLeading.md)** — `voiceLeading.ts` provides utilities for maintaining smooth voice leading across chord changes and harmonic progressions. It coordinates smooth pitch changes, handles voice doubling, avoids parallel fifths/octaves, and ensures smooth voice independence across staves/channels.

- **[VoiceLeadingScore](voiceLeading/VoiceLeadingScore.md)** — `VoiceLeadingScore` implements classical voice leading rules with cost-based optimization. It evaluates chord changes for smoothness (minimizing voice jumps), checks voice range constraints, enforces leap recovery rules, detects voice crossing, and avoids parallel fifths/octaves.

## Configuration

- **[PolychronConfig](PolychronConfig.md)** — Configuration schema and defaults for composition.

- **[PolychronContext](PolychronContext.md)** — Rich runtime context combining DI, event bus, cancellation, and state.

- **[PolychronInit](PolychronInit.md)** — Initialization and entry point utilities.

- **[structure](structure.md)** — `structure.ts` defines section types, profiles, and helpers that shape the overall composition structure at the section level. It provides section type normalization, random selection, and profile resolution to determine section characteristics (type, phrase count, BPM scale, dynamics, motifs).

## Infrastructure

- **[.TEMPLATE](.TEMPLATE.md)** — [1-2 paragraph explanation of what this module does and why it exists]

- **[backstage](backstage.md)** — `backstage.ts` provides the **foundational infrastructure** for the entire Polychron system. It exports re-usable utilities, defines global timing state, manages MIDI channel constants, and provides channel grouping logic for binaural beats and effects routing.

- **[CancellationToken](CancellationToken.md)** — `CancellationToken.ts` provides a lightweight, cooperative cancellation mechanism for long-running or asynchronous operations. It enables callers to request cancellation and callee code to check and respond without forcing abrupt termination.

- **[CompositionContext](CompositionContext.md)** — `CompositionContext.ts` constructs and threads a single context object containing state, services, timing/logging hooks, and progress/cancellation wiring. It also provides helpers to sync this context to globals for certain initialization flows.

- **[CompositionProgress](CompositionProgress.md)** — `CompositionProgress.ts` defines the progress phases, payloads, cancellation token, and a lightweight event bus for UI/controllers to observe composition state. It separates progress reporting from the main event bus and provides a simple cancellation hook.

- **[CompositionState](CompositionState.md)** — `CompositionState.ts` defines the full mutable state for a composition run, covering sections, phrases, measures, beats, subdivisions, timing, rhythms, polyrhythms, active composer/motif, and binaural/stutter parameters. The `CompositionStateService` implements the interface and provides sync/reset helpers.

- **[DIContainer](DIContainer.md)** — `DIContainer.ts` provides a minimal dependency injection container supporting singleton and transient lifecycles. It is used to register factories, resolve services, and manage a global container for convenience in tests and optional global access.

- **[EventBus](EventBus.md)** — `EventBus.ts` provides a typed, singleton event bus for composition lifecycle events. It supports sync/async emission, one-time listeners, bounded history, and helper emitters for common lifecycle signals.

- **[fxManager](fxManager.md)** — `fxManager.ts` encapsulates rapid stutter effects for volume, pan, and FX parameters, keeping recent channel usage to avoid repetition. It emits MIDI CC events to drive fades, pans, and FX automation and exposes a singleton instance.

- **[index](validators/index.md)** — `validators/index.ts` provides type guards, assertion functions, and comprehensive validation for Polychron's core types. It uses TypeScript's `is` and `asserts` keywords for proper type narrowing and runtime type checking.

- **[ModuleInitializer](ModuleInitializer.md)** — System startup and module registration.

- **[PolychronError](PolychronError.md)** — `PolychronError.ts` provides a centralized error handling system with categorized error codes, context metadata, and factory functions. It replaces ad-hoc console warnings with properly typed exceptions that can be caught, logged, and reported.

- **[sheet](sheet.md)** — `sheet.ts` provides lightweight helpers to map composition structures into staff-like representations and feed them into note rendering utilities. It exports type aliases and wrapper functions to keep sheet rendering in sync with structure definitions.

- **[test](test.md)** — Documentation for this module.

- **[test-setup](test-setup.md)** — Documentation for this module.

- **[utils](utils.md)** — `utils.ts` exports common utility functions used throughout Polychron: random number generation (`rf`, `ri`, `ra`, `rv`, `rl`), clamping, modulo arithmetic, and probability helpers. These functions simplify common operations across the codebase and reduce redundancy.

- **[validators](validators.md)** — Documentation for this module.

---

**Note**: All source modules in `/src` have corresponding documentation in `/docs`. Documentation is automatically validated to ensure 1:1 coverage via the code-quality test suite.
