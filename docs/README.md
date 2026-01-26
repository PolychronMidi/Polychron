<!-- AUTO-GENERATED: DO NOT EDIT. To regenerate run: 'node scripts/docs.js index' or 'npm run docs:fix' -->

# Documentation Index

Complete reference documentation for all Polychron modules.

---

## Core & Orchestration

- **[play](play.md)** — Documentation for this module.

- **[stage](stage.md)** — **stage.js** ([code](../src/stage.js)) ([doc](stage.md))** ([code](../src/stage.js ([code](../src/stage.js)) ([doc](stage.md)))) ([doc](stage.md)) is the **audio engine** of Polychron, transforming abstract musical concepts into MIDI events. It generates binaural beats, applies sophisticated effects (stutter, pan, modulation), manages instruments across 16 MIDI channels, and orchestrates all real-time audio processing.

- **[writer](writer.md)** — **writer.js** ([code](../src/writer.js)) ([doc](writer.md))** ([code](../src/writer.js ([code](../src/writer.js)) ([doc](writer.md)))) ([doc](writer.md)) handles all MIDI file output - CSV buffer management, timing marker logging, and final file generation. It encapsulates the "writing to disk" functionality that transforms in-memory MIDI events into playable MIDI files.

## Timing & Rhythm

- **[rhythm](rhythm.md)** — **rhythm.js** ([code](../src/rhythm.js)) ([doc](rhythm.md))** ([code](../src/rhythm.js ([code](../src/rhythm.js)) ([doc](rhythm.md)))) ([doc](rhythm.md)) generates complex rhythmic patterns and drum sequences. It combines algorithmic pattern generation with sophisticated drum programming to create percussion that would be impossible for human drummers.

- **[time](time.md)** — **time.js** ([code](../src/time.js)) ([doc](time.md))** ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)) is the **temporal engine** of Polychron, handling all timing calculations, meter management, and the revolutionary "meter spoofing" technology that enables **any time signature** to work within MIDI constraints.

## Composition

- **[composers](composers.md)** — **composers.js** ([code](../src/composers.js)) ([doc](composers.md))** ([code](../src/composers.js ([code](../src/composers.js)) ([doc](composers.md)))) ([doc](composers.md)) generates all musical content - notes, harmonies, time signatures, and voice counts. It provides a class hierarchy of composers that generate harmonically sophisticated music based on scales, chords, and modes.

## Music Theory

- **[motifs](motifs.md)** — `motifs.js` introduces a lightweight motif system for interval-based transformations and thematic development. A motif is represented as an ordered sequence of `{ note, duration }` events that can be transposed, inverted, augmented/diminished, reversed, or developed into new variants. Motifs can be applied to generated notes to imprint interval shapes onto composer output.

- **[venue](venue.md)** — **venue.js** ([code](../src/venue.js)) ([doc](venue.md))** ([code](../src/venue.js ([code](../src/venue.js)) ([doc](venue.md)))) ([doc](venue.md)) is the **music theory and MIDI database** for Polychron. It provides comprehensive General MIDI data, music theory constants from Tonal.js, and lookup utilities for converting between human-readable names and MIDI numbers.

- **[voiceLeading](voiceLeading.md)** — Voice leading is the musical art of smoothly connecting notes across voices, minimizing large leaps and awkward voice crossing. This implementation provides a **cost function optimizer** that scores candidate notes using weighted penalties for common voice leading violations.

## Infrastructure

- **[backstage](backstage.md)** — **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md))** ([code](../src/backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)))) ([doc](backstage.md)) provides the foundation for all other modules - mathematical utilities, randomization systems, global state, and MIDI infrastructure. It's the first file loaded, establishing the environment for everything else.

- **[fxManager](fxManager.md)** — FxManager manages three types of stutter effects applied to MIDI channels:

- **[sheet](sheet.md)** — Documentation for this module.

- **[test](test.md)** — Documentation for this module.

---

**Note**: All source modules in `/src` have corresponding documentation in `/docs`. Documentation is automatically validated to ensure 1:1 coverage via the code-quality test suite.
