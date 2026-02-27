// src/conductor/texture/index.js - Texture, orchestration, layers, phrasing, structure
// @ts-ignore: load side-effect module with globals
require('./articulationProfiler');
// @ts-ignore: load side-effect module with globals
require('./crossLayerDensityBalancer');
// @ts-ignore: load side-effect module with globals
require('./layerCoherenceScorer');
// @ts-ignore: load side-effect module with globals
require('./layerEntryExitTracker');
// @ts-ignore: load side-effect module with globals
require('./layerIndependenceScorer');
// @ts-ignore: load side-effect module with globals
require('./fragmentHelpers');
// @ts-ignore: load side-effect module with globals
require('./motivicDensityTracker');
// @ts-ignore: load side-effect module with globals
require('./orchestrationWeightTracker');
// @ts-ignore: load side-effect module with globals
require('./pedalPointDetector');
// @ts-ignore: load side-effect module with globals
require('./phraseLengthMomentumTracker');
// @ts-ignore: load side-effect module with globals
require('./repetitionFatigueMonitor');
// @ts-ignore: load side-effect module with globals
require('./restDensityTracker');
// @ts-ignore: load side-effect module with globals
require('./sectionLengthAdvisor');
// @ts-ignore: load side-effect module with globals
require('./silenceDistributionTracker');
// @ts-ignore: load side-effect module with globals
require('./structuralFormTracker');
// @ts-ignore: load side-effect module with globals
require('./texturalGradientTracker');
// @ts-ignore: load side-effect module with globals
require('./texturalMemoryAdvisor');
// @ts-ignore: composer quality feedback advisor (depends on texturalMemoryAdvisor, repetitionFatigueMonitor, profileAdaptation)
require('./composerFeedbackAdvisor');
// @ts-ignore: load side-effect module with globals
require('./timbreBalanceTracker');
// @ts-ignore: load side-effect module with globals
require('./voiceDensityBalancer');
