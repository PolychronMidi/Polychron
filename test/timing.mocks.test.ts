// test/timing.mocks.test.ts - Timing and LayerManager tests using mock infrastructure

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockTimingCalculator,
  createMockLayerManager,
  createTestConfig,
} from './fixtures/index.js';

describe('MockTimingCalculator - Comprehensive Tests', () => {
  let calc: any;

  beforeEach(() => {
    calc = createMockTimingCalculator({ tempo: 120, meter: [4, 4] });
  });

  describe('Tick Calculations', () => {
    it('should calculate standard 4/4 measure ticks', () => {
      const ticks = calc.calculateTicksPerMeasure();
      expect(ticks).toBe(1920); // 480 * 4
    });

    it('should calculate 3/4 measure ticks', () => {
      const calc34 = createMockTimingCalculator({ tempo: 120, meter: [3, 4] });
      const ticks = calc34.calculateTicksPerMeasure();
      expect(ticks).toBe(1440); // 480 * 3
    });

    it('should calculate compound time ticks', () => {
      const calc68 = createMockTimingCalculator({ tempo: 120, meter: [6, 8] });
      const ticks = calc68.calculateTicksPerMeasure();
      expect(ticks).toBeGreaterThan(0);
    });

    it('should maintain consistency across multiple calls', () => {
      const ticks1 = calc.calculateTicksPerMeasure();
      const ticks2 = calc.calculateTicksPerMeasure();
      const ticks3 = calc.calculateTicksPerMeasure();
      expect(ticks1).toBe(ticks2);
      expect(ticks2).toBe(ticks3);
    });
  });

  describe('Note Duration Calculations', () => {
    it('should calculate quarter note duration', () => {
      const duration = calc.calculateDuration(4);
      expect(duration).toBe(480);
    });

    it('should calculate whole note duration', () => {
      const duration = calc.calculateDuration(1);
      expect(duration).toBe(1920);
    });

    it('should calculate sixteenth note duration', () => {
      const duration = calc.calculateDuration(16);
      expect(duration).toBe(120);
    });

    it('should calculate eighth note duration', () => {
      const duration = calc.calculateDuration(8);
      expect(duration).toBe(240);
    });

    it('should calculate dotted note duration', () => {
      // Dotted quarter = quarter + eighth
      const quarterDots = calc.calculateDuration(4) * 1.5;
      expect(quarterDots).toBeGreaterThan(calc.calculateDuration(4));
    });
  });

  describe('Tick Advancement', () => {
    it('should start at tick 0', () => {
      expect(calc.currentTick).toBe(0);
    });

    it('should advance by specified amount', () => {
      calc.advance(100);
      expect(calc.currentTick).toBe(100);
    });

    it('should accumulate advances', () => {
      calc.advance(100);
      calc.advance(200);
      calc.advance(50);
      expect(calc.currentTick).toBe(350);
    });

    it('should handle negative advances', () => {
      calc.advance(100);
      calc.advance(-30);
      expect(calc.currentTick).toBe(70);
    });

    it('should allow large advances', () => {
      calc.advance(1000000);
      expect(calc.currentTick).toBe(1000000);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset to zero', () => {
      calc.advance(500);
      calc.reset();
      expect(calc.currentTick).toBe(0);
    });

    it('should handle multiple resets', () => {
      calc.advance(100);
      calc.reset();
      calc.advance(50);
      calc.reset();
      expect(calc.currentTick).toBe(0);
    });

    it('should work with reset before any advance', () => {
      calc.reset();
      expect(calc.currentTick).toBe(0);
    });
  });

  describe('Tempo Support', () => {
    it('should support different tempos', () => {
      const slow = createMockTimingCalculator({ tempo: 60, meter: [4, 4] });
      const fast = createMockTimingCalculator({ tempo: 240, meter: [4, 4] });
      expect(slow.tempo).toBe(60);
      expect(fast.tempo).toBe(240);
    });

    it('should store meter information', () => {
      expect(calc.meter).toEqual([4, 4]);
      const calc34 = createMockTimingCalculator({ meter: [3, 4] });
      expect(calc34.meter).toEqual([3, 4]);
    });
  });
});

describe('MockLayerManager - Comprehensive Tests', () => {
  let manager: any;

  beforeEach(() => {
    manager = createMockLayerManager();
  });

  describe('Layer Creation', () => {
    it('should create layer with default config', () => {
      const layer = manager.createLayer('test');
      expect(layer).toBeDefined();
      expect(layer.name).toBe('test');
      expect(layer.notes).toEqual([]);
    });

    it('should create layer with custom config', () => {
      const layer = manager.createLayer('custom', {
        meter: [3, 4],
        voices: 2,
        composer: 'ScaleComposer',
      });
      expect(layer.meter).toEqual([3, 4]);
      expect(layer.voices).toBe(2);
      expect(layer.composer).toBe('ScaleComposer');
    });

    it('should create multiple layers', () => {
      manager.createLayer('layer1');
      manager.createLayer('layer2');
      manager.createLayer('layer3');
      expect(manager.getLayers().length).toBe(3);
    });

    it('should handle duplicate layer names (overwrite)', () => {
      manager.createLayer('primary', { meter: [4, 4] });
      manager.createLayer('primary', { meter: [3, 4] });
      const layer = manager.getLayer('primary');
      expect(layer.meter).toEqual([3, 4]);
    });
  });

  describe('Note Management', () => {
    beforeEach(() => {
      manager.createLayer('primary');
    });

    it('should add single note to layer', () => {
      manager.addNote('primary', { note: 'C', octave: 4 });
      expect(manager.getLayer('primary').notes.length).toBe(1);
    });

    it('should add multiple notes to layer', () => {
      manager.addNote('primary', { note: 'C', octave: 4 });
      manager.addNote('primary', { note: 'E', octave: 4 });
      manager.addNote('primary', { note: 'G', octave: 4 });
      expect(manager.getLayer('primary').notes.length).toBe(3);
    });

    it('should preserve note order', () => {
      const notes = [
        { note: 'C', octave: 4 },
        { note: 'D', octave: 4 },
        { note: 'E', octave: 4 },
      ];
      notes.forEach(note => manager.addNote('primary', note));
      const layerNotes = manager.getLayer('primary').notes;
      expect(layerNotes[0].note).toBe('C');
      expect(layerNotes[2].note).toBe('E');
    });

    it('should handle complex note objects', () => {
      const complexNote = {
        note: 'C#',
        octave: 5,
        velocity: 100,
        duration: 480,
        startTick: 0,
      };
      manager.addNote('primary', complexNote);
      const stored = manager.getLayer('primary').notes[0];
      expect(stored.note).toBe('C#');
      expect(stored.duration).toBe(480);
    });

    it('should ignore notes for non-existent layers', () => {
      manager.addNote('nonexistent', { note: 'C' });
      expect(manager.getLayer('primary').notes.length).toBe(0);
    });
  });

  describe('Layer Retrieval', () => {
    beforeEach(() => {
      manager.createLayer('primary', { meter: [4, 4] });
      manager.createLayer('secondary', { meter: [3, 4] });
    });

    it('should get specific layer', () => {
      const layer = manager.getLayer('secondary');
      expect(layer.meter).toEqual([3, 4]);
    });

    it('should return undefined for non-existent layer', () => {
      const layer = manager.getLayer('nonexistent');
      expect(layer).toBeUndefined();
    });

    it('should get all layers', () => {
      const layers = manager.getLayers();
      expect(layers.length).toBe(2);
      const names = layers.map((l: any) => l.name);
      expect(names).toContain('primary');
      expect(names).toContain('secondary');
    });

    it('should return new array each time getLayers() is called', () => {
      const layers1 = manager.getLayers();
      const layers2 = manager.getLayers();
      expect(layers1).not.toBe(layers2);
      expect(layers1).toEqual(layers2);
    });
  });

  describe('Multi-Layer Operations', () => {
    it('should support independent layer note sequences', () => {
      manager.createLayer('melody');
      manager.createLayer('bass');

      manager.addNote('melody', { note: 'C', octave: 5 });
      manager.addNote('melody', { note: 'E', octave: 5 });

      manager.addNote('bass', { note: 'C', octave: 2 });
      manager.addNote('bass', { note: 'G', octave: 2 });

      expect(manager.getLayer('melody').notes.length).toBe(2);
      expect(manager.getLayer('bass').notes.length).toBe(2);
      expect(manager.getLayer('melody').notes[0].octave).toBe(5);
      expect(manager.getLayer('bass').notes[0].octave).toBe(2);
    });

    it('should maintain layer independence', () => {
      manager.createLayer('primary', { meter: [4, 4] });
      manager.createLayer('secondary', { meter: [3, 4] });

      manager.addNote('primary', { note: 'X' });

      expect(manager.getLayer('primary').notes.length).toBe(1);
      expect(manager.getLayer('secondary').notes.length).toBe(0);
    });
  });
});

describe('Timing and Layers - Integration', () => {
  it('should coordinate timing across multiple layers', () => {
    const config = createTestConfig();
    const timing = config.timingCalculator;
    const layers = config.layerManager;

    layers.createLayer('primary', { meter: [4, 4] });
    layers.createLayer('secondary', { meter: [3, 4] });

    const ticksPerMeasure = timing.calculateTicksPerMeasure();
    timing.advance(ticksPerMeasure);

    expect(timing.currentTick).toBe(ticksPerMeasure);
    expect(layers.getLayers().length).toBe(2);
  });

  it('should handle rhythm generation with timing', () => {
    const config = createTestConfig();
    const timing = config.timingCalculator;

    const noteDurations = [
      timing.calculateDuration(4), // quarter = 480
      timing.calculateDuration(4), // quarter = 480
      timing.calculateDuration(8), // eighth = 240
      timing.calculateDuration(8), // eighth = 240
    ];

    let totalTicks = 0;
    noteDurations.forEach(dur => {
      totalTicks += dur;
    });

    // Total: 480 + 480 + 240 + 240 = 1440 (3/4 measure worth)
    // Not necessarily a full 4/4 measure
    expect(totalTicks).toBe(1440);
  });
});
