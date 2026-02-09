// @ts-ignore: load side-effect module with globals
require('./MeasureComposer');
// @ts-ignore: load side-effect module with globals
require('./HarmonicContext');
// @ts-ignore: load side-effect module with globals
require('./noiseComposer');
// @ts-ignore: load side-effect module with globals
require('./ScaleComposer');
// Grouped submodules: chord, motif, voice (each has an index to load its files)
// @ts-ignore: load side-effect module with globals
require('./chord');
// @ts-ignore: load side-effect module with globals
require('./ModeComposer');
// @ts-ignore: load side-effect module with globals
require('./PentatonicComposer');
// @ts-ignore: load side-effect module with globals
require('./TensionReleaseComposer');
// @ts-ignore: load side-effect module with globals
require('./ModalInterchangeComposer');
// @ts-ignore: load side-effect module with globals
require('./HarmonicRhythmComposer');
// @ts-ignore: load side-effect module with globals
require('./MelodicDevelopmentComposer');
// @ts-ignore: load side-effect module with globals
require('./motif');
// @ts-ignore: load side-effect module with globals
require('./voice');
// @ts-ignore: load side-effect module with globals
require('./PhraseArcManager');
// @ts-ignore: load side-effect module with globals
require('./ComposerFactory');

// Normalize chord progressions coming from the configuration so entries
// defined in `src/config.js` are sanitized at parse/load time. This centralizes
// normalization so any external config source will be normalized consistently.
if (typeof COMPOSERS !== 'undefined' && Array.isArray(COMPOSERS)) {
  for (let i = 0; i < COMPOSERS.length; i++) {
    const cfg = COMPOSERS[i];
    if (cfg && cfg.type === 'chords' && Array.isArray(cfg.progression)) {
      try {
        cfg.progression = cfg.progression.map(normalizeChordSymbol);
      } catch (e) { /* swallow to avoid failing startup */ }
    }
  }
}
