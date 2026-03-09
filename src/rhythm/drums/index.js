// Drum subsystem - MIDI ch10 pattern generation and texture coupling.
// drumMap must load before drummer (drummer depends on drumMap internals).

require('./drumMap');

require('./drummer');

require('./drumTextureCoupler');

require('./playDrums');

require('./playDrums2');
