require('./intervalComposer');
require('./measureNotePool');
require('./MeasureComposer');
require('./composerCapabilities');
require('./utils');
require('./noiseComposer');
require('./ScaleComposer');
// Grouped submodules: chord, motif, voice (each has an index to load its files)
require('./chord');
require('./PentatonicComposer');
require('./BluesComposer');
require('./ChromaticComposer');
require('./QuartalComposer');
require('./TensionReleaseComposer');
require('./ModeComposer');
require('./ModalInterchangeComposer');
require('./HarmonicRhythmComposer');
require('./melodicDevelopmentVoicingIntent');
require('./MelodicDevelopmentComposer');
require('./voice');
require('./motif');
require('./profiles');
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
