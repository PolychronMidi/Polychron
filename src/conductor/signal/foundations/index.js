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
