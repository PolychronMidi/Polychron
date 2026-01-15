# composers.js - Musical Content Generation and Intelligence System

> **Source**: `src/composers.js`
> **Status**: Core Module - Music Theory
> **Dependencies**: backstage, venue, sheet

## Project Overview

**composers.js** is the **musical brain** of the Polychron system, responsible for generating all harmonic and melodic content. This file defines a sophisticated class hierarchy of composer objects that create musical materials based on scales, chords, modes, and advanced music theory principles.

## File Purpose

This module provides the **creative intelligence** for musical composition, handling:
- **Time signature generation** - Creates complex meters like 7/11, 5/3, 9/13
- **Note selection and harmony** - Generates musical pitches based on music theory
- **Rhythmic subdivision parameters** - Determines beat divisions and subdivisions
- **Voice management** - Controls polyphonic note density and octave ranges
- **Meter ratio calculations** - Ensures polyrhythmic relationships make musical sense

## Architecture Role

**composers.js** sits in the **content generation layer** of the Polychron architecture. It receives requests from **play.js** for musical parameters and returns structured musical data. The file is imported through **stage.js** and works closely with **venue.js** (for music theory data) and **time.js** (for timing calculations).

## Code Style Philosophy

Follows the same **"clean minimal"** philosophy as the rest of the project:
- **Compact class definitions** with essential functionality only
- **Direct method names** that clearly indicate their purpose
- **Minimal error handling** - focuses on valid musical output
- **Global scope integration** - seamlessly works with project-wide variables
- **Tonal.js integration** - leverages professional music theory library

## Class Hierarchy Overview

```
MeasureComposer (Base Class)
├── ScaleComposer
│   └── RandomScaleComposer
├── ChordComposer
│   └── RandomChordComposer
└── ModeComposer
    └── RandomModeComposer
```

## Base Class: MeasureComposer

### Purpose
**Abstract base class** that defines the common interface and core functionality for all musical composers. Handles meter generation, rhythmic parameters, and voice management.

### Key Properties
```javascript
constructor() {
  this.lastMeter = null;  // Stores previous time signature for smooth transitions
}
```

### Core Methods Analysis

#### `getNumerator()` - Beat Count Generation
```javascript
getNumerator(){const{min,max,weights}=NUMERATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
```
- **Generates time signature numerator** (beats per measure)
- **Uses weighted random selection** from configured range (typically 2-11)
- **BPM ratio modulation** - adjusts based on current tempo for musical coherence
- **Returns integer values** suitable for MIDI time signatures

#### `getDenominator()` - Beat Value Generation
```javascript
getDenominator(){const{min,max,weights}=DENOMINATOR;return m.floor(rw(min,max,weights)*(rf()>0.5?bpmRatio:1));}
```
- **Generates time signature denominator** (note value per beat)
- **Weighted selection** from configured range (typically 3-11)
- **Enables non-standard meters** like 7/5, 9/11, 13/3
- **BPM modulation** maintains musical flow across tempo changes

#### `getMeter()` - Time Signature Generation with Smoothing
```javascript
getMeter(ignoreRatioCheck = false, ignoreLastMeterCheck = false) {
  while (true) {
    let newNumerator = this.getNumerator();
    let newDenominator = this.getDenominator();
    let newMeterRatio = newNumerator / newDenominator;

    if ((newMeterRatio >= 0.3 && newMeterRatio <= 3)) {
      if (this.lastMeter && !ignoreRatioCheck) {
        let lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
        let ratioChange = m.abs(newMeterRatio - lastMeterRatio);
        if (ratioChange <= 0.75) {
          this.lastMeter = [newNumerator, newDenominator];
          return this.lastMeter;
        }
      } else {
        this.lastMeter = [newNumerator, newDenominator];
        return this.lastMeter;
      }
    }
  }
}
```
- **Most sophisticated method** - generates musically coherent time signatures
- **Meter ratio validation** - ensures new meters relate well to previous ones
- **Prevents jarring transitions** by limiting how much the meter can change
- **Ratio bounds checking** (0.3 ≤ ratio ≤ 3) keeps meters musically reasonable
- **Fallback mechanisms** when no suitable meter is found
- **Stores last meter** for continuity across phrases

#### `getNotes()` - Musical Content Generation
```javascript
getNotes(octaveRange=null) { const uniqueNotes=new Set();
  const voices=this.getVoices();
  const [minOctave,maxOctave]=octaveRange || this.getOctaveRange();
  const rootNote=this.notes[ri(this.notes.length - 1)];
  let intervals=[],fallback=false;
  try { const shift=ri();
    switch (ri(2)) {
      case 0:intervals=[0,2,3+shift,6-shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1)); break;
      case 1:intervals=[0,1,3+shift,5+shift].map(interval=>clamp(interval*m.round(this.notes.length / 7),0,this.notes.length-1)); break;
      default:intervals=Array.from({length:this.notes.length},(_,i)=>i); fallback=true; }
    return intervals.slice(0,voices).map((interval,index)=>{
      const noteIndex=(this.notes.indexOf(rootNote)+interval) % this.notes.length;
      let octave=ri(minOctave,maxOctave);
      let note=t.Note.chroma(this.notes[noteIndex])+12*octave;
      while (uniqueNotes.has(note)) {
        octave=octave < maxOctave ? octave++ : octave > minOctave ? octave-- : octave < OCTAVE.max ? octave++ : octave > OCTAVE.min ? octave-- : (()=>{ return false; })();
        if (octave===false) break; note=t.Note.chroma(this.notes[noteIndex])+12*octave; }
      return { note };
    }).filter((noteObj,index,self)=>
      index===self.findIndex(n=>n.note===noteObj.note)
    ); } catch (e) { if (!fallback) { return this.getNotes(octaveRange); } else {
      console.warn(e.message); return this.getNotes(octaveRange); }}
}
```
- **Abstract in base class** - implemented by subclasses
- **Voice management** - generates requested number of simultaneous notes
- **Octave distribution** - spreads voices across specified range
- **Chord tone selection** - uses music theory for harmonic content
- **Duplicate prevention** - ensures no note collisions
- **Fallback error handling** - recovers from invalid music theory combinations

## ScaleComposer Class

### Purpose
**Scale-based musical content generation**. Uses traditional musical scales (major, minor, modes, exotic scales) as the foundation for harmonic and melodic material.

### Key Features
```javascript
constructor(scaleName, root) {
  super();
  this.root = root;
  this.noteSet(scaleName, root);
}
noteSet(scaleName, root) {
  this.scale = t.Scale.get(`${root} ${scaleName}`);
  this.notes = this.scale.notes;
}
x = () => this.getNotes();
```
- **Inherits base functionality** from MeasureComposer
- **Scale specification** - takes scale name and root note as parameters
- **Tonal.js integration** - uses professional music theory library
- **Simple interface method** for generating notes from the scale

## RandomScaleComposer Class

### Purpose
**Dynamic scale selection**. Creates constantly changing harmonic content by randomly selecting different scales and root notes for each musical event.

```javascript
constructor() {
  super('','');
  this.noteSet();
}
noteSet() {
  const randomScale = allScales[ri(allScales.length - 1)];
  const randomRoot = allNotes[ri(allNotes.length - 1)];
  super.noteSet(randomScale, randomRoot);
}
x = () => { this.noteSet(); return super.x(); }
```
- **No fixed scale or root** - parameters are empty strings
- **Maximum harmonic variety** - every chord can be in a different key/scale
- **Reselects scale and root** before each note generation

## ChordComposer Class

### Purpose
**Chord progression-based composition**. Uses predefined chord sequences to create harmonic movement and musical structure.

### Key Features
```javascript
constructor(progression) {
  super();
  this.noteSet(progression, 'R');
}
noteSet(progression, direction='R') {
  const validatedProgression = progression.filter(chordSymbol => {
    if (!allChords.includes(chordSymbol)) {
      console.warn(`Invalid chord symbol: ${chordSymbol}`);
      return false;
    }
    return true;
  });
  // Complex progression navigation logic
}
```

### Chord Navigation Logic
```javascript
let next;
switch (direction.toUpperCase()) {
  case 'R': next = 1; break;
  case 'L': next = -1; break;
  case 'E': next = rf() < .5 ? 1 : -1; break;
  case '?': next = ri(-2, 2); break;
  default: next = 1;
}
```
- **Flexible progression movement** supports various harmonic rhythm patterns
- **Direction control**:
  - **'R'** (Right) - moves forward through progression
  - **'L'** (Left) - moves backward through progression
  - **'E'** (Either) - randomly chooses forward/backward
  - **'?'** - random jumps within progression
- **Modulo arithmetic** ensures progression loops properly

## RandomChordComposer Class

### Purpose
**Dynamic chord progression generation**. Creates new chord progressions on-the-fly, combining the harmonic structure of chord-based composition with the variety of random selection.

```javascript
noteSet() {
  const progressionLength = ri(2, 5);
  const randomProgression = [];
  for (let i = 0; i < progressionLength; i++) {
    const randomChord = allChords[ri(allChords.length - 1)];
    randomProgression.push(randomChord);
  }
  super.noteSet(randomProgression, '?');
}
```
- **Variable progression length** (2-5 chords) for structural variety
- **Random chord selection** from complete chord database
- **Random navigation ('?')** creates unpredictable harmonic movement
- **Builds complete progression** before passing to parent class

## ModeComposer and RandomModeComposer Classes

### Purpose
**Modal composition system**. Uses church modes and other modal systems for sophisticated harmonic content that goes beyond traditional major/minor tonality.

```javascript
// ModeComposer
noteSet(modeName, root) {
  this.mode = t.Mode.get(modeName);
  this.notes = t.Mode.notes(this.mode, root);
}

// RandomModeComposer
noteSet() {
  const randomMode = allModes[ri(allModes.length - 1)];
  const [root, modeName] = randomMode.split(' ');
  this.root = root;
  super.noteSet(modeName, root);
}
```
- **Uses Tonal.js Mode system** for authentic modal harmony
- **Dynamic modal composition** - constantly changes between different modes and roots
- **String parsing** to separate root and mode name from combined strings

## Global Composer Array Generation

### `composers` Array Creation
```javascript
composers = (function() {
  return COMPOSERS.map(composer =>
    eval(`(function() { return ${composer.return}; }).call({
      name:'${composer.name || ''}',
      root:'${composer.root || ''}',
      progression:${JSON.stringify(composer.progression || [])}
    })`)
  );
})();
```
- **Dynamic class instantiation** based on configuration from sheet.js
- **eval() execution** creates instances with proper context
- **Function.call() binding** provides access to configuration parameters
- **JSON serialization** handles complex progression arrays

## Music Theory Integration

### Tonal.js Dependencies
The composers rely heavily on the Tonal.js library for music theory:
- **Scale.get()** - Scale construction and validation
- **Chord.get()** - Chord construction and symbol parsing
- **Mode.get() / Mode.notes()** - Modal harmony systems
- **Note.chroma()** - Chromatic note number conversion

### Global Music Theory Arrays (from venue.js)
- **allNotes** - Complete chromatic scale with enharmonic equivalents
- **allScales** - All scales available in Tonal.js
- **allChords** - All possible chord symbols from all roots and chord types
- **allModes** - All modes with all possible root notes

## Performance Characteristics

- **Low computational cost** - Music theory calculations are cached
- **High musical variety** - Millions of possible harmonic combinations
- **Musically coherent output** - Follows music theory principles
- **Scalable complexity** - Works from simple triads to complex extended harmonies
- **Error recovery** - Graceful handling of invalid music theory combinations

## Integration with Timing System

**Composers work closely with time.js for**:
- **Meter validation** - Ensures generated time signatures work with MIDI
- **Polyrhythm calculation** - Helps determine compatible secondary meters
- **BPM ratio integration** - Scales complexity based on tempo
- **Musical continuity** - Smooth transitions between different harmonic areas

## Layer-Independent Operation

Composers operate **independently of LayerManager** architecture:
- **Shared across layers** - Same composer instance used for both primary and poly layers
- **Meter generation** - Creates time signatures without layer awareness
- **Global meter variables** - Works with numerator/denominator globals set by play.js
- **Rhythmic parameters** - getDivisions(), getSubdivisions(), etc. use current global state
- **Layer context blind** - Doesn't need to know which layer is active

This design keeps composer logic simple while enabling complex multi-layer compositions.
