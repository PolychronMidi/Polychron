import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

require('../src/writer'); // CSVBuffer, grandFinale
require('../src/time'); // ensure LM is initialized (LM.register)

describe('CSV writer: unitRec label and event unit prefix', () => {
  const OUT = path.join(process.cwd(), 'output');

  beforeEach(() => {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
    // reset LM
    if (LM) { LM.layers = {}; LM.activeLayer = null; }
    LOG = 'none';
  });

  afterEach(() => {
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
  });

  it('preserves human label in marker_t and includes layer prefix on event tick field', () => {
    // register primary layer and push a labeled unitRec marker + an event inside its range
    const { state: primaryState, buffer: c1 } = LM.register('primary', 'c1', {}, () => {});

    // push labeled unitRec marker (as time.js would emit)
    const label = 'New Beat:unitRec:primary|section1|phrase1|measure1|beat1/4|1500-1875|0.045113-0.056391';
    c1.push({ tick: 1500, type: 'marker_t', vals: [label] });

    // push an event inside that unit's tick range
    c1.push({ tick: 1646, type: 'on', vals: [0, 60, 100] });

    // stub missing globals used by grandFinale
    allNotesOff = () => {};
    muteAll = () => {};
    // minimal MIDI timing defaults used by grandFinale
    PPQ = PPQ || 480;
    SILENT_OUTRO_SECONDS = typeof SILENT_OUTRO_SECONDS !== 'undefined' ? SILENT_OUTRO_SECONDS : 1;
    // write files
    grandFinale();

    const csv = fs.readFileSync(path.join(OUT, 'output1.csv'), 'utf8');
    expect(csv).toContain('1,1500,marker_t,New Beat:unitRec:primary|section1|phrase1|measure1|beat1/4|1500-1875|0.045113-0.056391');
    expect(csv).toContain('1,1646|primary|section1|phrase1|measure1|beat1/4|1500-1875|0.045113-0.056391,note_on_c,0,60,100');
  });
});
