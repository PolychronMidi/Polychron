// @ts-ignore: state snapshot helper for couplingHomeostasis
require('./couplingHomeostasisSnapshot');
// @ts-ignore: homeostasis immutable configuration (energy, redistribution, tail, floor)
require('./homeostasisConstants');
// @ts-ignore: homeostasis mutable state, accessors, and section reset
require('./homeostasisState');
// @ts-ignore: structural floor dampening and budget constraint pressure
require('./homeostasisFloor');
// @ts-ignore: per-beat multiplier management (proportional control, recovery, braking)
require('./homeostasisTick');
// @ts-ignore: per-measure energy analysis, tail pressure, redistribution detection
require('./homeostasisRefresh');
// @ts-ignore: whole-system coupling energy governor (reads pipelineCouplingManager, modulates global gain)
require('./couplingHomeostasis');
