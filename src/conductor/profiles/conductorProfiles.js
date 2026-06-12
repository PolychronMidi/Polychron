
// Note: per project convention, profile factory modules are required from an index file

function conductorProfilesWithAnalysisSettings(profileName, profile) {
  const analysisDefaults = {
    warmupTicks: 6,
    snapshotReuseBeats: 3
  };
  const profileAnalysis = {
    atmospheric: {
      warmupTicks: 4,
      snapshotReuseBeats: 2
    },
    explosive: {
      warmupTicks: 5,
      snapshotReuseBeats: 2
    },
    minimal: {
      warmupTicks: 5,
      snapshotReuseBeats: 2
    }
  };
  return Object.assign({}, profile, {
    analysis: Object.assign({}, analysisDefaults, profileAnalysis[profileName] ?? {}, profile && typeof profile.analysis === 'object' ? profile.analysis : {})
  });
}

CONDUCTOR_PROFILE_SOURCES = {
  default: conductorProfilesWithAnalysisSettings('default', conductorProfileDefault()),
  restrained: conductorProfilesWithAnalysisSettings('restrained', conductorProfileRestrained()),
  explosive: conductorProfilesWithAnalysisSettings('explosive', conductorProfileExplosive()),
  atmospheric: conductorProfilesWithAnalysisSettings('atmospheric', conductorProfileAtmospheric()),
  rhythmicDrive: conductorProfilesWithAnalysisSettings('rhythmicDrive', conductorProfileRhythmicDrive()),
  minimal: conductorProfilesWithAnalysisSettings('minimal', conductorProfileMinimal())
};
