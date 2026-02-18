// @ts-ignore: load side-effect module with globals
require('./HarmonicContext');
// @ts-ignore: load side-effect module with globals
require('./harmonicJourneyHelpers');
// @ts-ignore: load side-effect module with globals
require('./HarmonicJourney');
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
require('./profiles/conductorConfigValidateProfile');
// @ts-ignore: conductor profile helper globals (must precede ConductorConfig)
require('./profiles/conductorConfigDynamics');
// @ts-ignore: conductor profile config/accessor (must precede DynamismEngine & GlobalConductor)
require('./profiles/conductorConfig');
// @ts-ignore: load side-effect module with globals
require('./DynamismEngine');
// @ts-ignore: load side-effect module with globals
require('./TextureBlender');
// @ts-ignore: load side-effect module with globals
require('./GlobalConductor');
// @ts-ignore: load side-effect module with globals
require('./config');
