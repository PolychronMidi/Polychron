// @ts-ignore: adaptive soft-envelope pipeline normalization (replaces static product floors/ceilings)
require('./pipelineNormalizer');
// @ts-ignore: coherence monitor (registers into conductorIntelligence, must precede globalConductorUpdate)
require('./coherenceMonitor');
// @ts-ignore: standardized read API for inter-module signal reading
require('./signalReader');
// @ts-ignore: per-beat signal history (registers recorder + stateProvider)
require('./signalTelemetry');
// @ts-ignore: adaptive profile hints (registers recorder + stateProvider)
require('./profileAdaptation');
// @ts-ignore: meta-diagnostic: pipeline health analysis (registers recorder + stateProvider)
require('./signalHealthAnalyzer');
// @ts-ignore: meta-diagnostic: phase-space trajectory analysis (registers recorder + stateProvider)
require('./phaseSpaceMath');
// @ts-ignore: PI controller for entropy variance share targeting (helper for systemDynamicsProfiler)
require('./entropyAmplificationController');
// @ts-ignore: regime classification with hysteresis (helper for systemDynamicsProfiler)
require('./regimeClassifier');
// @ts-ignore: meta-diagnostic: phase-space trajectory analysis (registers recorder + stateProvider)
require('./systemDynamicsProfiler');
// @ts-ignore: regime-reactive damping (reads systemDynamicsProfiler, registers bias triplet)
require('./regimeReactiveDamping');
// @ts-ignore: attribution-driven pipeline balancer (reads signalReader attribution)
require('./pipelineBalancer');
// @ts-ignore: density-tension coupling manager (reads systemDynamicsProfiler coupling matrix)
require('./pipelineCouplingManager');
// @ts-ignore: 3D narrative trajectory (tension/novelty/density arc tracking)
require('./narrativeTrajectory');
// @ts-ignore: compositional strategy memory (composer family variety pressure)
require('./structuralNarrativeAdvisor');
// @ts-ignore: self-organized criticality engine (avalanche-based damping)
require('./criticalityEngine');
// @ts-ignore: phase-space dimensionality expansion (breaks correlation locks)
require('./dimensionalityExpander');
// @ts-ignore: meta-controller interaction watchdog (detects opposing correction patterns)
require('./conductorMetaWatchdog');
// @ts-ignore: central manifest of all 11 hypermeta self-calibrating controllers
require('./metaControllerRegistry');
// @ts-ignore: self-organized criticality engine (avalanche-based damping)
require('./output');
