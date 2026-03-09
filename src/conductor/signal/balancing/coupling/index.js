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
