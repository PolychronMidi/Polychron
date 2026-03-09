// @ts-ignore: coupling subsystem helpers (constants, state, gain, effectiveGain, bias)
require('./coupling');
// @ts-ignore: homeostasis subsystem helpers (constants, state, floor, tick, refresh)
require('./coupling/homeostasis');
// @ts-ignore: axis surface-pressure helpers for axisEnergyEquilibrator
require('./axisEnergyEquilibratorHelpers');
// @ts-ignore: axis energy equilibrator (reads axis energy shares, auto-adjusts pair baselines)
require('./axisEnergyEquilibrator');
