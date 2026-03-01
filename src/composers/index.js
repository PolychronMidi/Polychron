// @ts-ignore: load side-effect module with globals
require('./intervalComposer');
// @ts-ignore: load side-effect module with globals
require('./measureNotePool');
// @ts-ignore: load side-effect module with globals
require('./MeasureComposer');
// @ts-ignore: load side-effect module with globals
require('./composerCapabilities');
// @ts-ignore: load side-effect module with globals
require('./utils');
// @ts-ignore: load side-effect module with globals
require('./noiseComposer');
// @ts-ignore: load side-effect module with globals
require('./ScaleComposer');
// Grouped submodules: chord, motif, voice (each has an index to load its files)
// @ts-ignore: load side-effect module with globals
require('./chord');
// @ts-ignore: load side-effect module with globals
require('./PentatonicComposer');
// @ts-ignore: load side-effect module with globals
require('./BluesComposer');
// @ts-ignore: load side-effect module with globals
require('./ChromaticComposer');
// @ts-ignore: load side-effect module with globals
require('./QuartalComposer');
// @ts-ignore: load side-effect module with globals
require('./TensionReleaseComposer');
// @ts-ignore: load side-effect module with globals
require('./ModeComposer');
// @ts-ignore: load side-effect module with globals
require('./ModalInterchangeComposer');
// @ts-ignore: load side-effect module with globals
require('./HarmonicRhythmComposer');
// @ts-ignore: load side-effect module with globals
require('./melodicDevelopmentVoicingIntent');
// @ts-ignore: load side-effect module with globals
require('./MelodicDevelopmentComposer');
// @ts-ignore: load side-effect module with globals
require('./voice');
// @ts-ignore: load side-effect module with globals
require('./motif');
// @ts-ignore: load side-effect module with globals
require('./profiles');
// @ts-ignore: load side-effect module with globals
require('./factory');


const normalizeComposerEntriesOrFail = (entries, label) => {
  if (!Array.isArray(entries)) {
    throw new Error(`Composer profiles normalization: ${label} must be an array`);
  }
  for (let i = 0; i < entries.length; i++) {
    const cfg = entries[i];
    if (!cfg || typeof cfg !== 'object') {
      throw new Error(`Composer profiles normalization: ${label}[${i}] must be an object`);
    }
    if (cfg.type === 'chords' && Array.isArray(cfg.progression)) {
      try {
        cfg.progression = cfg.progression.map(normalizeChordSymbol);
      } catch (e) {
        throw new Error(`Failed to normalize chord progression in ${label}[${i}]: ${e && e.message ? e.message : e}`);
      }
    }
  }
};

if (!COMPOSER_TYPE_PROFILES) {
  throw new Error('Composer profiles normalization: COMPOSER_TYPE_PROFILES is undefined or invalid');
}
for (const [type, profiles] of Object.entries(COMPOSER_TYPE_PROFILES)) {
  if (!profiles || typeof profiles !== 'object') {
    throw new Error(`Composer profiles normalization: COMPOSER_TYPE_PROFILES.${type} must be an object`);
  }
  for (const [profileName, entries] of Object.entries(profiles)) {
    normalizeComposerEntriesOrFail(entries, `COMPOSER_TYPE_PROFILES.${type}.${profileName}`);
  }
}

if (!COMPOSER_PROFILE_POOLS) {
  throw new Error('Composer profiles normalization: COMPOSER_PROFILE_POOLS is undefined or invalid');
}
for (const [poolName, entries] of Object.entries(COMPOSER_PROFILE_POOLS)) {
  normalizeComposerEntriesOrFail(entries, `COMPOSER_PROFILE_POOLS.${poolName}`);
}
