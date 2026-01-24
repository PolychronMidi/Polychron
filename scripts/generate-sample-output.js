#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'output');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// Create a small units manifest for primary and poly
const units = [
  { unitHash: 'uprimary1', layer: 'primary', startTick: 0, endTick: 480 },
  { unitHash: 'uprimary2', layer: 'primary', startTick: 480, endTick: 960 },
  { unitHash: 'upoly1', layer: 'poly', startTick: 0, endTick: 360 },
  { unitHash: 'upoly2', layer: 'poly', startTick: 360, endTick: 840 }
];
const manifest = { generatedAt: (new Date()).toISOString(), layers: ['primary','poly'], units };
fs.writeFileSync(path.join(OUT,'units.json'), JSON.stringify(manifest, null, 2));
console.log('Wrote sample units.json');

// Helper to write a very small CSV with unit markers + event rows (tick|unitHash)
function writeCsv(filename, layerUnits) {
  let comp = `0,0,header,1,1,480\n1,0,start_track\n`;
  let finalTick = 0;
  // Emit a Section marker at the beginning of the file
  comp += `1,0,marker_t,Section 1\n`;

  // Add unit markers as marker_t rows
  for (const u of layerUnits) {
    const start = Number(u.startTick||0);
    const end = Number(u.endTick||0);
    comp += `1,${start},marker_t,unitHash:${u.unitHash},start:${start},end:${end}\n`;
    // Add a note inside the unit
    const mid = Math.max(start, Math.round((start + Math.min(end, start + 120)) / 2));
    comp += `1,${mid}|${u.unitHash},note_on_c,60,80\n`;
    finalTick = Math.max(finalTick, mid);
    // Add another note near unit end (inside bounds)
    const nearEnd = Math.max(start, Math.min(end - 1, start + 1));
    comp += `1,${nearEnd}|${u.unitHash},note_on_c,61,90\n`;
    finalTick = Math.max(finalTick, nearEnd);
  }
  comp += `1,${finalTick + 480},end_track`;
  fs.writeFileSync(path.join(OUT, filename), comp);
  console.log(`${filename} written`);
}

writeCsv('output1.csv', units.filter(u => u.layer === 'primary'));
writeCsv('output2.csv', units.filter(u => u.layer === 'poly'));
console.log('Sample CSVs created: output1.csv and output2.csv');
