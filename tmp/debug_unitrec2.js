const fs=require('fs'),path=require('path');
const OUT=path.join(process.cwd(),'output'); if(!fs.existsSync(OUT)) fs.mkdirSync(OUT);
fs.writeFileSync(path.join(OUT,'output1.csv'),'1,0,marker_t,unitRec:primary|section1|phrase1|measure1|beat1/4|0-1000|0.000000-1.000000\n');
require('../src/writer.js'); require('../src/time.js'); require('../src/rhythm.js');
global.m=Math; global.LOG='none';
const reg = LM.register('primary','c1',{}, ()=>{}); const primary = reg.state; const c1 = reg.buffer;
console.log('LM.layers.primary.state === primary?', LM.layers['primary'] && LM.layers['primary'].state === primary);
console.log('initial units property present?', 'units' in primary, primary.units);

global.sectionIndex=0; global.phraseIndex=0; global.measureIndex=0; global.beatIndex=0; global.tpSec=1000; global.tpMeasure=1000; global.spMeasure=1; global.phraseStart=0; global.phraseStartTime=0; global.numerator=4; global.denominator=4; global.measuresPerPhrase=1; global.beatRhythm=[1,1,1,1]; global.divRhythm=[1]; global.subdivRhythm=[1]; global.subsubdivRhythm=[1];
global.ri = (...args) => { if (args.length === 1) return Math.floor(args[0]) || 0; if (args.length === 2) return args[0]; return args[0]; };
global.randomWeightedSelection=(obj)=>Object.keys(obj)[0];
// rhythm counters
global.beatsOn = 0; global.beatsOff = 0; global.divsOn = 0; global.divsOff = 0; global.subdivsOn = 0; global.subdivsOff = 0;

global.composer={getDivisions:()=>1,getSubdivisions:()=>1,getSubsubdivs:()=>1,getMeter:()=>[4,4]};
global.BPM=120; global.PPQ=480; getMidiTiming();
global.measuresPerPhrase1=1; global.measuresPerPhrase2=1; LM.activate('primary',false);
// ensure subdivision counts exist
global.subdivsPerDiv = 1; global.subsubdivsPerSub = 1;
// manual test: push a unitRec into layer state
LM.layers['primary'].state.units = LM.layers['primary'].state.units || []; LM.layers['primary'].state.units.push({manual: true});
console.log('after manual push: primary.units', JSON.stringify(LM.layers['primary'].state.units || null));
globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {}; globalThis.__POLYCHRON_TEST__.enableLogging = true;
try {
  console.log('CALL: setUnitTiming(measure)');
  setUnitTiming('measure');
  console.log('DONE: setUnitTiming(measure)');
} catch (e) { console.error('ERR measure', e && e.stack ? e.stack : e); }
console.log('after measure: LM.layers.primary.state === primary?', LM.layers['primary'] && LM.layers['primary'].state === primary);
console.log('after measure: primary.units', JSON.stringify(primary.units || null));
console.log('after measure: LM.layers.primary.state.units', JSON.stringify(LM.layers['primary'] && LM.layers['primary'].state && LM.layers['primary'].state.units || null));

try { console.log('CALL: setUnitTiming(beat)'); setUnitTiming('beat'); console.log('DONE: setUnitTiming(beat)'); } catch(e){ console.error('ERR beat', e && e.stack ? e.stack : e); }
console.log('after beat: primary.units', JSON.stringify(primary.units || null));
console.log('after beat: LM.layers.primary.state.units', JSON.stringify(LM.layers['primary'] && LM.layers['primary'].state && LM.layers['primary'].state.units || null));
console.log('BUFFER_ROWS', JSON.stringify((LM.layers['primary'] && LM.layers['primary'].buffer && LM.layers['primary'].buffer.rows) || [], null, 2));
try { console.log('setUnitTiming source:\n', setUnitTiming.toString().slice(0,2000)); console.log('setUnitTiming tail:\n', setUnitTiming.toString().slice(-800)); } catch (e) { console.error('failed to print setUnitTiming', e); }
