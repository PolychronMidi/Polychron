// @ts-ignore: harmonic journey - tonal trajectory planning and shared harmonic state
require('./journey');
// @ts-ignore: load side-effect module with globals
require('./phraseArcProfiler');
// @ts-ignore: load side-effect module with globals
require('./PhraseArcManager');
// @ts-ignore: conductor profile factories (loaded here per local/no-requires-outside-index)
// @ts-ignore: load side-effect module with globals
require('./profiles/conductorProfileDefault');
// @ts-ignore: load side-effect module with globals
require('./profiles/conductorProfileRestrained');
// @ts-ignore: load side-effect module with globals
require('./profiles/conductorProfileExplosive');
// @ts-ignore: load side-effect module with globals
require('./profiles/conductorProfileAtmospheric');
// @ts-ignore: load side-effect module with globals
require('./profiles/conductorProfileRhythmicDrive');
// @ts-ignore: load side-effect module with globals
require('./profiles/conductorProfileMinimal');
// @ts-ignore: conductor profile sources (must precede conductorConfig)
require('./profiles/conductorProfiles');
// @ts-ignore: conductor profile helper globals (must precede conductorConfig)
require('./profiles/conductorConfigTuningDefaults');
// @ts-ignore: conductor profile helper globals (must precede conductorConfig)
require('./profiles/conductorConfigTuningOverrides');
// @ts-ignore: conductor profile helper globals (must precede conductorConfig)
require('./profiles/conductorConfigMergeProfileTuning');
// @ts-ignore: conductor profile helper globals (must precede conductorConfig)
require('./profiles/conductorConfigValidateProfile');// @ts-ignore: conductor dynamics controls must be available before helpers
require('./profiles/conductorDynamicsControls');// @ts-ignore: conductor profile helper globals (must precede conductorConfig)
require('./profiles/conductorConfigDynamics');
// @ts-ignore: conductor profile helper globals (must precede conductorConfig)
require('./profiles/conductorConfigResolvers');
// @ts-ignore: conductor profile accessor delegates (must precede conductorConfig)
require('./profiles/conductorConfigAccessors');
// @ts-ignore: conductor profile config/accessor (must precede dynamismEngine & globalConductor)
require('./profiles/conductorConfig');
// @ts-ignore: load side-effect module with globals
require('./dynamismPulse');
// @ts-ignore: load side-effect module with globals
require('./dynamismEngine');
// @ts-ignore: load side-effect module with globals
require('./textureBlender');
// @ts-ignore: load side-effect module with globals
require('./conductorState');
// @ts-ignore: progressive deviation dampening engine (must precede conductorIntelligence)
require('./conductorDampening');
// @ts-ignore: intelligence registry (must precede globalConductorUpdate & intelligence subdirectories)
require('./conductorIntelligence');
// @ts-ignore: signal pipeline infrastructure (normalizer, reader, profiler, health, coupling, etc.)
require('./signal');
// @ts-ignore: load side-effect module with globals
require('./globalConductorUpdate');
// @ts-ignore: load side-effect module with globals
require('./globalConductor');

// @ts-ignore: load side-effect module with globals (cross-domain analysis helpers)
require('./analysisHelpers');

// Intelligence modules - grouped by domain
// @ts-ignore: load side-effect subfolder with globals
require('./harmonic');
// @ts-ignore: load side-effect subfolder with globals
require('./melodic');
// @ts-ignore: load side-effect subfolder with globals
require('./rhythmic');
// @ts-ignore: load side-effect subfolder with globals
require('./dynamics');
// @ts-ignore: load side-effect subfolder with globals
require('./texture');

// @ts-ignore: load side-effect module with globals
require('./config');
