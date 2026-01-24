import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
// ensure time module is loaded to initialize LM and globals
const _time = require('../src/time.js');
// ensure writer is loaded so CSVBuffer is defined for LM.register
require('../src/writer.js');
// ensure rhythm helpers are available
require('../src/rhythm.js');

describe('Marker preference cache - integration', () => {
  const OUT = path.join(process.cwd(), 'output');
  beforeEach(() => {
    // ensure clean output
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
    // remove existing output1.csv
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
    // reset LM
    if (global.LM) {
      global.LM.layers = {};
      global.LM.activeLayer = null;
    }
    // deterministic selection helper for rhythm tests
    global.randomWeightedSelection = (obj) => Object.keys(obj)[0];
    // enable logging inside modules for debug
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    globalThis.__POLYCHRON_TEST__.enableLogging = false;
    // minimal numeric/math random helpers used by rhythm.js
    global.m = Math;
    global.LOG = 'none'; // disable writer logUnit outputs during tests
    global.ri = (...args) => { if (args.length === 1) return Math.floor(args[0]) || 0; if (args.length === 2) return args[0]; return args[0]; };
    global.rf = (a,b) => typeof b === 'undefined' ? (a || 0.5) : a;
    global.rv = (a,b,c) => a;
    global.ra = (v) => { if (typeof v === 'function') return v(); if (Array.isArray(v)) return v[0]; return v; };
    // simple buffer push helper used by rhythm/drummer
    global.p = (buff, evt) => { if (!buff.events) buff.events = []; buff.events.push(evt); };
    global.c = null; // will be set per-test after LM.register
  });

  afterEach(() => {
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
  });

  it('loadMarkerMapForLayer and findMarkerSecs return correct entries from CSV', () => {
    // create an output CSV with a unitRec that includes seconds
    const line = '1,0,marker_t,unitRec:primary|section1|phrase1|measure1|beat1/4|0-1000|0.000000-1.000000';
    fs.writeFileSync(path.join(OUT, 'output1.csv'), line + '\n');

    // call the module-level loader directly and assert it finds the entry
    const map = global.__POLYCHRON_TEST__.loadMarkerMapForLayer('primary');
    expect(map).toBeDefined();
    const key = 'primary|section1|phrase1|measure1|beat1/4';
    expect(map[key]).toBeDefined();
    expect(Number(map[key].startSec)).toBeCloseTo(0.0, 6);
    expect(Number(map[key].endSec)).toBeCloseTo(1.0, 6);

    // findMarkerSecs should return the same
    const found = global.__POLYCHRON_TEST__.findMarkerSecs('primary', key.split('|'));
    expect(found).toBeDefined();
    expect(Number(found.startSec)).toBeCloseTo(0.0, 6);
    expect(Number(found.endSec)).toBeCloseTo(1.0, 6);
  });

  it('findMarkerSecs returns null when no CSV present', () => {
    try { fs.unlinkSync(path.join(OUT, 'output1.csv')); } catch (e) {}
    const map = global.__POLYCHRON_TEST__.loadMarkerMapForLayer('primary');
    expect(map).toBeDefined();
    expect(Object.keys(map).length).toBe(0);
    const found = global.__POLYCHRON_TEST__.findMarkerSecs('primary', ['primary','section1','phrase1','measure1','beat1/4']);
    expect(found).toBeNull();
  });
});
