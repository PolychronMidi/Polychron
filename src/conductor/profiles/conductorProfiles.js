// conductorProfiles.js - Conductor profile definitions assembled from focused profile modules.

// Note: per project convention, profile factory modules are required from an index file
// (`src/conductor/index.js`) so local `require()` calls do not appear outside `index.js`.
// The factories (e.g. `conductorProfileDefault`) are expected to be present as
// naked globals by the time this module runs.

function _withAnalysisSettings(profileName, profile) {
  const analysisDefaults = {
    warmupTicks: 6,
    snapshotReuseBeats: 3,
    outputLoadWindowSeconds: 1.25,
    outputLoadSoftNotesPerSecond: 90,
    outputLoadHardNotesPerSecond: 140,
    outputLoadSoftScale: 0.88,
    outputLoadHardScale: 0.72,
    outputLoadSoftBeatCap: 44,
    outputLoadHardBeatCap: 64,
    motifEchoSoftCount: 2,
    motifEchoHardCount: 1
  };
  const profileAnalysis = {
    atmospheric: {
      warmupTicks: 4,
      snapshotReuseBeats: 2,
      outputLoadSoftNotesPerSecond: 84,
      outputLoadHardNotesPerSecond: 124,
      outputLoadSoftScale: 0.84,
      outputLoadHardScale: 0.66,
      outputLoadSoftBeatCap: 38,
      outputLoadHardBeatCap: 56,
      motifEchoSoftCount: 1,
      motifEchoHardCount: 0
    },
    explosive: {
      warmupTicks: 5,
      snapshotReuseBeats: 3,
      outputLoadSoftNotesPerSecond: 108,
      outputLoadHardNotesPerSecond: 168,
      outputLoadSoftScale: 0.92,
      outputLoadHardScale: 0.78,
      outputLoadSoftBeatCap: 54,
      outputLoadHardBeatCap: 78,
      motifEchoSoftCount: 3,
      motifEchoHardCount: 2
    },
    minimal: {
      warmupTicks: 5,
      snapshotReuseBeats: 2,
      outputLoadSoftNotesPerSecond: 64,
      outputLoadHardNotesPerSecond: 96,
      outputLoadSoftScale: 0.82,
      outputLoadHardScale: 0.62,
      outputLoadSoftBeatCap: 26,
      outputLoadHardBeatCap: 40,
      motifEchoSoftCount: 1,
      motifEchoHardCount: 0
    }
  };
  return Object.assign({}, profile, {
    analysis: Object.assign({}, analysisDefaults, profileAnalysis[profileName] || {}, profile && typeof profile.analysis === 'object' ? profile.analysis : {})
  });
}

CONDUCTOR_PROFILE_SOURCES = {
  default: _withAnalysisSettings('default', conductorProfileDefault()),
  restrained: _withAnalysisSettings('restrained', conductorProfileRestrained()),
  explosive: _withAnalysisSettings('explosive', conductorProfileExplosive()),
  atmospheric: _withAnalysisSettings('atmospheric', conductorProfileAtmospheric()),
  rhythmicDrive: _withAnalysisSettings('rhythmicDrive', conductorProfileRhythmicDrive()),
  minimal: _withAnalysisSettings('minimal', conductorProfileMinimal())
};
