const fs=require('fs');
const path=require('path');
const triPath=path.join(process.cwd(),'output','layerAlignment-triage.json');
if(!fs.existsSync(triPath)){ console.error('triage not found'); process.exit(2); }
const tri=JSON.parse(fs.readFileSync(triPath,'utf8'));

const parseUnitRecLine = (ln)=>{
  // extract unitRec:... token
  const m = String(ln).match(/unitRec:([^\s]+)/);
  if(!m) return null;
  const full = m[1];
  const seg = full.split('|');
  // detect seconds suffix: last segment contains '.'
  let startTick=null,endTick=null,startTime=null,endTime=null;
  if(seg.length>=2){
    const last = seg[seg.length-1];
    const secondLast = seg[seg.length-2];
    if(last && last.match(/\d+\.\d+-\d+\.\d+/)){
      const rs=last.split('-'); startTime=Number(rs[0]); endTime=Number(rs[1]);
      const rt=secondLast.split('-'); startTick=Number(rt[0]); endTick=Number(rt[1]);
    } else {
      const rt=last.split('-'); startTick=Number(rt[0]); endTick=Number(rt[1]);
    }
  }
  return {full,startTick,endTick,startTime,endTime};
}

const results = tri.map(e=>{
  const unitRecs = (e.unitRecNearby||[]).map(u=>({line:u.line,parsed:parseUnitRecLine(u.line)})).filter(x=>x.parsed);
  const secs = unitRecs.filter(u=>u.parsed && Number.isFinite(u.parsed.startTime));
  const ticks = unitRecs.filter(u=>u.parsed && Number.isFinite(u.parsed.startTick));
  const startTimes = secs.map(s=>s.parsed.startTime);
  const endTimes = secs.map(s=>s.parsed.endTime);
  const startTicks = ticks.map(s=>s.parsed.startTick);
  const endTicks = ticks.map(s=>s.parsed.endTick);

  const summary = {
    idx:e.idx, layer:e.layer, key:e.key, marker:e.marker,
    matchesCount:(e.matches||[]).length,
    unitRecCount:unitRecs.length,
    unitRecWithSeconds:secs.length,
    startTimeRange: secs.length? {min:Math.min(...startTimes), max:Math.max(...startTimes)}:null,
    endTimeRange: secs.length? {min:Math.min(...endTimes), max:Math.max(...endTimes)}:null,
    startTickRange: ticks.length? {min:Math.min(...startTicks), max:Math.max(...startTicks)}:null,
    endTickRange: ticks.length? {min:Math.min(...endTicks), max:Math.max(...endTicks)}:null,
    diagCount:(e.diagMatches||[]).length
  };

  // Determine suspected cause
  let cause = 'unknown';
  if(unitRecs.length===0) cause='no unitRec nearby';
  else if(secs.length===0) cause='unitRecs present but no seconds suffix (no startTime)';
  else {
    // if secs exist but ranges are scattered or not covering marker endTick
    if(e.marker && e.marker.endTick && Number.isFinite(e.marker.endTick)){
      const et = e.marker.endTick;
      const ticksCover = (ticks.length && Math.min(...startTicks) <= et && Math.max(...endTicks) >= et);
      if(!ticksCover) cause='unit tick ranges do not cover marker endTick';
      else {
        // check time coverage: convert marker endTick to seconds is not possible without tpSec in marker; so prefer unit seconds
        cause='units have seconds but section grouping resolution may differ (needs aggregation)';
      }
    } else {
      cause='units have seconds but marker lacks tpSec to compute absolute time from endTick';
    }
  }

  return { ...summary, cause };
});

const out = path.join(process.cwd(),'output','layerAlignment-triage-summary.json');
fs.writeFileSync(out, JSON.stringify(results,null,2));
console.log('Wrote',out);
console.log(results.map(r=>({idx:r.idx,layer:r.layer,key:r.key,unitRecCount:r.unitRecCount,unitRecWithSeconds:r.unitRecWithSeconds,cause:r.cause})));
