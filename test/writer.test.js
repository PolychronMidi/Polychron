// test/writer.test.js
require('../src/sheet');  // Load constants
require('../src/backstage');  // Load backstage utilities (needed for tests)
require('../src/writer');  // Load writer functions (CSVBuffer, p, grandFinale, logUnit, fs)

// Setup function
function setupGlobalState() {
  c = [];
  csvRows = [];
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
    setupGlobalState();
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
    LOG = 'all';
    c = new CSVBuffer('test');
    sectionIndex = 0;
    totalSections = 1;
    sectionStart = 0;
    sectionStartTime = 0;
    tpSection = 1920;
    tpSec = 960;
    phraseIndex = 0;
    phrasesPerSection = 1;
    phraseStart = 0;
    phraseStartTime = 0;
    tpPhrase = 1920;
    numerator = 4;
    denominator = 4;
    midiMeter = [4, 4];
    composer = null;
    measureIndex = 0;
    measuresPerPhrase = 1;
    measureStart = 0;
    measureStartTime = 0;
    tpMeasure = 1920;
    spMeasure = 2;
    beatIndex = 0;
    beatStart = 0;
    beatStartTime = 0;
    tpBeat = 480;
    spBeat = 0.5;
    divIndex = 0;
    divsPerBeat = 4;
    divStart = 0;
    divStartTime = 0;
    tpDiv = 120;
    spDiv = 0.125;
    subdivIndex = 0;
    subdivsPerDiv = 4;
    subdivStart = 0;
    subdivStartTime = 0;
    tpSubdiv = 30;
    spSubdiv = 0.03125;
    subsubdivIndex = 0;
    subsubsPerSub = 4;
    subsubdivStart = 0;
    subsubdivStartTime = 0;
    tpSubsubdiv = 7.5;
    spSubsubdiv = 0.0078125;
    formatTime = (t) => t.toFixed(3);
  });

  it('should log section marker when LOG includes section', () => {
    LOG = 'section';
    logUnit('section');
    expect(c.rows.length).toBe(1);
    expect(c.rows[0].type).toBe('marker_t');
    expect(c.rows[0].vals[0]).toContain('Section');
  });

  it('should log phrase marker when LOG includes phrase', () => {
    LOG = 'phrase';
    logUnit('phrase');
    expect(c.rows.length).toBe(1);
    expect(c.rows[0].type).toBe('marker_t');
    expect(c.rows[0].vals[0]).toContain('Phrase');
  });

  it('should log measure marker when LOG includes measure', () => {
    LOG = 'measure';
    logUnit('measure');
    expect(c.rows.length).toBe(1);
    expect(c.rows[0].type).toBe('marker_t');
    expect(c.rows[0].vals[0]).toContain('Measure');
  });

  it('should not log when LOG is none', () => {
    LOG = 'none';
    logUnit('section');
    expect(c.rows.length).toBe(0);
  });

  it('should log all types when LOG is all', () => {
    LOG = 'all';
    logUnit('section');
    logUnit('phrase');
    logUnit('measure');
    expect(c.rows.length).toBe(3);
  });

  it('should handle comma-separated LOG values', () => {
    LOG = 'section,phrase';
    logUnit('section');
    logUnit('phrase');
    logUnit('measure');
    expect(c.rows.length).toBe(2);
  });

  it('should be case insensitive', () => {
    LOG = 'SECTION';
    logUnit('section');
    expect(c.rows.length).toBe(1);
  });
});

describe('grandFinale', () => {
  beforeEach(() => {
    setupGlobalState();
    // Mock fs methods - necessary for file I/O tests
    fs = {
      writeFileSync: vi.fn(),
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => ''),
      mkdirSync: vi.fn(),
      renameSync: vi.fn()
    };
    // Propagate into test namespace for grandFinale compatibility
    try { __POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; __POLYCHRON_TEST__.fs = fs; __POLYCHRON_TEST__.allowMissingLayerCanonical = true; } catch (e) { /* swallow */ }
    // Reset LM
    LM = {
      layers: {}
    };
    PPQ = 480;
    SILENT_OUTRO_SECONDS = 1;
    tpSec = 960;
    // Mock these functions - they have external dependencies (allCHs array, etc.)
    allNotesOff = vi.fn(() => []);
    muteAll = vi.fn(() => []);
    rf = (min, max) => (min + max) / 2;
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

    // Ensure the CSV outputs were written (masterMap finalize may add extra writes)
    const csvWrites = fs.writeFileSync.mock.calls.filter(call => String(call[0]).includes('output/output1.csv') || String(call[0]).includes('output/output2.csv'));
    expect(csvWrites.length).toBe(2);
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
    const ticks = lines.map(l => {
      const fields = l.split(',');
      const tickField = fields[1] || '';
      return String(tickField).split('|')[0];
    });
    expect(ticks[0]).toBe('0');
    expect(ticks[1]).toBe('50');
    expect(ticks[2]).toBe('100');
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

  it('should append unit id to trailing events and emit one unitRec marker', () => {
    const buffer = new CSVBuffer('primary');
    // event after last unit end
    buffer.push({ tick: 1500, type: 'on', vals: [0, 60, 100] });

    // layer state contains a single unit that ends at 1000
    LM.layers = {
      primary: {
        state: {
          sectionStart: 0,
          sectionEnd: 1920,
          units: [
            { parts: ['section1','phrase1'], unitNumber: 1, unitsPerParent: 1, startTick: 0, endTick: 1000, startTime: 0, endTime: 1, type: 'phrase' }
          ]
        },
        buffer
      }
    };

    // Pre-populate (fresh) master map to simulate live emissions
    const MasterMap = require('../src/masterMap');
    MasterMap.reset();
    MasterMap.addUnit({ parts: ['section1','phrase1'], layer: 'primary', startTick: 0, endTick: 1000, startTime: 0, endTime: 1, raw: {} });

    grandFinale();

    const csvContent = fs.writeFileSync.mock.calls.find(c => c[0] === 'output/output1.csv')[1];
    // Should have a single outro marker and the event tick should include the explicit outro unit id
    expect(csvContent).toContain('1,1500,marker_t,unitRec:layer1outro|1500-1500');
    expect(csvContent).toContain('1,1500|layer1outro|1500-1500,note_on_c,0,60,100');
  });

  it('should write unitMasterMap.json atomically when finalizing', () => {
    const MasterMap = require('../src/masterMap');
    MasterMap.reset();
    MasterMap.addUnit({ parts: ['section1','phrase1'], layer: 'primary', startTick: 0, endTick: 1000, startTime: 0, endTime: 1, raw: {} });

    // Minimal LM with a single layer to trigger grandFinale flow
    const buffer = new CSVBuffer('primary'); buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });
    LM.layers = { primary: { state: { sectionStart: 0, sectionEnd: 1920, units: [] }, buffer } };

    grandFinale();

    expect(fs.writeFileSync).toHaveBeenCalled();
    // Finalization should perform a rename (atomic intent). Exact tmp path may vary in test env.
    expect(fs.renameSync).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expect.stringContaining('unitMasterMap.json'));
  });
});

describe('fs error handling', () => {
  it('should wrap fs.writeFileSync for error logging', () => {
    expect(typeof fs.writeFileSync).toBe('function');
  });
});
