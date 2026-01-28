// Debug LM.activate behavior
const G = Function('return this')();
G.__POLYCHRON_TEST__ = G.__POLYCHRON_TEST__ || {};
require('../src/time');
require('../src/backstage');
require('../src/play');
// Register layers similarly to tests
LM.register('primary', [], {}, () => {});
LM.register('poly', [], {}, () => {});
try { polyNumerator = 5; } catch (e) { console.log('polyNumerator assignment failed', e); }
try { polyDenominator = 6; } catch (e) { console.log('polyDenominator assignment failed', e); }
try { measuresPerPhrase2 = 3; } catch (e) { console.log('measuresPerPhrase2 assignment failed', e); }
console.log('Before activate:', { polyNumerator, polyDenominator, measuresPerPhrase2, numerator, denominator, measuresPerPhrase });
LM.activate('poly', true);
console.log('After activate:', { polyNumerator, polyDenominator, measuresPerPhrase2, numerator, denominator, measuresPerPhrase });
