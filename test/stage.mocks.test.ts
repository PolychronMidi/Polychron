// test/stage.mocks.test.ts - Stage tests using mock infrastructure

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockStage, createMockEventBus, createTestConfig } from './fixtures/index.js';

describe('Stage - Mock-based Tests', () => {
  let stage: any;
  let eventBus: any;

  beforeEach(() => {
    eventBus = createMockEventBus();
    stage = createMockStage({ eventBus });
  });

  describe('Layer Management', () => {
    it('should initialize with no layers', () => {
      expect(stage.allLayers().length).toBe(0);
    });

    it('should add primary layer', () => {
      stage.addLayer('primary', { meter: [4, 4] });
      const layer = stage.getLayer('primary');
      expect(layer).toBeDefined();
      expect(layer.meter).toEqual([4, 4]);
    });

    it('should add multiple layers', () => {
      stage.addLayer('primary', { meter: [4, 4] });
      stage.addLayer('secondary', { meter: [3, 4] });
      stage.addLayer('tertiary', { meter: [5, 4] });
      expect(stage.allLayers().length).toBe(3);
    });

    it('should retrieve specific layer', () => {
      stage.addLayer('test', { notes: ['C', 'D', 'E'] });
      const layer = stage.getLayer('test');
      expect(layer.notes).toEqual(['C', 'D', 'E']);
    });

    it('should handle non-existent layer gracefully', () => {
      const layer = stage.getLayer('nonexistent');
      expect(layer).toBeUndefined();
    });

    it('should update layer properties', () => {
      stage.addLayer('primary', { meter: [4, 4], tempo: 120 });
      const layer = stage.getLayer('primary');
      layer.tempo = 140;
      expect(stage.getLayer('primary').tempo).toBe(140);
    });
  });

  describe('Event Integration', () => {
    it('should emit layer added events', () => {
      stage.addLayer('primary');
      stage.eventBus.emit('LAYER_ADDED', { layer: 'primary' });
      expect(stage.eventBus.getHistory().length).toBeGreaterThan(0);
    });

    it('should track event history', () => {
      const layer = { name: 'test', notes: [] };
      stage.eventBus.emit('LAYER_ADDED', layer);
      stage.eventBus.emit('LAYER_MODIFIED', layer);
      expect(stage.eventBus.getHistory().length).toBe(2);
    });

    it('should emit correct event data', () => {
      const testData = { layer: 'primary', notes: 5 };
      stage.eventBus.emit('COMPOSITION_PROGRESS', testData);
      const history = stage.eventBus.getHistory('COMPOSITION_PROGRESS');
      expect(history[0].data).toEqual(testData);
    });
  });

  describe('Data Structure Integrity', () => {
    it('should maintain layer ordering', () => {
      stage.addLayer('first');
      stage.addLayer('second');
      stage.addLayer('third');
      const layers = stage.allLayers();
      expect(layers[0].name).toBe('first');
      expect(layers[1].name).toBe('second');
      expect(layers[2].name).toBe('third');
    });

    it('should isolate layer data', () => {
      stage.addLayer('layer1', { notes: ['C'] });
      stage.addLayer('layer2', { notes: ['G'] });
      expect(stage.getLayer('layer1').notes).toEqual(['C']);
      expect(stage.getLayer('layer2').notes).toEqual(['G']);
    });

    it('should support complex layer config', () => {
      const config = {
        meter: [7, 8],
        tempo: 135,
        voices: 3,
        composer: 'ChordComposer',
        effects: ['reverb', 'delay'],
      };
      stage.addLayer('complex', config);
      const layer = stage.getLayer('complex');
      expect(layer.meter).toEqual([7, 8]);
      expect(layer.effects.length).toBe(2);
    });
  });

  describe('Reset and Cleanup', () => {
    it('should reset all layers', () => {
      stage.addLayer('primary');
      stage.addLayer('secondary');
      stage.reset();
      expect(stage.allLayers().length).toBe(0);
    });

    it('should handle reset on empty stage', () => {
      expect(() => stage.reset()).not.toThrow();
      expect(stage.allLayers().length).toBe(0);
    });
  });
});

describe('Stage - Integration Tests', () => {
  it('should work with full test config', () => {
    const config = createTestConfig();
    config.stage.addLayer('primary', { meter: [4, 4] });
    config.stage.addLayer('secondary', { meter: [3, 4] });

    expect(config.stage.allLayers().length).toBe(2);
    expect(config.eventBus).toBeDefined();
  });

  it('should support complete composition flow simulation', () => {
    const config = createTestConfig();
    const stage = config.stage;
    const eventBus = config.eventBus;

    // Simulate layer creation
    stage.addLayer('primary', { meter: [4, 4] });
    stage.addLayer('secondary', { meter: [3, 4] });
    eventBus.emit('COMPOSITION_STARTED', { layers: 2 });

    // Simulate composition progress
    for (let i = 0; i < 3; i++) {
      eventBus.emit('COMPOSITION_TICK', { tick: i, progress: (i / 3) * 100 });
    }
    eventBus.emit('COMPOSITION_COMPLETE', { layers: stage.allLayers() });

    // Verify history
    const history = eventBus.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(5);
    expect(history[0].event).toBe('COMPOSITION_STARTED');
  });
});
