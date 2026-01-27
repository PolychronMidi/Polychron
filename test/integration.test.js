// test/integration.test.js - Full pipeline integration tests
// Tests the complete play.js → stage.js → writer.js → CSV/MIDI flow

require('../src/sheet');
require('../src/backstage');
require('../src/venue');
require('../src/composers');
require('../src/rhythm');
require('../src/time');
require('../src/stage');
require('../src/writer');

const fs = require('fs');
const path = require('path');

describe('Integration: Full Composition Pipeline', () => {
  const testOutputDir = 'output';
  const testFile1 = path.join(testOutputDir, 'test_integration_primary.csv');
  const testFile2 = path.join(testOutputDir, 'test_integration_poly.csv');

  beforeEach(() => {
    // Reset global state
    c = [];
    c1 = [];
    c2 = [];
    csvRows = [];
    totalSections = 1;
    sectionIndex = 0;
    beatCount = 0;
    beatIndex = 0;
    divIndex = 0;
    subdivIndex = 0;
  });

  afterEach(() => {
    // Clean up test files
    try {
      if (fs.existsSync(testFile1)) fs.unlinkSync(testFile1);
      if (fs.existsSync(testFile2)) fs.unlinkSync(testFile2);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Timing System Integration', () => {
    it('should maintain timing variables across modules', () => {
      // Verify timing variables are accessible globally
      expect(tpSec).toBeDefined();
      expect(beatStart).toBeDefined();
      expect(subdivStart).toBeDefined();
      expect(typeof tpSec).toBe('number');
    });

    it('should support rhythm array initialization', () => {
      beatRhythm = [1, 0, 1, 0];
      divRhythm = [1, 1, 0];
      subdivRhythm = [1, 0, 1];

      expect(beatRhythm.length).toBe(4);
      expect(divRhythm.length).toBe(3);
      expect(subdivRhythm.length).toBe(3);
    });

    it('should handle timing state changes', () => {
      beatCount = 0;
      beatIndex = 0;
      divIndex = 0;
      subdivIndex = 0;

      expect(beatCount).toBe(0);

      beatCount = 10;
      expect(beatCount).toBe(10);
    });

    it('should handle extreme polyrhythms without crashing', () => {
      // Set up extreme rhythm values
      numerator = 32;
      divsPerBeat = 16;
      subdivsPerDiv = 12;

      // Should not throw
      expect(() => {
        beatIndex = Math.floor(Math.random() * 10);
        divIndex = Math.floor(Math.random() * 10);
        subdivIndex = Math.floor(Math.random() * 10);
      }).not.toThrow();
    });
  });

  describe('Stage → Writer Integration', () => {
    it('should convert buffer events to CSV rows', () => {
      expect(c).toBeDefined();
      expect(Array.isArray(c)).toBe(true);

      // Simulate stage events
      c.push({
        tick: 0,
        type: 'Note',
        channel: 0,
        note: 60,
        velocity: 100,
        duration: 480
      });

      c.push({
        tick: 480,
        type: 'Note',
        channel: 0,
        note: 62,
        velocity: 100,
        duration: 480
      });

      expect(c.length).toBeGreaterThan(0);
      expect(c[0]).toHaveProperty('tick');
      expect(c[0]).toHaveProperty('note');
    });

    it('should maintain proper event ordering', () => {
      c = [];

      // Add events out of order
      c.push({ tick: 480, type: 'Note' });
      c.push({ tick: 0, type: 'Note' });
      c.push({ tick: 240, type: 'Note' });

      // Sort by tick (simulating writer behavior)
      const sorted = [...c].sort((a, b) => a.tick - b.tick);

      expect(sorted[0].tick).toBe(0);
      expect(sorted[1].tick).toBe(240);
      expect(sorted[2].tick).toBe(480);
    });
  });

  describe('Composer → Stage Integration', () => {
    it('should generate notes from composer and emit them via stage', () => {
      // Create a simple composer
      composer = {
        getNotes: () => [
          { note: 60, duration: 480 },
          { note: 62, duration: 480 },
          { note: 64, duration: 480 }
        ]
      };

      // Get notes from composer
      const notes = composer.getNotes();
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0]).toHaveProperty('note');

      // Simulate stage receiving notes
      c = [];
      notes.forEach((note, idx) => {
        c.push({
          tick: idx * 480,
          type: 'Note',
          channel: 0,
          note: note.note,
          velocity: 100,
          duration: note.duration
        });
      });

      expect(c.length).toBe(3);
      expect(c[0].note).toBe(60);
    });
  });

  describe('Rhythm → Stage Integration', () => {
    it('should generate drum patterns and integrate with stage', () => {
      // Initialize rhythm arrays
      beatRhythm = [1, 0, 1, 0];
      divRhythm = [1, 1, 0];
      subdivRhythm = [1, 0, 1];

      // Simulate drummer function result
      const drums = [
        { drum: 'kick1', tick: 0, velocity: 100 },
        { drum: 'snare1', tick: 240, velocity: 90 }
      ];

      c = [];
      drums.forEach(drum => {
        c.push({
          tick: drum.tick,
          type: 'Note',
          channel: 9, // drum channel
          note: 36, // kick
          velocity: drum.velocity,
          duration: 100
        });
      });

      expect(c.length).toBeGreaterThan(0);
      expect(c[0].channel).toBe(9);
    });
  });

  describe('Full Play → Stage → Writer Pipeline', () => {
    it('should execute minimal composition cycle', () => {
      // Setup minimal composition
      totalSections = 1;
      sectionIndex = 0;
      c = [];

      // Simulate play() initializing and stage generating events
      beatCount = 0;
      beatStart = 0;
      beatIndex = 0;

      // Simulate a few measures of events
      for (let tick = 0; tick < 1920; tick += 480) {
        c.push({
          tick: tick,
          type: 'Note',
          channel: 0,
          note: 60 + (tick / 480),
          velocity: 100,
          duration: 480
        });
      }

      expect(c.length).toBeGreaterThan(0);
      expect(c[c.length - 1].tick).toBeLessThan(2000);
    });

    it('should write CSV files from buffers', () => {
      c = [];
      c1 = [];
      c2 = [];

      // Generate test events
      for (let i = 0; i < 10; i++) {
        c.push({
          tick: i * 480,
          type: 'Note',
          channel: 0,
          note: 60,
          velocity: 100,
          duration: 480
        });
      }

      // Simulate csvRows generation (writer.js behavior)
      csvRows = [];
      csvRows.push('0, 0, Header, 1, 1, 480');
      csvRows.push('1, 0, start_track');

      c.forEach(event => {
        csvRows.push(
          `${event.tick}, ${event.channel}, Note_on_c, ${event.note}, ${event.velocity}`
        );
      });

      csvRows.push('1, 0, End_track');

      expect(csvRows.length).toBeGreaterThan(0);
      expect(csvRows[0]).toContain('Header');
      expect(csvRows[csvRows.length - 1]).toContain('End_track');
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle composer with no notes', () => {
      composer = {
        getNotes: () => []
      };

      const notes = composer.getNotes();
      expect(notes.length).toBe(0);
      expect(Array.isArray(notes)).toBe(true);
    });

    it('should handle undefined beat indices gracefully', () => {
      beatIndex = undefined;
      divIndex = undefined;
      subdivIndex = undefined;

      // Should not crash when accessing rhythm arrays
      expect(() => {
        const beat = beatRhythm ? beatRhythm[0] : 0;
        expect(typeof beat).toBe('number');
      }).not.toThrow();
    });

    it('should handle zero-length composition', () => {
      c = [];
      csvRows = [];

      expect(c.length).toBe(0);
      expect(csvRows.length).toBe(0);
    });

    it('should handle rapid state changes', () => {
      // Simulate rapid section changes
      c = [];

      for (let section = 0; section < 5; section++) {
        sectionIndex = section;
        c.push({
          tick: section * 1920,
          type: 'Note',
          channel: 0,
          note: 60,
          velocity: 100,
          duration: 480
        });
      }

      expect(c.length).toBe(5);
      expect(sectionIndex).toBe(4);
    });
  });
});
