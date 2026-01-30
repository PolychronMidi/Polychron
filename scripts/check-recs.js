const fs=require('fs');
const path=require('path');
const OUT=path.join(process.cwd(),'output');
function readUnitRecsForLayerPhrase(layer, sectionIdx, phraseIdx) {
  const csv = path.join(OUT, layer === 'primary' ? 'output1.csv' : 'output2.csv');
  const unitRecs = [];
  if (fs.existsSync(csv)) {
    const lines = fs.readFileSync(csv, 'utf8').split(/\r?\n/);
    for (const ln of lines) {
      if (!ln || !ln.startsWith('1,')) continue;
      const parts = ln.split(',');
      if (parts.length < 4) continue;
      if (String(parts[2]).toLowerCase() !== 'marker_t') continue;
      const val = parts.slice(3).join(',');
      const m = String(val).match(/unitRec:([^\s,]+)/);
      if (!m) continue;
      const full = m[1];
      if (!String(full).match(new RegExp(`section${sectionIdx+1}(?:/\\d+)?\\|phrase${phraseIdx+1}(?:/\\d+)?`))) continue;
      const seg = full.split('|');
      let startTime = null;
      for (let i = seg.length - 1; i >= 0; i--) {
        const s = seg[i];
        if (/^\d+\.\d+-\d+\.\d+$/.test(s)) { startTime = Number(s.split('-')[0]); break; }
      }
      unitRecs.push({ full, startTime });
    }
    if (unitRecs.length) return unitRecs;
  }
  const masterPath = path.join(OUT, 'unitMasterMap.json');
  if (fs.existsSync(masterPath)) {
    try {
      const jm = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
      const units = (jm && Array.isArray(jm.units)) ? jm.units : [];
      for (const u of units) {
        try {
          const key = String(u.key || u.unitId || '');
          if (!key.includes(`section${sectionIdx+1}`) || !key.includes(`phrase${phraseIdx+1}`)) continue;
          if (layer === 'poly' && !key.includes('|poly|') && !String(u.layer || '').includes('poly')) continue;
          if (layer === 'primary' && key.includes('|poly|')) continue;
          const m = key.match(/\|(\d+\.\d+)-(\d+\.\d+)$/);
          const startTime = m ? Number(m[1]) : (u.startTime !== undefined && u.startTime !== null ? Number(u.startTime) : null);
          unitRecs.push({ full: key, startTime });
        } catch (e) { /* swallow entry parse errors */ }
      }
      return unitRecs;
    } catch (e) { /* swallow */ }
  }
  return unitRecs;
}
console.log('poly recs:', readUnitRecsForLayerPhrase('poly',0,0));
console.log('primary recs:', readUnitRecsForLayerPhrase('primary',0,0));
try { console.log('output2.csv content:\n', fs.readFileSync(path.join(OUT,'output2.csv'),'utf8')); } catch(e) { console.log('no output2.csv'); }
try { console.log('unitMasterMap.json:\n', fs.readFileSync(path.join(OUT,'unitMasterMap.json'),'utf8')); } catch(e) { console.log('no unitMasterMap.json'); }
