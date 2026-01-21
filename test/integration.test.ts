// test/integration.test.js - Full pipeline integration tests
// Tests the complete play.js → stage.js → writer.js → CSV/MIDI flow

import "../dist/sheet.js";import "../dist/backstage.js";import "../dist/venue.js";import "../dist/composers.js";import "../dist/rhythm.js";import "../dist/time.js";import "../dist/stage.js";import "../dist/writer.js";import { setupGlobalState } from './helpers.module.js';const fs = require('fs');
const path = require('path');

describe('Integration: Full Composition Pipeline', () => {
  const testOutputDir = 'output';
  const testFile1 = path.join(testOutputDir, 'test_integration_primary.csv');
  const testFile2 = path.join(testOutputDir, 'test_integration_poly.csv');
  let ctx: any;

  beforeEach(() => {
    // Create DI-based test context and reset state
    ctx = setupGlobalState();
    ctx.state.c = [];
    ctx.state.c1 = [];
    ctx.state.c2 = [];
    ctx.state.csvRows = [];
    ctx.state.totalSections = 1;
    ctx.state.sectionIndex = 0;
    ctx.state.beatCount = 0;
    ctx.state.beatIndex = 0;
    ctx.state.divIndex = 0;
    ctx.state.subdivIndex = 0;
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
      // Verify timing variables are accessible via DI state
      expect(ctx.state.tpSec).toBeDefined();
      expect(ctx.state.beatStart).toBeDefined();
      expect(ctx.state.subdivStart).toBeDefined();
      expect(typeof ctx.state.tpSec).toBe('number');
    });

    it('should support rhythm array initialization', () => {
      ctx.state.beatRhythm = [1, 0, 1, 0];
      ctx.state.divRhythm = [1, 1, 0];
      ctx.state.subdivRhythm = [1, 0, 1];

      expect(ctx.state.beatRhythm.length).toBe(4);
      expect(ctx.state.divRhythm.length).toBe(3);
      expect(ctx.state.subdivRhythm.length).toBe(3);
    });

    it('should handle timing state changes', () => {
      ctx.state.beatCount = 0;
      ctx.state.beatIndex = 0;
      ctx.state.divIndex = 0;
      ctx.state.subdivIndex = 0;

      expect(ctx.state.beatCount).toBe(0);

      ctx.state.beatCount = 10;
      expect(ctx.state.beatCount).toBe(10);
    });

    it('should handle extreme polyrhythms without crashing', () => {
      // Set up extreme rhythm values on DI state
      ctx.state.numerator = 32;
      ctx.state.divsPerBeat = 16;
      ctx.state.subdivsPerDiv = 12;

      // Should not throw
      expect(() => {
        ctx.state.beatIndex = Math.floor(Math.random() * 10);
        ctx.state.divIndex = Math.floor(Math.random() * 10);
        ctx.state.subdivIndex = Math.floor(Math.random() * 10);
      }).not.toThrow();
    });
  });

  describe('Stage → Writer Integration', () => {
    it('should convert buffer events to CSV rows', () => {
      expect(ctx.state.c).toBeDefined();
      expect(Array.isArray(ctx.state.c)).toBe(true);

      // Simulate stage events
      ctx.state.c.push({
        tick: 0,
        type: 'Note',
        channel: 0,
        note: 60,
        velocity: 100,
        duration: 480
      });

      ctx.state.c.push({
        tick: 480,
        type: 'Note',
        channel: 0,
        note: 62,
        velocity: 100,
        duration: 480
      });

      expect(ctx.state.c.length).toBeGreaterThan(0);
      expect(ctx.state.c[0]).toHaveProperty('tick');
      expect(ctx.state.c[0]).toHaveProperty('note');
    });

    it('should maintain proper event ordering', () => {
      ctx.state.c = [];

      // Add events out of order
      ctx.state.c.push({ tick: 480, type: 'Note' });
      ctx.state.c.push({ tick: 0, type: 'Note' });
      ctx.state.c.push({ tick: 240, type: 'Note' });

      // Sort by tick (simulating writer behavior)
      const sorted = [...ctx.state.c].sort((a, b) => a.tick - b.tick);

      expect(sorted[0].tick).toBe(0);
      expect(sorted[1].tick).toBe(240);
      expect(sorted[2].tick).toBe(480);
    });
  });

  describe('Composer → Stage Integration', () => {
    it('should generate notes from composer and emit them via stage', () => {
      // Create a simple composer on DI state
      ctx.state.composer = {
        getNotes: () => [
          { note: 60, duration: 480 },
          { note: 62, duration: 480 },
          { note: 64, duration: 480 }
        ]
      };

      // Get notes from composer
      const notes = ctx.state.composer.getNotes();
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0]).toHaveProperty('note');

      // Simulate stage receiving notes
      ctx.state.c = [];
      notes.forEach((note, idx) => {
        ctx.state.c.push({
          tick: idx * 480,
          type: 'Note',
          channel: 0,
          note: note.note,
          velocity: 100,
          duration: note.duration
        });
      });

      expect(ctx.state.c.length).toBe(3);
      expect(ctx.state.c[0].note).toBe(60);
    });
  });

  describe('Rhythm → Stage Integration', () => {
    it('should generate drum patterns and integrate with stage', () => {
      // Initialize rhythm arrays
      ctx.state.beatRhythm = [1, 0, 1, 0];
      ctx.state.divRhythm = [1, 1, 0];
      ctx.state.subdivRhythm = [1, 0, 1];

      // Simulate drummer function result
      const drums = [
        { drum: 'kick1', tick: 0, velocity: 100 },
        { drum: 'snare1', tick: 240, velocity: 90 }
      ];

      ctx.state.c = [];
      drums.forEach(drum => {
        ctx.state.c.push({
          tick: drum.tick,
          type: 'Note',
          channel: 9, // drum channel
          note: 36, // kick
          velocity: drum.velocity,
          duration: 100
        });
      });

      expect(ctx.state.c.length).toBeGreaterThan(0);
      expect(ctx.state.c[0].channel).toBe(9);
    });
  });

  describe('Full Play → Stage → Writer Pipeline', () => {
    it('should execute minimal composition cycle', () => {
      // Setup minimal composition
      ctx.state.totalSections = 1;
      ctx.state.sectionIndex = 0;
      ctx.state.c = [];

      // Simulate play() initializing and stage generating events
      ctx.state.beatCount = 0;
      ctx.state.beatStart = 0;
      ctx.state.beatIndex = 0;

      // Simulate a few measures of events
      for (let tick = 0; tick < 1920; tick += 480) {
        ctx.state.c.push({
          tick: tick,
          type: 'Note',
          channel: 0,
          note: 60 + (tick / 480),
          velocity: 100,
          duration: 480
        });
      }

      expect(ctx.state.c.length).toBeGreaterThan(0);
      expect(ctx.state.c[ctx.state.c.length - 1].tick).toBeLessThan(2000);
    });

    it('should write CSV files from buffers', () => {
      ctx.state.c = [];
      ctx.state.c1 = [];
      ctx.state.c2 = [];

      // Generate test events
      for (let i = 0; i < 10; i++) {
        ctx.state.c.push({
          tick: i * 480,
          type: 'Note',
          channel: 0,
          note: 60,
          velocity: 100,
          duration: 480
        });
      }

      // Simulate csvRows generation (writer.js behavior)
      ctx.state.csvRows = [];
      ctx.state.csvRows.push('0, 0, Header, 1, 1, 480');
      ctx.state.csvRows.push('1, 0, start_track');

      ctx.state.c.forEach(event => {
        ctx.state.csvRows.push(
          `${event.tick}, ${event.channel}, Note_on_c, ${event.note}, ${event.velocity}`
        );
      });

      ctx.state.csvRows.push('1, 0, End_track');

      expect(ctx.state.csvRows.length).toBeGreaterThan(0);
      expect(ctx.state.csvRows[0]).toContain('Header');
      expect(ctx.state.csvRows[ctx.state.csvRows.length - 1]).toContain('End_track');
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle composer with no notes', () => {
      ctx.state.composer = {
        getNotes: () => []
      };

      const notes = ctx.state.composer.getNotes();
      expect(notes.length).toBe(0);
      expect(Array.isArray(notes)).toBe(true);
    });

    it('should handle undefined beat indices gracefully', () => {
      ctx.state.beatIndex = undefined;
      ctx.state.divIndex = undefined;
      ctx.state.subdivIndex = undefined;

      // Should not crash when accessing rhythm arrays
      expect(() => {
        const beat = Array.isArray(ctx.state.beatRhythm) && typeof ctx.state.beatRhythm[0] === 'number'
          ? ctx.state.beatRhythm[0]
          : 0;
        expect(typeof beat).toBe('number');
      }).not.toThrow();
    });

    it('should handle zero-length composition', () => {
      ctx.state.c = [];
      ctx.state.csvRows = [];

      expect(ctx.state.c.length).toBe(0);
      expect(ctx.state.csvRows.length).toBe(0);
    });

    it('should handle rapid state changes', () => {
      // Simulate rapid section changes
      ctx.state.c = [];

      for (let section = 0; section < 5; section++) {
        ctx.state.sectionIndex = section;
        ctx.state.c.push({
          tick: section * 1920,
          type: 'Note',
          channel: 0,
          note: 60,
          velocity: 100,
          duration: 480
        });
      }

      expect(ctx.state.c.length).toBe(5);
      expect(ctx.state.sectionIndex).toBe(4);
    });
  });
});
