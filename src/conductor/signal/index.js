// @ts-ignore: adaptive soft-envelope pipeline normalization (replaces static product floors/ceilings)
require('./pipelineNormalizer');
// @ts-ignore: coherence monitor (registers into ConductorIntelligence, must precede GlobalConductorUpdate)
require('./coherenceMonitor');
// @ts-ignore: standardized read API for inter-module signal reading
require('./signalReader');
// @ts-ignore: adaptive profile hints (registers recorder + stateProvider)
require('./profileAdaptation');
// @ts-ignore: per-beat signal history (registers recorder + stateProvider)
require('./signalTelemetry');
// @ts-ignore: meta-diagnostic: pipeline health analysis (registers recorder + stateProvider)
require('./signalHealthAnalyzer');
// @ts-ignore: meta-diagnostic: phase-space trajectory analysis (registers recorder + stateProvider)
require('./systemDynamicsProfiler');
// @ts-ignore: regime-reactive damping (reads SystemDynamicsProfiler, registers bias triplet)
require('./regimeReactiveDamping');
// @ts-ignore: attribution-driven pipeline balancer (reads signalReader attribution)
require('./pipelineBalancer');
// @ts-ignore: density-tension coupling manager (reads SystemDynamicsProfiler coupling matrix)
require('./pipelineCouplingManager');
// @ts-ignore: 3D narrative trajectory (tension/novelty/density arc tracking)
require('./narrativeTrajectory');
// @ts-ignore: compositional strategy memory (composer family variety pressure)
require('./structuralNarrativeAdvisor');
// @ts-ignore: self-organized criticality engine (avalanche-based damping)
require('./criticalityEngine');
