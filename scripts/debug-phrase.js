require('../src/sheet'); require('../src/writer'); require('../src/backstage'); require('../src/time');
// set variables per test
numerator = 4; denominator = 4; BPM = 120; PPQ = 480; getMidiTiming();
sectionStart = 0; phraseStart = 0; tpSection = 1000; tpPhrase = 800; sectionIndex = 0; phraseIndex = 1; phrasesPerSection = undefined; measuresPerPhrase = 4; // simulate test beforeEach
try { setUnitTiming('phrase'); console.log('NO THROW - phrase set ok'); } catch (e) { console.error('THROW', e && e.stack ? e.stack : e); }
