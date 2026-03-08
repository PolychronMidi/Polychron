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
