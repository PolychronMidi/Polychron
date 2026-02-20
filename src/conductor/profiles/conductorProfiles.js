// conductorProfiles.js — Conductor profile definitions assembled from focused profile modules.

// Note: per project convention, profile factory modules are required from an index file
// (`src/conductor/index.js`) so local `require()` calls do not appear outside `index.js`.
// The factories (e.g. `conductorProfileDefault`) are expected to be present as
// naked globals by the time this module runs.

if (CONDUCTOR_PROFILE_SOURCES !== null && typeof CONDUCTOR_PROFILE_SOURCES !== 'object') {
  throw new Error('conductorProfiles: CONDUCTOR_PROFILE_SOURCES must be an object when pre-defined');
}
CONDUCTOR_PROFILE_SOURCES = {
  default: conductorProfileDefault(),
  restrained: conductorProfileRestrained(),
  explosive: conductorProfileExplosive(),
  atmospheric: conductorProfileAtmospheric(),
  rhythmicDrive: conductorProfileRhythmicDrive(),
  minimal: conductorProfileMinimal()
};
