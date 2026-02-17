// Subsystem helpers (helpers first, manager last)
// @ts-ignore: load side-effect module with globals
require('./VoiceValues');
// @ts-ignore: load side-effect module with globals
require('./voiceModulator');
// @ts-ignore: load side-effect module with globals
require('./voiceConfig');
// VoiceStrategyRegistry removed (orphaned — register/get never called)
// @ts-ignore: load side-effect module with globals
require('./VoiceRegistry');
// @ts-ignore: load side-effect module with globals
require('./RegisterBiasing');
// @ts-ignore: load side-effect module with globals
require('./VoiceLeadingScorers');
// @ts-ignore: load side-effect module with globals
require('./voiceLeadingPriorsData');
// @ts-ignore: load side-effect module with globals
require('./voiceLeadingPriors');
// @ts-ignore: load side-effect module with globals
require('./melodicPriorsData');
// @ts-ignore: load side-effect module with globals
require('./melodicPriors');
// @ts-ignore: load side-effect module with globals
require('./VoiceLeadingCore');

// Core components
// @ts-ignore: load side-effect module with globals
require('./VoiceLeadingComposer');
// @ts-ignore: load side-effect module with globals
require('./VoiceLeadingScore');
// @ts-ignore: load side-effect module with globals
require('./VoiceManager');
