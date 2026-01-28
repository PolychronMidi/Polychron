const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'output', 'time-debug.ndjson');
if (!fs.existsSync(file)) {
  console.error('No time-debug.ndjson found');
  process.exit(2);
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const unitsByLayer = {}; // layer -> {measure:[], beat:[], division:[], subdiv:[], subsubdiv:[]}

for (const ln of lines) {
  try {
    const obj = JSON.parse(ln);
    if (obj && obj.tag === 'built-unitRec' && obj.unitRec && obj.layer) {
      const layer = obj.unitRec.layer || obj.layer;
      unitsByLayer[layer] = unitsByLayer[layer] || { section: [], phrase: [], measure: [], beat: [], division: [], subdiv: [], subsubdiv: [] };
      const u = obj.unitRec;
      const entry = {
        type: u.unitType,
        start: Number(u.startTick || u.start || 0),
        end: Number(u.endTick || u.end || 0),
        meta: u,
        raw: obj
      };
      if (unitsByLayer[layer][entry.type]) unitsByLayer[layer][entry.type].push(entry);
    }
  } catch (e) { /* ignore parse errors */ }
}

function findParent(layerMap, child) {
  // return the most immediate parent for child unit
  const order = ['section','phrase','measure','beat','division','subdiv','subsubdiv'];
  const idx = order.indexOf(child.type);
  if (idx <= 0) return null; // no parent for section
  const parentType = order[idx-1];
  const candidates = layerMap[parentType] || [];
  // find candidate that contains child start..end
  for (const p of candidates) {
    if (Number.isFinite(p.start) && Number.isFinite(p.end) && child.start >= p.start && child.end <= p.end) return p;
  }
  return null;
}

const violations = [];
for (const [layer, map] of Object.entries(unitsByLayer)) {
  for (const t of ['beat','division','subdiv','subsubdiv']) {
    const list = map[t] || [];
    for (const child of list) {
      const parent = findParent(map, child);
      if (!parent) {
        // find nearest parent by type (previous level) and record violation
        violations.push({ layer, childType: child.type, childStart: child.start, childEnd: child.end, parent: null, childMeta: child.meta });
      } else {
        if (child.start < parent.start || child.end > parent.end) {
          violations.push({ layer, childType: child.type, childStart: child.start, childEnd: child.end, parentStart: parent.start, parentEnd: parent.end, childMeta: child.meta, parentMeta: parent.meta });
        }
      }
    }
  }
}

if (!violations.length) {
  console.log('No parent/child boundary violations detected in time-debug.ndjson');
  process.exit(0);
}

console.log('Found', violations.length, 'violations');
for (const v of violations) {
  console.log('----');
  console.log('Layer:', v.layer, 'ChildType:', v.childType);
  console.log('Child:', v.childStart, '-', v.childEnd);
  if (v.parentStart !== undefined) console.log('Parent:', v.parentStart, '-', v.parentEnd);
  if (v.childMeta) console.log('ChildMeta:', JSON.stringify(v.childMeta));
  if (v.parentMeta) console.log('ParentMeta:', JSON.stringify(v.parentMeta));
}

// Also write a report file to output for convenience
try {
  const out = path.join(process.cwd(), 'output', 'timing-violations-report.ndjson');
  for (const v of violations) fs.appendFileSync(out, JSON.stringify(v) + '\n');
  console.log('Wrote report to output/timing-violations-report.ndjson');
} catch (e) { console.error('Failed writing report', e); }

process.exit(0);
