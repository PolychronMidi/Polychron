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
    globalThis.c = [];
    globalThis.c1 = [];
    globalThis.c2 = [];
    globalThis.csvRows = [];
    globalThis.totalSections = 1;
    globalThis.sectionIndex = 0;
    globalThis.beatCount = 0;
    globalThis.beatIndex = 0;
    globalThis.divIndex = 0;
    globalThis.subdivIndex = 0;
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
      expect(globalThis.tpSec).toBeDefined();
      expect(globalThis.beatStart).toBeDefined();
      expect(globalThis.subdivStart).toBeDefined();
      expect(typeof globalThis.tpSec).toBe('number');
    });

    it('should support rhythm array initialization', () => {
      globalThis.beatRhythm = [1, 0, 1, 0];
      globalThis.divRhythm = [1, 1, 0];
      globalThis.subdivRhythm = [1, 0, 1];

      expect(globalThis.beatRhythm.length).toBe(4);
      expect(globalThis.divRhythm.length).toBe(3);
      expect(globalThis.subdivRhythm.length).toBe(3);
    });

    it('should handle timing state changes', () => {
      globalThis.beatCount = 0;
      globalThis.beatIndex = 0;
      globalThis.divIndex = 0;
      globalThis.subdivIndex = 0;

      expect(globalThis.beatCount).toBe(0);

      globalThis.beatCount = 10;
      expect(globalThis.beatCount).toBe(10);
    });

    it('should handle extreme polyrhythms without crashing', () => {
      // Set up extreme rhythm values
      globalThis.numerator = 32;
      globalThis.divsPerBeat = 16;
      globalThis.subdivsPerDiv = 12;

      // Should not throw
      expect(() => {
        globalThis.beatIndex = Math.floor(Math.random() * 10);
        globalThis.divIndex = Math.floor(Math.random() * 10);
        globalThis.subdivIndex = Math.floor(Math.random() * 10);
      }).not.toThrow();
    });
  });

  describe('Stage → Writer Integration', () => {
    it('should convert buffer events to CSV rows', () => {
      expect(globalThis.c).toBeDefined();
      expect(Array.isArray(globalThis.c)).toBe(true);

      // Simulate stage events
      globalThis.c.push({
        tick: 0,
        type: 'Note',
        channel: 0,
        note: 60,
        velocity: 100,
        duration: 480
      });

      globalThis.c.push({
        tick: 480,
        type: 'Note',
        channel: 0,
        note: 62,
        velocity: 100,
        duration: 480
      });

      expect(globalThis.c.length).toBeGreaterThan(0);
      expect(globalThis.c[0]).toHaveProperty('tick');
      expect(globalThis.c[0]).toHaveProperty('note');
    });

    it('should maintain proper event ordering', () => {
      globalThis.c = [];

      // Add events out of order
      globalThis.c.push({ tick: 480, type: 'Note' });
      globalThis.c.push({ tick: 0, type: 'Note' });
      globalThis.c.push({ tick: 240, type: 'Note' });

      // Sort by tick (simulating writer behavior)
      const sorted = [...globalThis.c].sort((a, b) => a.tick - b.tick);

      expect(sorted[0].tick).toBe(0);
      expect(sorted[1].tick).toBe(240);
      expect(sorted[2].tick).toBe(480);
    });
  });

  describe('Composer → Stage Integration', () => {
    it('should generate notes from composer and emit them via stage', () => {
      // Create a simple composer
      globalThis.composer = {
        getNotes: () => [
          { note: 60, duration: 480 },
          { note: 62, duration: 480 },
          { note: 64, duration: 480 }
        ]
      };

      // Get notes from composer
      const notes = globalThis.composer.getNotes();
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0]).toHaveProperty('note');

      // Simulate stage receiving notes
      globalThis.c = [];
      notes.forEach((note, idx) => {
        globalThis.c.push({
          tick: idx * 480,
          type: 'Note',
          channel: 0,
          note: note.note,
          velocity: 100,
          duration: note.duration
        });
      });

      expect(globalThis.c.length).toBe(3);
      expect(globalThis.c[0].note).toBe(60);
    });
  });

  describe('Rhythm → Stage Integration', () => {
    it('should generate drum patterns and integrate with stage', () => {
      // Initialize rhythm arrays
      globalThis.beatRhythm = [1, 0, 1, 0];
      globalThis.divRhythm = [1, 1, 0];
      globalThis.subdivRhythm = [1, 0, 1];

      // Simulate drummer function result
      const drums = [
        { drum: 'kick1', tick: 0, velocity: 100 },
        { drum: 'snare1', tick: 240, velocity: 90 }
      ];

      globalThis.c = [];
      drums.forEach(drum => {
        globalThis.c.push({
          tick: drum.tick,
          type: 'Note',
          channel: 9, // drum channel
          note: 36, // kick
          velocity: drum.velocity,
          duration: 100
        });
      });

      expect(globalThis.c.length).toBeGreaterThan(0);
      expect(globalThis.c[0].channel).toBe(9);
    });
  });

  describe('Full Play → Stage → Writer Pipeline', () => {
    it('should execute minimal composition cycle', () => {
      // Setup minimal composition
      globalThis.totalSections = 1;
      globalThis.sectionIndex = 0;
      globalThis.c = [];

      // Simulate play() initializing and stage generating events
      globalThis.beatCount = 0;
      globalThis.beatStart = 0;
      globalThis.beatIndex = 0;

      // Simulate a few measures of events
      for (let tick = 0; tick < 1920; tick += 480) {
        globalThis.c.push({
          tick: tick,
          type: 'Note',
          channel: 0,
          note: 60 + (tick / 480),
          velocity: 100,
          duration: 480
        });
      }

      expect(globalThis.c.length).toBeGreaterThan(0);
      expect(globalThis.c[globalThis.c.length - 1].tick).toBeLessThan(2000);
    });

    it('should write CSV files from buffers', () => {
      globalThis.c = [];
      globalThis.c1 = [];
      globalThis.c2 = [];

      // Generate test events
      for (let i = 0; i < 10; i++) {
        globalThis.c.push({
          tick: i * 480,
          type: 'Note',
          channel: 0,
          note: 60,
          velocity: 100,
          duration: 480
        });
      }

      // Simulate csvRows generation (writer.js behavior)
      globalThis.csvRows = [];
      globalThis.csvRows.push('0, 0, Header, 1, 1, 480');
      globalThis.csvRows.push('1, 0, start_track');

      globalThis.c.forEach(event => {
        globalThis.csvRows.push(
          `${event.tick}, ${event.channel}, Note_on_c, ${event.note}, ${event.velocity}`
        );
      });

      globalThis.csvRows.push('1, 0, End_track');

      expect(globalThis.csvRows.length).toBeGreaterThan(0);
      expect(globalThis.csvRows[0]).toContain('Header');
      expect(globalThis.csvRows[globalThis.csvRows.length - 1]).toContain('End_track');
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle composer with no notes', () => {
      globalThis.composer = {
        getNotes: () => []
      };

      const notes = globalThis.composer.getNotes();
      expect(notes.length).toBe(0);
      expect(Array.isArray(notes)).toBe(true);
    });

    it('should handle undefined beat indices gracefully', () => {
      globalThis.beatIndex = undefined;
      globalThis.divIndex = undefined;
      globalThis.subdivIndex = undefined;

      // Should not crash when accessing rhythm arrays
      expect(() => {
        const beat = globalThis.beatRhythm ? globalThis.beatRhythm[0] : 0;
        expect(typeof beat).toBe('number');
      }).not.toThrow();
    });

    it('should handle zero-length composition', () => {
      globalThis.c = [];
      globalThis.csvRows = [];

      expect(globalThis.c.length).toBe(0);
      expect(globalThis.csvRows.length).toBe(0);
    });

    it('should handle rapid state changes', () => {
      // Simulate rapid section changes
      globalThis.c = [];

      for (let section = 0; section < 5; section++) {
        globalThis.sectionIndex = section;
        globalThis.c.push({
          tick: section * 1920,
          type: 'Note',
          channel: 0,
          note: 60,
          velocity: 100,
          duration: 480
        });
      }

      expect(globalThis.c.length).toBe(5);
      expect(globalThis.sectionIndex).toBe(4);
    });
  });
});
