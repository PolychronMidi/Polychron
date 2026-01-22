# ProgressionGenerator.ts - Roman Numeral Progression Builder

> **Status**: Utility Composer Helper  
> **Dependencies**: Tonal Key/Scale/Note


## Overview

`ProgressionGenerator.ts` converts Roman numeral patterns into concrete chord symbols for a given key/mode. It normalizes qualities (major/minor), handles accidentals, and ships with common patterns plus a random picker.

**Core Responsibilities:**
- Build diatonic scale/chord lists for major and minor keys (including modal aliases)
- Translate Roman numerals (with accidentals/extensions) into chord symbols
- Generate named progression patterns or pick a random one per quality

## Architecture Role

- Upstream utility for ChordComposer when you want canonical Roman-numeral progressions
- Helps tests and examples produce predictable chord progressions

---

## API

### `class ProgressionGenerator`

Roman-numeral-to-chord converter with preset patterns.

<!-- BEGIN: snippet:ProgressionGenerator -->

```typescript
class ProgressionGenerator {
  key: string;
  quality: string;
  scale: any;
  romanQuality: string;
  scaleNotes: string[];
  diatonicChords: string[];
  _t: any;
  _ri: any;

  constructor(key: string, quality: string = 'major', deps?: { t?: any; ri?: any }) {
    this.key = key;
    this.quality = quality.toLowerCase();

    const _tLocal = (deps && deps.t) || tonal;
    const riLocal = (deps && deps.ri) || ri;

    this._t = _tLocal;
    this._ri = riLocal;

    this.scale = _tLocal.Scale.get(`${key} ${quality}`);

    const modeToQuality: Record<string, string> = {
      'ionian': 'major', 'dorian': 'minor', 'phrygian': 'minor',
      'lydian': 'major', 'mixolydian': 'major', 'aeolian': 'minor',
      'locrian': 'minor', 'major': 'major', 'minor': 'minor'
    };
    this.romanQuality = modeToQuality[this.quality] || 'major';

    const keyApi = this.romanQuality === 'minor' ? _tLocal.Key.minorKey : _tLocal.Key.majorKey;
    const keyData = keyApi(key) as any;
    this.scaleNotes = this.romanQuality === 'minor' ? (keyData as any).natural?.scale : keyData.scale;
    this.diatonicChords = this.romanQuality === 'minor' ? (keyData as any).natural?.chords : keyData.chords;
  }

  romanToChord(roman: string): string | null {
    const degreeMatch = roman.match(/^([b#]?[IiVv]+)/);
    if (!degreeMatch) return null;

    const degree = degreeMatch[1];
    const isFlat = degree.startsWith('b');
    const isSharp = degree.startsWith('#');
    const romanNumeral = degree.replace(/^[b#]/, '');
    const degreeIndex = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].findIndex(
      r => romanNumeral.toUpperCase() === r
    );
    if (degreeIndex === -1) return null;

    const diatonicChord = this.diatonicChords?.[degreeIndex];
    const diatonicRoot = this.scaleNotes?.[degreeIndex];
    if (!diatonicChord || !diatonicRoot) return null;

    const chordParts = diatonicChord.match(/^([A-G][b#]?)(.*)$/);
    const baseRoot = chordParts?.[1] || diatonicRoot;
    const baseQuality = chordParts?.[2] || '';

    let quality = baseQuality;
    if (!/dim/.test(quality) && romanNumeral === romanNumeral.toLowerCase()) {
      quality = quality || 'm';
    }

    let rootNote = baseRoot;

    if (isFlat || isSharp) {
      const tLocal = this._t || tonal;
      const chromaticNote = tLocal.Note.chroma(rootNote);
      const alteredChroma = isFlat ? chromaticNote - 1 : chromaticNote + 1;
      const pc = tLocal.Note.fromMidi(alteredChroma);
      rootNote = tLocal.Note.pitchClass(pc);
    }

    const extensions = roman.replace(/^[b#]?[IiVv]+/, '');
    return `${rootNote}${quality}${extensions}`;
  }

  generate(type: string): string[] {
    const patterns: Record<string, Record<string, string[]>> = {
      major: {
        'I-IV-V': ['I', 'IV', 'V', 'I'],
        'I-V-vi-IV': ['I', 'V', 'vi', 'IV'],
        'ii-V-I': ['ii', 'V', 'I'],
        'I-vi-IV-V': ['I', 'vi', 'IV', 'V'],
        'circle': ['I', 'IV', 'vii', 'iii', 'vi', 'ii', 'V', 'I'],
        'blues': ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V']
      },
      minor: {
        'i-iv-v': ['i', 'iv', 'v', 'i'],
        'i-VI-VII': ['i', 'VI', 'VII', 'i'],
        'i-iv-VII': ['i', 'iv', 'VII', 'i'],
        'ii-V-i': ['ii', 'V', 'i'],
        'andalusian': ['i', 'VII', 'VI', 'v']
      }
    };

    const key = (this.romanQuality || this.quality) as string;
    const pattern = ((patterns as any)[key] as any)?.[type];
    if (!pattern) {
      console.warn(`Unknown progression type: ${type}, using I-IV-V`);
      return this.generate('I-IV-V');
    }

    return pattern.map((roman: string) => this.romanToChord(roman)).filter((c: string | null) => c !== null) as string[];
  }

  random(): string[] {
    const types = (this.romanQuality || this.quality) === 'major'
      ? ['I-IV-V', 'I-V-vi-IV', 'ii-V-I', 'I-vi-IV-V']
      : ['i-iv-v', 'i-VI-VII', 'i-iv-VII', 'ii-V-i'];
    const riLocal = this._ri || ri;
    const randomType = types[riLocal(types.length - 1)];
    return this.generate(randomType);
  }
}
```

<!-- END: snippet:ProgressionGenerator -->

#### `romanToChord(roman)`

Convert a Roman numeral (supports b/# alterations and extensions) to a concrete chord symbol in the current key.

<!-- BEGIN: snippet:ProgressionGenerator_romanToChord -->

```typescript
romanToChord(roman: string): string | null {
    const degreeMatch = roman.match(/^([b#]?[IiVv]+)/);
    if (!degreeMatch) return null;

    const degree = degreeMatch[1];
    const isFlat = degree.startsWith('b');
    const isSharp = degree.startsWith('#');
    const romanNumeral = degree.replace(/^[b#]/, '');
    const degreeIndex = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].findIndex(
      r => romanNumeral.toUpperCase() === r
    );
    if (degreeIndex === -1) return null;

    const diatonicChord = this.diatonicChords?.[degreeIndex];
    const diatonicRoot = this.scaleNotes?.[degreeIndex];
    if (!diatonicChord || !diatonicRoot) return null;

    const chordParts = diatonicChord.match(/^([A-G][b#]?)(.*)$/);
    const baseRoot = chordParts?.[1] || diatonicRoot;
    const baseQuality = chordParts?.[2] || '';

    let quality = baseQuality;
    if (!/dim/.test(quality) && romanNumeral === romanNumeral.toLowerCase()) {
      quality = quality || 'm';
    }

    let rootNote = baseRoot;

    if (isFlat || isSharp) {
      const tLocal = this._t || tonal;
      const chromaticNote = tLocal.Note.chroma(rootNote);
      const alteredChroma = isFlat ? chromaticNote - 1 : chromaticNote + 1;
      const pc = tLocal.Note.fromMidi(alteredChroma);
      rootNote = tLocal.Note.pitchClass(pc);
    }

    const extensions = roman.replace(/^[b#]?[IiVv]+/, '');
    return `${rootNote}${quality}${extensions}`;
  }
```

<!-- END: snippet:ProgressionGenerator_romanToChord -->

#### `generate(type)`

Return a named progression pattern (e.g., `I-IV-V`, `ii-V-I`, `andalusian`) as chord symbols.

<!-- BEGIN: snippet:ProgressionGenerator_generate -->

```typescript
generate(type: string): string[] {
    const patterns: Record<string, Record<string, string[]>> = {
      major: {
        'I-IV-V': ['I', 'IV', 'V', 'I'],
        'I-V-vi-IV': ['I', 'V', 'vi', 'IV'],
        'ii-V-I': ['ii', 'V', 'I'],
        'I-vi-IV-V': ['I', 'vi', 'IV', 'V'],
        'circle': ['I', 'IV', 'vii', 'iii', 'vi', 'ii', 'V', 'I'],
        'blues': ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V']
      },
      minor: {
        'i-iv-v': ['i', 'iv', 'v', 'i'],
        'i-VI-VII': ['i', 'VI', 'VII', 'i'],
        'i-iv-VII': ['i', 'iv', 'VII', 'i'],
        'ii-V-i': ['ii', 'V', 'i'],
        'andalusian': ['i', 'VII', 'VI', 'v']
      }
    };

    const key = (this.romanQuality || this.quality) as string;
    const pattern = ((patterns as any)[key] as any)?.[type];
    if (!pattern) {
      console.warn(`Unknown progression type: ${type}, using I-IV-V`);
      return this.generate('I-IV-V');
    }

    return pattern.map((roman: string) => this.romanToChord(roman)).filter((c: string | null) => c !== null) as string[];
  }
```

<!-- END: snippet:ProgressionGenerator_generate -->

#### `random()`

Pick a random pattern appropriate to the current key quality.

<!-- BEGIN: snippet:ProgressionGenerator_random -->

```typescript
random(): string[] {
    const types = (this.romanQuality || this.quality) === 'major'
      ? ['I-IV-V', 'I-V-vi-IV', 'ii-V-I', 'I-vi-IV-V']
      : ['i-iv-v', 'i-VI-VII', 'i-iv-VII', 'ii-V-i'];
    const riLocal = this._ri || ri;
    const randomType = types[riLocal(types.length - 1)];
    return this.generate(randomType);
  }
```

<!-- END: snippet:ProgressionGenerator_random -->

---

## Usage Example

```typescript
import { ProgressionGenerator } from '../src/composers/ProgressionGenerator';

const gen = new ProgressionGenerator('C', 'major');
const iiV = gen.generate('ii-V-I');
// => ['Dm7', 'G7', 'Cmaj7']

const randomProg = gen.random();
```

---

## Related Modules

- ChordComposer.ts ([code](../../src/composers/ChordComposer.ts)) ([doc](ChordComposer.md)) - Consumes progressions to emit chord tones
- ScaleComposer.ts ([code](../../src/composers/ScaleComposer.ts)) ([doc](ScaleComposer.md)) - Provides scale context for melodies
- ModeComposer.ts ([code](../../src/composers/ModeComposer.ts)) ([doc](ModeComposer.md)) - Mode-aware melodic textures

