# Polychron Documentation Wiki

> **Last Updated**: 2024-01-15
> **Documentation Version**: 1.0.0
> **Project Status**: Production Ready

## 📚 Wiki Navigation

Welcome to the Polychron documentation wiki! This is a comprehensive, cross-linked knowledge base for the Polychron MIDI composition system.

### 🎼 Getting Started

- **[play.js](play.md)** - Main composition engine and entry point
- **[sheet.js](sheet.md)** - Configuration and musical parameters
- **[README](../README.md)** - Project overview and npm scripts

---

## 🏗️ Architecture Overview

### Core Composition Layer
The highest-level modules that orchestrate musical generation:

1. **[play.js](play.md)** - Main conductor
   - Entry point for the entire system
   - Orchestrates all components in sequence
   - Manages the composition loop

2. **[composers.js](composers.md)** - Musical intelligence
   - Generates scales, chords, and modes
   - Creates harmonic content
   - Works with music theory (Tonal.js)

3. **[rhythm.js](rhythm.md)** - Rhythmic patterns
   - Creates beat divisions and subdivisions
   - Generates polyrhythmic patterns
   - Coordinates with timing system

### Core Processing Layer
Deep system operations for audio and timing:

1. **[stage.js](stage.md)** - Audio processing engine
   - Applies effects (reverb, delay, binaural beats)
   - Manages MIDI channels
   - Handles stutter and modulation effects

2. **[time.js](time.md)** ⭐ **Innovation**
   - **Revolutionary**: Supports ANY time signature in MIDI
   - Implements meter spoofing algorithm
   - Manages timing context and layers
   - Synchronizes polyrhythmic content

### Foundation Layer
Essential utilities and infrastructure:

1. **[backstage.js](backstage.md)** - Core utilities
   - Mathematical functions (clamp, modulo, randomization)
   - Global state management
   - MIDI infrastructure and channel definitions

2. **[writer.js](writer.md)** - Output layer
   - CSV buffer management
   - MIDI event collection
   - File generation and output

3. **[sheet.js](sheet.md)** - Configuration
   - Instrument assignments
   - Musical parameters
   - System settings and logging

4. **[venue.js](venue.md)** - MIDI reference
   - MIDI constants and mappings
   - Instrument definitions (128 GM sounds)
   - Music theory data

---

## 🔗 Cross-Reference Index

### By Category

#### **Core Innovation: Time Signatures**
- [time.js - Timing Engine](time.md)
  - How it achieves infinite time signature support
  - Meter ratio conversion algorithm
  - Multi-layer timing architecture

#### **Audio Processing**
- [stage.js - Effects Engine](stage.md)
  - Binaural beat generation
  - Stutter effects
  - Pitch modulation

#### **Musical Content**
- [composers.js - Harmony Generation](composers.md)
- [rhythm.js - Beat Generation](rhythm.md)
- [venue.js - Music Theory Data](venue.md)

#### **System Infrastructure**
- [backstage.js - Utilities](backstage.md)
- [writer.js - Output](writer.md)
- [sheet.js - Configuration](sheet.md)

---

## 📊 Module Dependency Graph

```
play.js (Main Entry)
├── stage.js (Audio Processing)
│   ├── backstage.js (Utils)
│   ├── writer.js (Output)
│   ├── sheet.js (Config)
│   ├── composers.js (Harmony)
│   ├── rhythm.js (Rhythm)
│   ├── time.js (Timing)
│   └── venue.js (MIDI Data)
├── composers.js (Harmony Generation)
│   ├── backstage.js
│   ├── venue.js
│   └── sheet.js
├── rhythm.js (Rhythm Generation)
│   ├── backstage.js
│   ├── venue.js
│   └── sheet.js
├── time.js (Timing)
│   └── backstage.js
├── backstage.js (Foundation)
└── venue.js (MIDI Constants)
```

---

## 🔍 Quick Search Guide

### By Function Type

**Mathematical Utilities**
- Clamping functions: [backstage.js](backstage.md#advanced-mathematical-utility-functions)
- Random number generation: [backstage.js](backstage.md)
- Pitch calculations: [stage.js](stage.md)

**Musical Generation**
- Scale/chord creation: [composers.js](composers.md)
- Meter generation: [composers.js](composers.md)
- Beat subdivision: [rhythm.js](rhythm.md)

**MIDI Operations**
- Event writing: [writer.js](writer.md#push-operations)
- Channel management: [stage.js](stage.md)
- Timing markers: [writer.js](writer.md#timing-markers)

**Configuration**
- Instruments: [sheet.js](sheet.md)
- Parameters: [sheet.js](sheet.md)
- MIDI mappings: [venue.js](venue.md)

---

## 📖 Reading Paths

### Path 1: Understanding the System
1. Start with [play.js](play.md) - See the big picture
2. Read [composers.js](composers.md) - How music is generated
3. Study [time.js](time.md) - The revolutionary timing system
4. Explore [stage.js](stage.md) - How audio is processed
5. Reference [venue.js](venue.md) - Available instruments and constants

### Path 2: Implementing Features
1. Review [sheet.js](sheet.md) - Configuration system
2. Study [composers.js](composers.md) - Content generation logic
3. Check [rhythm.js](rhythm.md) - Pattern algorithms
4. Reference [backstage.js](backstage.md) - Utility functions

### Path 3: Extending Output
1. Understand [writer.js](writer.md) - Output infrastructure
2. Review [stage.js](stage.md) - Processing pipeline
3. Check [time.js](time.md) - Timing context
4. Reference [venue.js](venue.md) - MIDI standards

---

## 🎯 Key Features

### ⭐ Infinite Time Signature Support
Polychron can generate compositions in ANY time signature, including those with prime denominators (7/11, 5/13, etc.). This is achieved through the **meter spoofing algorithm** in [time.js](time.md).

### 🎹 Multi-Layer Composition
The system supports multiple simultaneous musical layers with independent timing contexts, implemented in the [LayerManager](time.md) in time.js.

### 🎨 Advanced Audio Effects
- Binaural beat generation (psychoacoustic effects)
- Dynamic stuttering with frequency modulation
- Pitch bending and tuning system adjustments
- See [stage.js](stage.md) for details

### 🎼 Sophisticated Music Theory
- Integration with Tonal.js for professional music theory
- Chord and scale generation
- Mode creation and harmonic content
- See [composers.js](composers.md) for details

---

## 📋 Module Statistics

| Module | Size | Lines | Purpose |
|--------|------|-------|---------|
| play.js | Core | ~323 | Main orchestrator |
| composers.js | ~332 | Music theory | Content generation |
| stage.js | ~208 | Audio | Effects processing |
| time.js | ~549 | Timing | Meter spoofing |
| writer.js | ~424 | Output | MIDI generation |
| venue.js | ~255 | Reference | MIDI constants |
| rhythm.js | Compact | Rhythm | Beat patterns |
| sheet.js | Compact | Config | Parameters |
| backstage.js | Compact | Utilities | Core functions |

---

## 🚀 Running the System

The main command to generate a composition:
```bash
npm run play
```

This executes:
1. Loads all modules in proper dependency order
2. Runs the composition algorithm from play.js
3. Generates MIDI events through the processing pipeline
4. Outputs CSV and MIDI files via writer.js

See [README.md](../README.md) for complete npm script documentation.

---

## 🔗 External Resources

- **[Tonal.js](https://github.com/tonaljs/tonal)** - Music theory library used by composers.js
- **[MIDI Specification](https://en.wikipedia.org/wiki/MIDI)** - Reference for MIDI implementation in venue.js
- **[Binaural Beats](https://en.wikipedia.org/wiki/Binaural_beats)** - Audio effect implemented in stage.js

---

## 📝 Documentation Maintenance

This wiki is auto-generated from markdown files in the `docs/` directory. Each module has:
- **Source Location**: Points to the corresponding src/ file
- **Status**: Current development status
- **Dependencies**: Lists all module dependencies
- **Comprehensive Documentation**: Detailed function descriptions and usage examples

### Contributing to Documentation
When modifying module code, please update the corresponding .md file in `docs/` with:
1. Changes to function signatures
2. New features or modifications
3. Updated examples or diagrams
4. Any architectural changes

---

**Navigation**: [Home](#) | [Architecture](#architecture-overview) | [Modules](#-architecture-overview)

---
*Polychron Documentation Wiki - Last generated: 2024-01-15*
