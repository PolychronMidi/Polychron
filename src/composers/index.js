const MeasureComposer = require('./MeasureComposer');
const { ScaleComposer, RandomScaleComposer } = require('./ScaleComposer');
const { ChordComposer, RandomChordComposer } = require('./ChordComposer');
const { ModeComposer, RandomModeComposer } = require('./ModeComposer');

try { module.exports = { MeasureComposer, ScaleComposer, RandomScaleComposer, ChordComposer, RandomChordComposer, ModeComposer, RandomModeComposer }; } catch (e) { /* swallow */ }
