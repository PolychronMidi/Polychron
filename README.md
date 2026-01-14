# Polychron

Polychron is an advanced MIDI composition system that breaks free from traditional MIDI limitations, particularly in the realm of time signatures (meters). The core innovation lies in its ability to work with any musical meter through a process called "meter spoofing" while maintaining compatibility with standard MIDI playback systems.

## Key Features

- **Unrestricted Meter Support**: Any musical meter (time signature) including complex and non-standard ratios
- **Polyrhythm Capability**: Simultaneous dual-meter composition with perfect timing alignment
- **Multi-Layer Architecture**: CSVBuffer and LayerManager enable transparent context switching between layers
- **Absolute Timing Accuracy**: Dual-context architecture ensures phrase boundaries align perfectly in absolute time
- **Advanced Music Theory**: Integration with Tonal.js for scales, chords, modes, and music theory operations
- **Binaural Beat Effects**: Alpha range (8-12Hz) binaural beats with headphone spatialization
- **Extreme Granularity**: Support for subdivisions beyond traditional 128th notes
- **Dynamic Composition**: Weighted random selection, algorithmic rhythm generation, and adaptive musical intelligence

## Comprehensive File Review

### Core System Architecture

Polychron consists of 9 specialized JavaScript modules following a clean minimal code philosophy:

#### 1. **[play.js](play.md)** - Main Composition Engine
- Orchestrates the entire composition process
- Implements dual-context architecture for primary and poly meters
- Manages phrase-level timing synchronization
- Coordinates all modules to generate complete MIDI compositions
- Handles section/phrase/measure hierarchy with perfect timing alignment

#### 2. **[composers.js](composers.md)** - Musical Intelligence System
- **MeasureComposer**: Base class for meter and division generation
- **ScaleComposer**: Generates notes from specific scales with octave ranges
- **RandomScaleComposer**: Random scale selection from all available scales
- **ChordComposer**: Chord progression-based composition with validation
- **RandomChordComposer**: Generates random chord progressions (2-5 chords)
- **ModeComposer**: Mode-based composition with root note support
- **RandomModeComposer**: Random mode selection from all available modes
- Advanced music theory integration with Tonal.js
- Logarithmic ratio validation for smooth meter transitions
- Weighted random selection for all musical parameters

#### 3. **[rhythm.js](rhythm.md)** - Rhythmic Pattern Generation
- **Drum Mapping**: 25+ drum instruments with velocity ranges
- **Drummer Function**: Advanced drum pattern generation with stutter effects
- **Rhythm Patterns**: Binary, hex, onsets, random, Euclidean, rotate, morph
- **Algorithmic Generation**: Weighted selection from rhythm library
- **Context-Aware Programming**: Different patterns for primary vs poly meters
- **Tonal.js Integration**: Uses @tonaljs/rhythm-pattern for core algorithms
- **Dynamic Adaptation**: Rhythm complexity adjusts based on meter and tempo

#### 4. **[time.js](time.md)** - Timing Engine & Meter Spoofing
- **Core Innovation**: "Meter spoofing" technology for any meter support
- **Dual-Context Architecture**: Independent timing for primary and poly meters
- **Polyrhythm Calculation**: Finds optimal measure alignments between meters
- **Absolute Timing**: Phrase boundaries align perfectly in seconds
- **Hierarchical Timing**: Section → Phrase → Measure → Beat → Division → Subdivision → Subsubdivision
- **MIDI Compatibility**: Converts any denominator to nearest power-of-2
- **Tempo Synchronization**: Adjusts BPM to preserve actual meter durations
- **Comprehensive Logging**: Timing markers with context awareness

#### 5. **[stage.js](stage.md)** - Audio Processing Engine
- **Binaural Beat Generation**: Alpha range (8-12Hz) with pitch bend effects
- **Stutter Effects**: Three types (fade, pan, FX) with adaptive parameters
- **Spatial Audio**: Left/right balance variation and channel mapping
- **Instrument Management**: Program changes, pitch bend, volume control
- **MIDI Event Creation**: Comprehensive note on/off and control change events
- **Channel Tracking**: Avoids repetition with last-used channel tracking
- **Dynamic FX Processing**: Randomized effect parameters with constraints

#### 6. **[backstage.js](backstage.md)** - Core Utilities & State
- **Mathematical Utilities**: 15+ clamping functions (regular, mod, soft, step, log, exp)
- **Randomization Systems**: Weighted, dual-range, limited-change random functions
- **Global State Management**: Timing contexts for primary and poly meters
- **MIDI Infrastructure**: Channel definitions, instrument mappings, constants
- **Data Structures**: CSV row management, array utilities
- **MIDI Helper Functions**: `allNotesOff()` and `muteAll()` for channel cleanup
- **Performance Optimization**: Efficient state tracking and memory management

#### 7. **[writer.js](writer.md)** - MIDI Output & File Generation
- **CSVBuffer Class**: Encapsulates MIDI event arrays with layer metadata (rows, name properties)
- **pushMultiple (p)**: Efficient batch MIDI event insertion with validation
- **Timing Markers**: Context-aware logUnit() for debugging and analysis
- **File Generation**: grandFinale() converts CSVBuffer to MIDI .mid files
- **Filesystem Operations**: Wrapped fs module with error handling and logging
- **Integration Utilities**: Seamless connection between composition and output
- **Performance Optimization**: Efficient CSV-to-MIDI conversion via csv_maestro

#### 8. **[venue.js](venue.md)** - MIDI Data & Music Theory
- **Complete MIDI Reference**: All 128 program change instruments
- **MIDI Control Changes**: Full CC mapping with descriptions
- **Tonal.js Integration**: Music theory databases (scales, chords, modes)
- **Enharmonic Normalization**: Standardized note naming
- **Lookup Functions**: MIDI value retrieval by name
- **Global Exports**: Music theory data exposed for testing
- **Validation Systems**: Chord and scale validation

#### 9. **[sheet.js](sheet.md)** - Configuration System
- **Musical Parameters**: BPM, PPQ, tuning frequency (432Hz)
- **Weighted Distributions**: Numerators, denominators, octaves, voices
- **Structural Parameters**: Sections, phrases per section, divisions
- **Instrument Settings**: Primary, secondary, bass instruments
- **Binaural Configuration**: Frequency ranges and effects
- **Logging Controls**: Timing marker granularity
- **Composer Configuration**: Available composer types and weights

## Technical Innovations

### Multi-Layer Architecture
- **CSVBuffer Class** (writer.js): Each layer (primary, poly) has its own CSVBuffer instance encapsulating MIDI event array
- **LayerManager (LM)** (time.js): Context switching object managing per-layer timing state
- **Global State Pattern**: Shared variables (phraseStart, tpMeasure, etc.) switched between layer contexts
- **Transparent Integration**: p(c) syntax allows code to work with active layer's buffer automatically
- **Independent Timing**: Each layer maintains separate timing state via LM.layers[name].state
- **Automatic Restoration**: LM.activate() switches global variables to target layer's preserved values

### Dual-Context Timing Architecture
- **Primary Context**: Main meter with full timing calculation
- **Poly Context**: Independent timing recalculation for polyrhythm
- **Shared Timestamps**: Both contexts use accumulated `phraseStartTime` (absolute seconds)
- **Independent Tick Rates**: Each meter has its own `tpSec` (ticks/second)
- **Perfect Alignment**: Phrase boundaries match in absolute time despite different tick counts
- **Cascading Calculations**: Formula pattern: currentStart = parentStart + currentIndex × currentDuration
- **Timing Hierarchy**: Section → Phrase → Measure → Beat → Division → Subdivision → Subsubdivision (7 levels)

### Meter Spoofing Technology
1. **Actual Meter**: Any ratio (e.g., 7/9 = 0.777...)
2. **MIDI Meter**: Nearest power-of-2 denominator (e.g., 7/8 = 0.875)
3. **Sync Factor**: `midiMeterRatio / meterRatio` (e.g., 0.875/0.777 = 1.126)
4. **Tempo Adjustment**: `midiBPM = BPM * syncFactor`
5. **Duration Preservation**: MIDI plays at adjusted tempo to match actual meter duration

### Polyrhythm Calculation
- **Mathematical Alignment**: Finds where measure boundaries align between meters
- **Optimal Solutions**: Tests combinations to find tightest polyrhythms
- **Tolerance Validation**: Ensures alignment within 0.00000001 precision
- **Complexity Management**: Limits to reasonable measure counts (1-5)
- **Musical Context**: Preserves musical relationships between meters

### Advanced Randomization
- **Weighted Selection**: Probability distributions for all parameters
- **Dual-Range Support**: Simultaneous selection from multiple ranges
- **Limited Change**: Constrained variation for smooth transitions
- **Context-Aware**: Adapts based on current musical context
- **Variation Systems**: Random variation with frequency control

### Binaural Beat System
- **Alpha Range**: 8-12Hz frequency offsets
- **Pitch Bend Calculation**: Converts frequency to MIDI pitch bend values
- **Channel Mapping**: Left/right channel assignments for spatial effects
- **Volume Crossfades**: Smooth transitions between binaural states
- **Instrument Variation**: Random program changes for diversity

### Stutter Effects Engine
- **Three Effect Types**: Fade (volume), Pan (stereo), FX (parameter)
- **Adaptive Parameters**: Number of stutters, duration, decay factors
- **Channel Tracking**: Avoids repetition with usage tracking
- **Dynamic Application**: Randomized application with probability control
- **Musical Integration**: Synchronized with rhythmic structure

## Installation & Usage

### Prerequisites
- Node.js (for JavaScript execution)
- Python (for CSV to MIDI conversion)
- MIDI player with soundfont support

### Setup
```bash
npm install tonal @tonaljs/rhythm-pattern
```

### Composition Generation
```bash
node play.js
```

### MIDI Conversion
```bash
python c2m.py
```

### Audio Rendering
For extreme data density files, use:
```bash
python c2m.py && ffmpeg -i output.mid -f wav output.wav
```

## Performance Characteristics

### Timing Accuracy
- **Absolute Precision**: Phrase alignment within 0.001 seconds
- **Dual-Context Sync**: Verified timing synchronization between meters
- **Hierarchical Consistency**: Perfect nesting of timing hierarchies

### System Complexity
- **Musical Dimensions**: 7 levels of rhythmic hierarchy
- **Parameter Space**: 100+ configurable parameters
- **Compositional Depth**: Unlimited polyrhythmic complexity
- **Data Density**: Supports extreme note granularity

### Resource Utilization
- **Memory Efficient**: Clean minimal code philosophy
- **CPU Optimization**: Efficient algorithms and caching
- **Scalability**: Handles complex compositions without performance degradation

## Future Development

### Planned Enhancements
- **Motif System**: Thematic development and variation
- **Section Types**: Introduction, exposition, development, conclusion, fugue
- **Advanced Music Theory**: Counterpoint, voice leading, harmonic analysis
- **Machine Learning**: Adaptive composition based on musical analysis
- **Real-time Processing**: Live performance capabilities
- **Visualization**: Graphical representation of complex rhythms

### Research Directions
- **Microtonal Support**: Beyond 12-tone equal temperament
- **Temporal Modulation**: Dynamic tempo changes within phrases
- **Spatial Audio**: 3D positioning and ambisonics
- **Cross-Modal Integration**: Audio-visual synchronization
- **Cognitive Studies**: Perception of complex polyrhythms
- **Algorithmic Composition**: Advanced generative algorithms

## Technical Documentation

Each module has a comprehensive .md file with verbose architectural details:
- **play.md**: LayerManager context switching, timing increment hierarchy, cascading formulas
- **backstage.md**: CSVBuffer/LayerManager API reference, context switching patterns
- **time.md**: setUnitTiming() deep dive, all 7 timing level formulas, delicate dependencies
- **composers.md**: Layer-independent operation with shared global state
- **rhythm.md**: CSVBuffer integration with transparent buffer switching
- **sheet.md**: Global configuration applying across all layers
- **stage.md**: CSVBuffer layer integration with no layer conditionals
- **venue.md**: Pure data module, completely independent of LayerManager

Code files maintain ultra-minimalist style with sparse essential comments.

## Community & Resources

- **[Tonal.js](https://github.com/tonaljs/tonal)**: Music theory library
- **[CSV Maestro](https://github.com/i1li/csv_maestro)**: Custom MIDI CSV converter
- **[Soundfont MIDI Player](https://soundfont-midi-player.en.softonic.com)**: Recommended player
- **[Virtual MIDI Synth](https://coolsoft.altervista.org/virtualmidisynth)**: Audio rendering
- **[LibreOffice](https://libreoffice.org/)**: CSV file editing

## License

Polychron is open source software designed for musical innovation and research. The system represents a significant advancement in algorithmic composition, particularly in the domain of complex rhythmic structures and polyrhythmic composition.

---

**Note**: This comprehensive review covers all JavaScript files in the Polychron system, highlighting the sophisticated architecture, innovative technologies, and advanced musical capabilities. The system demonstrates exceptional technical depth while maintaining clean, minimal code organization.

## Installation & Usage

To install tonal and create the CSV file, run the following (requires Node.js installed):
```js
npm i tonal
node play.js
```

To create the MIDI file from the CSV, run the following (requires Python installed):
```python
py c2m.py
```

<span id="players">
You'll need a MIDI player with a soundfont installed to play MIDI files. Standard midi players may have playback issues due to data overload, the following have been tested to work:

[Soundfont MIDI Player](https://soundfont-midi-player.en.softonic.com)

[MIDI Editor](https://github.com/jingkaimori/midieditor)

Note that accurate MIDI playback may not be possible on some devices due to extreme data density. In this case you can just render the MIDI file as typical audio formats like MP3, WAV, or FLAC with:

[Virtual MIDI Synth](https://coolsoft.altervista.org/virtualmidisynth)

</span><br>
[LibreOffice](https://libreoffice.org/) is a good program for CSV files.

Here's a list of [music related repos](https://github.com/stars/i1li/lists/music) I've saved for inspiration.

Other music projects that I haven't found repos for:
[GenJam by Al Biles](https://genjam.org/)
