const MeasureComposer = require('./MeasureComposer');
const { ScaleComposer, RandomScaleComposer } = require('./ScaleComposer');
const { ChordComposer, RandomChordComposer } = require('./ChordComposer');
const { ModeComposer, RandomModeComposer } = require('./ModeComposer');
const { PentatonicComposer, RandomPentatonicComposer } = require('./PentatonicComposer');

try { module.exports = { MeasureComposer, ScaleComposer, RandomScaleComposer, ChordComposer, RandomChordComposer, ModeComposer, RandomModeComposer, PentatonicComposer, RandomPentatonicComposer }; } catch (e) { /* swallow */ }
