// test/writer.test.ts - Testing CSV buffer and writer functions
import { CSVBuffer, grandFinale, logUnit, registerWriterServices } from '../src/writer.js';
import { createTestContext } from './helpers.module.js';

// Test global access for tests still using globalThis.c
let c: any;
let pFn: any;

// Setup function
function setupLocalState() {
  const ctx = createTestContext();
  registerWriterServices(ctx.services);
  pFn = ctx.services.get('pushMultiple');
  c = [];
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
    pFn(c, { a: 1 });
    expect(c).toEqual([{ a: 1 }]);
  });

  it('should push multiple items', () => {
    pFn(c, { a: 1 }, { b: 2 }, { c: 3 });
    expect(c).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('should handle empty push', () => {
    pFn(c);
    expect(c).toEqual([]);
  });

  it('should work with existing array items', () => {
    c = [{ x: 0 }];
    pFn(c, { a: 1 }, { b: 2 });
    expect(c).toEqual([{ x: 0 }, { a: 1 }, { b: 2 }]);
  });

  it('should work with CSVBuffer', () => {
    const buffer = new CSVBuffer('test');
    pFn(buffer, { a: 1 }, { b: 2 });
    expect(buffer.rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(buffer.length).toBe(2);
  });
});

describe('logUnit', () => {
  let env: Record<string, any>;
  beforeEach(() => {
    // Use test context and pass an env object to `logUnit` to avoid global mutations
    const ctx = createTestContext();
    registerWriterServices(ctx.services);
    const buffer = new CSVBuffer('test');
    env = {
      LOG: 'all',
      c: buffer,
      csvBuffer: buffer,
      sectionIndex: 0,
      totalSections: 1,
      sectionStart: 0,
      sectionStartTime: 0,
      tpSection: 1920,
      tpSec: 960,
      phraseIndex: 0,
      phrasesPerSection: 1,
      phraseStart: 0,
      phraseStartTime: 0,
      tpPhrase: 1920,
      numerator: 4,
      denominator: 4,
      midiMeter: [4, 4],
      composer: null,
      measureIndex: 0,
      measuresPerPhrase: 1,
      measureStart: 0,
      measureStartTime: 0,
      tpMeasure: 1920,
      spMeasure: 2,
      beatIndex: 0,
      beatStart: 0,
      beatStartTime: 0,
      tpBeat: 480,
      spBeat: 0.5,
      divIndex: 0,
      divsPerBeat: 4,
      divStart: 0,
      divStartTime: 0,
      tpDiv: 120,
      spDiv: 0.125,
      subdivIndex: 0,
      subdivsPerDiv: 4,
      subdivStart: 0,
      subdivStartTime: 0,
      tpSubdiv: 30,
      spSubdiv: 0.03125,
      subsubdivIndex: 0,
      subsubsPerSub: 4,
      subsubdivStart: 0,
      subsubdivStartTime: 0,
      tpSubsubdiv: 7.5,
      spSubsubdiv: 0.0078125,
      formatTime: (t: number) => t.toFixed(3),
      services: ctx.services,
      container: ctx.container
    };
  });

  it('should log section marker when LOG includes section', () => {
    env.LOG = 'section';
    logUnit('section', env);
    expect(env.c.rows.length).toBe(1);
    expect(env.c.rows[0].type).toBe('marker_t');
    expect(env.c.rows[0].vals[0]).toContain('Section');
  });

  it('should log phrase marker when LOG includes phrase', () => {
    env.LOG = 'phrase';
    logUnit('phrase', env);
    expect(env.c.rows.length).toBe(1);
    expect(env.c.rows[0].type).toBe('marker_t');
    expect(env.c.rows[0].vals[0]).toContain('Phrase');
  });

  it('should log measure marker when LOG includes measure', () => {
    env.LOG = 'measure';
    logUnit('measure', env);
    expect(env.c.rows.length).toBe(1);
    expect(env.c.rows[0].type).toBe('marker_t');
    expect(env.c.rows[0].vals[0]).toContain('Measure');
  });

  it('should not log when LOG is none', () => {
    env.LOG = 'none';
    logUnit('section', env);
    expect(env.c.rows.length).toBe(0);
  });

  it('should log all types when LOG is all', () => {
    env.LOG = 'all';
    logUnit('section', env);
    logUnit('phrase', env);
    logUnit('measure', env);
    expect(env.c.rows.length).toBe(3);
  });

  it('should handle comma-separated LOG values', () => {
    env.LOG = 'section,phrase';
    logUnit('section', env);
    logUnit('phrase', env);
    logUnit('measure', env);
    expect(env.c.rows.length).toBe(2);
  });

  it('should be case insensitive', () => {
    env.LOG = 'SECTION';
    logUnit('section', env);
    expect(env.c.rows.length).toBe(1);
  });
});

describe('grandFinale', () => {
  let env: any;
  beforeEach(() => {
    // Use DI test context instead of legacy global setup
    const ctx = createTestContext();
    registerWriterServices(ctx.services);
    // Mock fs methods - necessary for file I/O tests
    const fsMock: any = {
      writeFileSync: vi.fn(),
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn()
    };

    // Reset LM
    const LMobj: any = { layers: {} };

    env = {
      fs: fsMock,
      LM: LMobj,
      PPQ: 480,
      SILENT_OUTRO_SECONDS: 1,
      tpSec: 960,
      allNotesOff: vi.fn(() => []),
      muteAll: vi.fn(() => []),
      rf: (min: number, max: number) => (min + max) / 2,
      services: ctx.services,
      container: ctx.container
    };
  });

  it('should write output files for each layer', () => {
    const primaryBuffer = new CSVBuffer('primary');
    primaryBuffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });
    const polyBuffer = new CSVBuffer('poly');
    polyBuffer.push({ tick: 0, type: 'on', vals: [1, 64, 100] });

    env.LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer: primaryBuffer
      },
      poly: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer: polyBuffer
      }
    };

    grandFinale(env);

    expect(env.fs.writeFileSync).toHaveBeenCalledTimes(2);
    expect(env.fs.writeFileSync).toHaveBeenCalledWith('output/output1.csv', expect.any(String));
    expect(env.fs.writeFileSync).toHaveBeenCalledWith('output/output2.csv', expect.any(String));
  });

  it('should include header and track markers in CSV', () => {
    const buffer = new CSVBuffer('primary');
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });

    env.LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale(env);

    const csvContent = env.fs.writeFileSync.mock.calls[0][1];
    expect(csvContent).toContain('header,1,1,480');
    expect(csvContent).toContain('start_track');
    expect(csvContent).toContain('end_track');
  });

  it('should filter out null entries', () => {
    const buffer = new CSVBuffer('primary');
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });
    buffer.push(null);
    buffer.push({ tick: 100, type: 'on', vals: [0, 64, 100] });

    env.LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale(env);

    const csvContent = env.fs.writeFileSync.mock.calls[0][1];
    const lines = csvContent.split('\n').filter(line => line.includes('note_on_c'));
    expect(lines.length).toBe(2); // Only 2 note events, null filtered
  });

  it('should sort events by tick', () => {
    const buffer = new CSVBuffer('primary');
    buffer.push({ tick: 100, type: 'on', vals: [0, 64, 100] });
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });
    buffer.push({ tick: 50, type: 'on', vals: [0, 62, 100] });

    env.LM.layers = {
      primary: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale(env);

    const csvContent = env.fs.writeFileSync.mock.calls[0][1];
    const lines = csvContent.split('\n').filter(line => line.includes('note_on_c'));
    expect(lines[0]).toContain(',0,');
    expect(lines[1]).toContain(',50,');
    expect(lines[2]).toContain(',100,');
  });

  it('should handle custom layer names', () => {
    const buffer = new CSVBuffer('custom');
    buffer.push({ tick: 0, type: 'on', vals: [0, 60, 100] });

    env.LM.layers = {
      custom: {
        state: { sectionStart: 0, sectionEnd: 1920 },
        buffer
      }
    };

    grandFinale(env);

    expect(env.fs.writeFileSync).toHaveBeenCalledWith('output/outputCustom.csv', expect.any(String));
  });
});

describe('fs error handling', () => {
  it('should provide fs service via DI for error logging', () => {
    const ctx = createTestContext();
    registerWriterServices(ctx.services);
    const fsSvc: any = ctx.services.get('fs');
    expect(typeof fsSvc.writeFileSync).toBe('function');
  });
});
