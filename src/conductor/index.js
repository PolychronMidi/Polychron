// @ts-ignore: load side-effect module with globals
require('./harmonicContext');
// @ts-ignore: load side-effect module with globals
require('./harmonicRhythmTracker');
// @ts-ignore: load side-effect module with globals
require('./harmonicJourneyHelpers');
// @ts-ignore: load side-effect module with globals
require('./harmonicJourneyPlanner');
// @ts-ignore: load side-effect module with globals
require('./harmonicJourney');
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
// @ts-ignore: conductor profile sources (must precede ConductorConfig)
require('./profiles/conductorProfiles');
// @ts-ignore: conductor profile helper globals (must precede ConductorConfig)
require('./profiles/conductorConfigTuningDefaults');
// @ts-ignore: conductor profile helper globals (must precede ConductorConfig)
require('./profiles/conductorConfigTuningOverrides');
// @ts-ignore: conductor profile helper globals (must precede ConductorConfig)
require('./profiles/conductorConfigMergeProfileTuning');
// @ts-ignore: conductor profile helper globals (must precede ConductorConfig)
require('./profiles/conductorConfigValidateProfile');// @ts-ignore: conductor dynamics controls must be available before helpers
require('./profiles/conductorDynamicsControls');// @ts-ignore: conductor profile helper globals (must precede ConductorConfig)
require('./profiles/conductorConfigDynamics');
// @ts-ignore: conductor profile helper globals (must precede ConductorConfig)
require('./profiles/conductorConfigResolvers');
// @ts-ignore: conductor profile accessor delegates (must precede ConductorConfig)
require('./profiles/conductorConfigAccessors');
// @ts-ignore: conductor profile config/accessor (must precede DynamismEngine & GlobalConductor)
require('./profiles/conductorConfig');
// @ts-ignore: load side-effect module with globals
require('./dynamismPulse');
// @ts-ignore: load side-effect module with globals
require('./dynamismEngine');
// @ts-ignore: load side-effect module with globals
require('./textureBlender');
// @ts-ignore: load side-effect module with globals
require('./conductorState');
// @ts-ignore: intelligence registry (must precede GlobalConductorUpdate & intelligence subdirectories)
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
