// @ts-ignore: attribution-driven pipeline balancer (reads signalReader attribution)
require('./pipelineBalancer');
// @ts-ignore: density-tension coupling manager (reads systemDynamicsProfiler coupling matrix)
require('./pipelineCouplingManager');
// @ts-ignore: whole-system coupling energy governor (reads pipelineCouplingManager, modulates global gain)
require('./couplingHomeostasis');
// @ts-ignore: axis energy equilibrator (reads axis energy shares, auto-adjusts pair baselines)
require('./axisEnergyEquilibrator');
