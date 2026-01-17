// test/writer.test.ts - Testing CSV buffer and writer functions
import { CSVBuffer, pushMultiple as p, grandFinale, logUnit } from '../src/writer.js';
import { setupGlobalState } from './helpers.js';

// Legacy global access for tests still using globalThis.c
let c: any;

// Setup function
function setupLocalState() {
  setupGlobalState();
  c = globalThis.c;
}

describe('CSVBuffer class', () => {
  it('should create buffer with name and empty rows', () => {
    const buffer = new CSVBuffer('test');
    expect(buffer.name).toBe('test');
    expect(buffer.rows).toEqual([]);
    expect(buffer.length).toBe(0);
  });

  it('should push items to rows', () => {
    const buffer = new CSVBuffer('test');
    buffer.push({ a: 1 }, { b: 2 });
    expect(buffer.rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(buffer.length).toBe(2);
  });

  it('should report correct length', () => {
    const buffer = new CSVBuffer('test');
    expect(buffer.length).toBe(0);
    buffer.push({ a: 1 });
    expect(buffer.length).toBe(1);
    buffer.push({ b: 2 }, { c: 3 });
    expect(buffer.length).toBe(3);
  });

  it('should clear all rows', () => {
    const buffer = new CSVBuffer('test');
    buffer.push({ a: 1 }, { b: 2 });
    expect(buffer.length).toBe(2);
    buffer.clear();
    expect(buffer.rows).toEqual([]);
    expect(buffer.length).toBe(0);
  });
});

describe('pushMultiple (p)', () => {
  beforeEach(() => {
    setupLocalState();
  });

  it('should push single item', () => {
    p(c, { a: 1 });
    expect(c).toEqual([{ a: 1 }]);
  });

  it('should push multiple items', () => {
    p(c, { a: 1 }, { b: 2 }, { c: 3 });
    expect(c).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('should handle empty push', () => {
    p(c);
    expect(c).toEqual([]);
  });

  it('should work with existing array items', () => {
    c = [{ x: 0 }];
    p(c, { a: 1 }, { b: 2 });
    expect(c).toEqual([{ x: 0 }, { a: 1 }, { b: 2 }]);
  });

  it('should work with CSVBuffer', () => {
    const buffer = new CSVBuffer('test');
    p(buffer, { a: 1 }, { b: 2 });
    expect(buffer.rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(buffer.length).toBe(2);
  });
});

describe('logUnit', () => {
  beforeEach(() => {
    setupGlobalState();
    globalThis.LOG = 'all';
    globalThis.c = new CSVBuffer('test');
    c = globalThis.c;
    globalThis.sectionIndex = 0;
    globalThis.totalSections = 1;
    globalThis.sectionStart = 0;
    globalThis.sectionStartTime = 0;
    globalThis.tpSection = 1920;
    globalThis.tpSec = 960;
    globalThis.phraseIndex = 0;
    globalThis.phrasesPerSection = 1;
    globalThis.phraseStart = 0;
    globalThis.phraseStartTime = 0;
    globalThis.tpPhrase = 1920;
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.midiMeter = [4, 4];
    globalThis.composer = null;
    globalThis.measureIndex = 0;
    globalThis.measuresPerPhrase = 1;
    globalThis.measureStart = 0;
    globalThis.measureStartTime = 0;
    globalThis.tpMeasure = 1920;
    globalThis.spMeasure = 2;
    globalThis.beatIndex = 0;
    globalThis.beatStart = 0;
    globalThis.beatStartTime = 0;
    globalThis.tpBeat = 480;
    globalThis.spBeat = 0.5;
    globalThis.divIndex = 0;
    globalThis.divsPerBeat = 4;
    globalThis.divStart = 0;
    globalThis.divStartTime = 0;
    globalThis.tpDiv = 120;
    globalThis.spDiv = 0.125;
    globalThis.subdivIndex = 0;
    globalThis.subdivsPerDiv = 4;
    globalThis.subdivStart = 0;
    globalThis.subdivStartTime = 0;
    globalThis.tpSubdiv = 30;
    globalThis.spSubdiv = 0.03125;
    globalThis.subsubdivIndex = 0;
    globalThis.subsubsPerSub = 4;
    globalThis.subsubdivStart = 0;
    globalThis.subsubdivStartTime = 0;
    globalThis.tpSubsubdiv = 7.5;
    globalThis.spSubsubdiv = 0.0078125;
    globalThis.formatTime = (t) => t.toFixed(3);
  });

  it('should log section marker when LOG includes section', () => {
    globalThis.LOG = 'section';
    logUnit('section');
    expect(c.rows.length).toBe(1);
    expect(c.rows[0].type).toBe('marker_t');
    expect(c.rows[0].vals[0]).toContain('Section');
  });

  it('should log phrase marker when LOG includes phrase', () => {
    globalThis.LOG = 'phrase';
    logUnit('phrase');
    expect(c.rows.length).toBe(1);
    expect(c.rows[0].type).toBe('marker_t');
    expect(c.rows[0].vals[0]).toContain('Phrase');
  });

  it('should log measure marker when LOG includes measure', () => {
    globalThis.LOG = 'measure';
    logUnit('measure');
    expect(c.rows.length).toBe(1);
    expect(c.rows[0].type).toBe('marker_t');
    expect(c.rows[0].vals[0]).toContain('Measure');
  });

  it('should not log when LOG is none', () => {
    globalThis.LOG = 'none';
    logUnit('section');
    expect(c.rows.length).toBe(0);
  });

  it('should log all types when LOG is all', () => {
    globalThis.LOG = 'all';
    logUnit('section');
    logUnit('phrase');
    logUnit('measure');
    expect(c.rows.length).toBe(3);
  });

  it('should handle comma-separated LOG values', () => {
    globalThis.LOG = 'section,phrase';
    logUnit('section');
    logUnit('phrase');
    logUnit('measure');
    expect(c.rows.length).toBe(2);
  });

  it('should be case insensitive', () => {
    globalThis.LOG = 'SECTION';
    logUnit('section');
    expect(c.rows.length).toBe(1);
  });
});

describe('grandFinale', () => {
  beforeEach(() => {
    setupGlobalState();
    // Mock fs methods - necessary for file I/O tests
    globalThis.fs = {
      writeFileSync: vi.fn(),
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn()
    };
    // Reset LM
    globalThis.LM = {
      layers: {}
    };
    globalThis.PPQ = 480;
    globalThis.SILENT_OUTRO_SECONDS = 1;
    globalThis.tpSec = 960;
    // Mock these functions - they have external dependencies (allCHs array, etc.)
    globalThis.allNotesOff = vi.fn(() => []);
    globalThis.muteAll = vi.fn(() => []);
    globalThis.rf = (min, max) => (min + max) / 2;
  });

  it('should write output files for each layer', () => {
    const primaryBuffer = new CSVBuffer('primary');
    primaryBuffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });
    const polyBuffer = new CSVBuffer('poly');
    polyBuffer.push({ tick: 0, type: 'on', vals: [1, 64, 100] });

    LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer: primaryBuffer
      },
      poly: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer: polyBuffer
      }
    };

    grandFinale();

    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    expect(fs.writeFileSync).toHaveBeenCalledWith('output/output1.csv', expect.any(String));
    expect(fs.writeFileSync).toHaveBeenCalledWith('output/output2.csv', expect.any(String));
  });

  it('should include header and track markers in CSV', () => {
    const buffer = new CSVBuffer('primary');
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });

    LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale();

    const csvContent = fs.writeFileSync.mock.calls[0][1];
    expect(csvContent).toContain('header,1,1,480');
    expect(csvContent).toContain('start_track');
    expect(csvContent).toContain('end_track');
  });

  it('should filter out null entries', () => {
    const buffer = new CSVBuffer('primary');
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });
    buffer.push(null);
    buffer.push({ tick: 100, type: 'on', vals: [0, 64, 100] });

    LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale();

    const csvContent = fs.writeFileSync.mock.calls[0][1];
    const lines = csvContent.split('\n').filter(line => line.includes('note_on_c'));
    expect(lines.length).toBe(2); // Only 2 note events, null filtered
  });

  it('should sort events by tick', () => {
    const buffer = new CSVBuffer('primary');
    buffer.push({ tick: 100, type: 'on', vals: [0, 64, 100] });
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });
    buffer.push({ tick: 50, type: 'on', vals: [0, 62, 100] });

    LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale();

    const csvContent = fs.writeFileSync.mock.calls[0][1];
    const lines = csvContent.split('\n').filter(line => line.includes('note_on_c'));
    expect(lines[0]).toContain(',0,');
    expect(lines[1]).toContain(',50,');
    expect(lines[2]).toContain(',100,');
  });

  it('should handle custom layer names', () => {
    const buffer = new CSVBuffer('custom');
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });

    LM.layers = {
      custom: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale();

    expect(fs.writeFileSync).toHaveBeenCalledWith('output/outputCustom.csv', expect.any(String));
  });
});

describe('fs error handling', () => {
  it('should wrap fs.writeFileSync for error logging', () => {
    expect(typeof fs.writeFileSync).toBe('function');
  });
});
