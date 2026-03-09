// @ts-ignore: attribution-driven pipeline balancer (reads signalReader attribution)
require('./pipelineBalancer');
// @ts-ignore: coupling telemetry and snapshot helpers for pipelineCouplingManager
require('./pipelineCouplingManagerSnapshot');
// @ts-ignore: coupling dimension sets, pair targets, gain parameters, guard thresholds
require('./couplingConstants');
// @ts-ignore: coupling mutable state, accessors, and reset logic
require('./couplingState');
// @ts-ignore: pre-loop refresh setup (regime, velocity, guards, homeostasis)
require('./couplingRefreshSetup');
// @ts-ignore: budget priority scoring and ranking
require('./couplingBudgetScoring');
// @ts-ignore: per-pair gain escalation, relaxation, and target calibration
require('./couplingGainEscalation');
// @ts-ignore: per-pair effective gain chain and nudge emission
require('./couplingEffectiveGain');
// @ts-ignore: axis totals, HP promotion, coherence gate, bias finalization
require('./couplingBiasAccumulator');
// @ts-ignore: density-tension coupling manager (reads systemDynamicsProfiler coupling matrix)
require('./pipelineCouplingManager');
