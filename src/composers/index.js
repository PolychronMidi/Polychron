const MeasureComposer = require('./MeasureComposer');
const { ScaleComposer, RandomScaleComposer } = require('./ScaleComposer');
const { ChordComposer, RandomChordComposer } = require('./ChordComposer');

try { module.exports = { MeasureComposer, ScaleComposer, RandomScaleComposer, ChordComposer, RandomChordComposer }; } catch (e) { /* swallow */ }
