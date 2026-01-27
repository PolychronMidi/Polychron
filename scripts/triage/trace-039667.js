const fs = require('fs');
const path = require('path');
const OUT = path.join(process.cwd(),'output');
const files = ['units.json','unitTreeMap.json','unitMasterMap.json','unitMasterMap.ndjson'];
function loadJson(p){ if(!fs.existsSync(p)) return null; try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ return null;} }
// build layerTp median from units.json (units that have startTime and startTick)
const unitsPath = path.join(OUT,'units.json');
let units = [];
if (fs.existsSync(unitsPath)) {
  try { units = JSON.parse(fs.readFileSync(unitsPath,'utf8')).units || []; } catch(e){ /* swallow */ }
}
const byLayerTp = {};
for (const u of units) {
  if (u && Number.isFinite(u.startTime) && Number.isFinite(u.startTick) && u.startTime>0) {
    const tp = Number(u.startTick)/Number(u.startTime);
    byLayerTp[u.layer] = byLayerTp[u.layer] || [];
    byLayerTp[u.layer].push(tp);
  }
}
const median = (arr)=>{ if(!arr||!arr.length) return null; arr = arr.slice().sort((a,b)=>a-b); const m=Math.floor(arr.length/2); return arr.length%2?arr[m]:((arr[m-1]+arr[m])/2); };
const layerTpMedian = {};
for (const l of Object.keys(byLayerTp)) layerTpMedian[l] = median(byLayerTp[l]);
console.log('layerTpMedian', layerTpMedian);

const matches = [];
const EPS = 0.00001;
for (const fn of files) {
  const p = path.join(OUT,fn);
  if (!fs.existsSync(p)) continue;
  try {
    const s = fs.readFileSync(p,'utf8');
    let j = null;
    try { j = JSON.parse(s); } catch(e) {
      const lines = s.split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        try { const obj = JSON.parse(ln); if(obj){ checkObj(fn,obj); } } catch(e){ /* swallow */ }
      }
      continue;
    }
    if (Array.isArray(j.units)) { for (const u of j.units) checkObj(fn,u); }
  } catch(e){ /* swallow */ }
}
function checkObj(fn,u){
  if (!u) return;
  const layer = u.layer || (u.key ? String(u.key).split('|')[0] : null);
  const st = Number(u.startTime);
  const tick = Number(u.startTick || u.startTick === 0 ? u.startTick : (u.tickStart || u.tick || null));
  // If exact startTime approx 0.039667
  if (Number.isFinite(st) && Math.abs(st - 0.039667) < 1e-6) matches.push({file:fn,kind:'exact-startTime',key:u.key||u.unitId,layer, startTime:st, startTick:tick});
  // If tick produces that startTime via median
  if (Number.isFinite(tick) && layer && layerTpMedian[layer]) {
    const calc = Number((tick / layerTpMedian[layer]).toFixed(6));
    if (Math.abs(calc - 0.039667) < 1e-6) matches.push({file:fn,kind:'tick-derived',key:u.key||u.unitId,layer, startTick:tick, calc});
  }
}
if (matches.length) console.log(JSON.stringify(matches,null,2)); else console.log('no matches');
fs.writeFileSync('tmp-trace-039667.json', JSON.stringify(matches.slice(0,100),null,2));
console.log('wrote tmp-trace-039667.json');
