# ComposerRegistry.ts - Central registry for composer factories

> **Status**: Core Module
> **Dependencies**: composers.ts

## Overview

`ComposerRegistry` provides a typed registry and factory methods to create composer instances by `type`.

### register / create

<!-- BEGIN: snippet:ComposerRegistry_register -->

```typescript
register(type: string, factory: ComposerFactory): void {
    this.composers.set(type, factory);
  }
```

<!-- END: snippet:ComposerRegistry_register -->

### registerDefaults (default factories)

<!-- BEGIN: snippet:ComposerRegistry_registerDefaults -->

```typescript
private registerDefaults(): void {
    // Import composer classes from global scope (backward compatibility)
    const ScaleComposer = g.ScaleComposer;
    const ChordComposer = g.ChordComposer;
    const ModeComposer = g.ModeComposer;
    const PentatonicComposer = g.PentatonicComposer;
    const MeasureComposer = g.MeasureComposer;
    const TensionReleaseComposer = g.TensionReleaseComposer;
    const ModalInterchangeComposer = g.ModalInterchangeComposer;
    const HarmonicRhythmComposer = g.HarmonicRhythmComposer;
    const MelodicDevelopmentComposer = g.MelodicDevelopmentComposer;
    const AdvancedVoiceLeadingComposer = g.AdvancedVoiceLeadingComposer;

    // Utilities from global scope
    const ri = g.ri;
    const allScales = g.allScales;
    const allNotes = g.allNotes;
    const allChords = g.allChords;
    const allModes = g.allModes;

    // Register measure composer
    this.register('measure', () => new MeasureComposer());

    // Register scale composer with random support
    this.register('scale', ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ScaleComposer(n, r);
    });

    // Register chord composer with progression support
    this.register('chords', ({ progression = ['C'] } = {}) => {
      let p = Array.isArray(progression) ? progression : ['C'];
      if (typeof progression === 'string' && progression === 'random') {
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) {
          p.push(allChords[ri(allChords.length - 1)]);
        }
      }
      return new ChordComposer(p);
    });

    // Register mode composer with random support
    this.register('mode', ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? allModes[ri(allModes.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new ModeComposer(n, r);
    });

    // Register pentatonic composer
    this.register('pentatonic', ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new PentatonicComposer(r, t);
    });

    // Register advanced composers (if they exist)
    if (TensionReleaseComposer) {
      this.register('tensionRelease', ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5 } = {}) =>
        new TensionReleaseComposer(key, quality, tensionCurve)
      );
    }

    if (ModalInterchangeComposer) {
      this.register('modalInterchange', ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) =>
        new ModalInterchangeComposer(key, primaryMode, borrowProbability)
      );
    }

    if (HarmonicRhythmComposer) {
      this.register('harmonicRhythm', ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) =>
        new HarmonicRhythmComposer(progression, key, measuresPerChord, quality)
      );
    }

    if (MelodicDevelopmentComposer) {
      this.register('melodicDevelopment', ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) =>
        new MelodicDevelopmentComposer(name, root, developmentIntensity)
      );
    }

    if (AdvancedVoiceLeadingComposer) {
      this.register('advancedVoiceLeading', ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) =>
        new AdvancedVoiceLeadingComposer(name, root, commonToneWeight)
      );
    }
  }
```

<!-- END: snippet:ComposerRegistry_registerDefaults -->
