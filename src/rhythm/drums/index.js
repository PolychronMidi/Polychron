// Drum subsystem - MIDI ch10 pattern generation and texture coupling.
// drumMap must load before drummer (drummer depends on drumMap internals).
// @ts-ignore: side-effect module load
require('./drumMap');
// @ts-ignore: side-effect module load
require('./drummer');
// @ts-ignore: side-effect module load
require('./drumTextureCoupler');
// @ts-ignore: side-effect module load
require('./playDrums');
// @ts-ignore: side-effect module load
require('./playDrums2');
