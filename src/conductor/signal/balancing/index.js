// @ts-ignore: attribution-driven pipeline balancer (reads signalReader attribution)
require('./pipelineBalancer');
// @ts-ignore: coupling telemetry and snapshot helpers for pipelineCouplingManager
require('./pipelineCouplingManagerSnapshot');
// @ts-ignore: coupling subsystem helpers (constants, state, gain, effectiveGain, bias)
require('./coupling');
// @ts-ignore: density-tension coupling manager (reads systemDynamicsProfiler coupling matrix)
require('./pipelineCouplingManager');
// @ts-ignore: state snapshot helper for couplingHomeostasis
require('./couplingHomeostasisSnapshot');
// @ts-ignore: homeostasis subsystem helpers (constants, state, floor, tick, refresh)
require('./coupling/homeostasis');
// @ts-ignore: whole-system coupling energy governor (reads pipelineCouplingManager, modulates global gain)
require('./couplingHomeostasis');
// @ts-ignore: axis surface-pressure helpers for axisEnergyEquilibrator
require('./axisEnergyEquilibratorHelpers');
// @ts-ignore: axis energy equilibrator (reads axis energy shares, auto-adjusts pair baselines)
require('./axisEnergyEquilibrator');
