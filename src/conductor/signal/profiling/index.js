// @ts-ignore: PI controller for entropy variance share targeting (helper for systemDynamicsProfiler)
require('./entropyAmplificationController');
// @ts-ignore: regime classification with hysteresis (helper for systemDynamicsProfiler)
require('./regimeClassifier');
// @ts-ignore: meta-diagnostic: phase-space trajectory analysis (registers recorder + stateProvider)
require('./systemDynamicsProfiler');
// @ts-ignore: regime-reactive damping (reads systemDynamicsProfiler, registers bias triplet)
require('./regimeReactiveDamping');
