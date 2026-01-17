// test/mocks.test.ts - Tests for mock implementations and test infrastructure

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockStage,
  MockLayerManager,
  MockEventBus,
  MockComposer,
  MockTimingCalculator,
} from './mocks/index.js';
import {
  createMockComposer,
  createMockStage,
  createMockLayerManager,
  createMockEventBus,
  createMockTimingCalculator,
  createTestConfig,
} from './fixtures/index.js';
import { SeededRandom, testRandom, resetTestRandom, createSeededRandom } from './helpers/seededRandom.js';

describe('Mock Implementations', () => {
  describe('MockStage', () => {
    let stage: MockStage;

    beforeEach(() => {
      stage = new MockStage();
    });

    it('should create stage with empty layers', () => {
      expect(stage.layers.size).toBe(0);
    });

    it('should add layers', () => {
      stage.addLayer('primary', { meter: [4, 4] });
      expect(stage.layers.size).toBe(1);
      expect(stage.getLayer('primary')).toBeDefined();
    });

    it('should return all layers', () => {
      stage.addLayer('primary').addLayer('secondary');
      expect(stage.allLayers().length).toBe(2);
    });

    it('should reset layers', () => {
      stage.addLayer('primary');
      stage.reset();
      expect(stage.layers.size).toBe(0);
    });
  });

  describe('MockLayerManager', () => {
    let manager: MockLayerManager;

    beforeEach(() => {
      manager = new MockLayerManager();
    });

    it('should create layers with config', () => {
      manager.createLayer('primary', { meter: [4, 4] });
      expect(manager.getLayer('primary')).toBeDefined();
      expect(manager.getLayer('primary').meter).toEqual([4, 4]);
    });

    it('should add notes to layers', () => {
      manager.createLayer('primary');
      manager.addNote('primary', { note: 'C', octave: 4 });
      expect(manager.getLayer('primary').notes.length).toBe(1);
    });

    it('should get all layers', () => {
      manager.createLayer('layer1');
      manager.createLayer('layer2');
      expect(manager.getLayers().length).toBe(2);
    });
  });

  describe('MockEventBus', () => {
    let eventBus: MockEventBus;

    beforeEach(() => {
      eventBus = new MockEventBus();
    });

    it('should register listeners', () => {
      const handler = () => {};
      eventBus.on('test', handler);
      expect(eventBus.listeners.has('test')).toBe(true);
    });

    it('should emit events and call handlers', () => {
      let called = false;
      eventBus.on('test', () => {
        called = true;
      });
      eventBus.emit('test', {});
      expect(called).toBe(true);
    });

    it('should track emit history', () => {
      eventBus.emit('event1', { data: 1 });
      eventBus.emit('event2', { data: 2 });
      expect(eventBus.getHistory().length).toBe(2);
    });

    it('should filter history by event name', () => {
      eventBus.emit('event1', {});
      eventBus.emit('event2', {});
      expect(eventBus.getHistory('event1').length).toBe(1);
    });

    it('should clear history', () => {
      eventBus.emit('test', {});
      eventBus.clear();
      expect(eventBus.getHistory().length).toBe(0);
    });
  });

  describe('MockComposer', () => {
    let composer: MockComposer;

    beforeEach(() => {
      composer = new MockComposer('TestComposer', ['C', 'E', 'G'], [3, 4]);
    });

    it('should generate notes via x()', () => {
      const notes = composer.x();
      expect(notes.length).toBe(3);
      expect(notes[0].note).toBe('C');
      expect(notes[0].octave).toBe(3);
    });

    it('should set voice count', () => {
      composer.setVoices(4);
      expect(composer.voices).toBe(4);
    });

    it('should return note names', () => {
      const names = composer.getNotes();
      expect(names).toEqual(['C', 'E', 'G']);
    });

    it('should support octave range parameter', () => {
      const names = composer.getNotes([4, 5]);
      expect(names.length).toBe(3);
    });
  });

  describe('MockTimingCalculator', () => {
    let calc: MockTimingCalculator;

    beforeEach(() => {
      calc = new MockTimingCalculator(120, [4, 4]);
    });

    it('should calculate ticks per measure', () => {
      const ticks = calc.calculateTicksPerMeasure();
      expect(ticks).toBeGreaterThan(0);
    });

    it('should calculate note duration', () => {
      const duration = calc.calculateDuration(4);
      expect(duration).toBeGreaterThan(0);
    });

    it('should advance tick count', () => {
      expect(calc.currentTick).toBe(0);
      calc.advance(100);
      expect(calc.currentTick).toBe(100);
    });

    it('should reset tick count', () => {
      calc.advance(100);
      calc.reset();
      expect(calc.currentTick).toBe(0);
    });
  });
});

describe('Test Fixtures', () => {
  it('should create mock composer via factory', () => {
    const composer = createMockComposer({ name: 'CustomComposer' });
    expect(composer.name).toBe('CustomComposer');
    expect(composer.x().length).toBe(3);
  });

  it('should create mock stage via factory', () => {
    const stage = createMockStage({
      layers: {
        primary: { meter: [4, 4] },
        secondary: { meter: [3, 4] },
      },
    });
    expect(stage.allLayers().length).toBe(2);
  });

  it('should create mock layer manager via factory', () => {
    const manager = createMockLayerManager({
      layers: [{ name: 'layer1' }, { name: 'layer2' }],
    });
    expect(manager.getLayers().length).toBe(2);
  });

  it('should create mock event bus via factory', () => {
    let callCount = 0;
    const eventBus = createMockEventBus({
      listeners: {
        test: () => {
          callCount++;
        },
      },
    });
    eventBus.emit('test', {});
    expect(callCount).toBe(1);
  });

  it('should create complete test config', () => {
    const config = createTestConfig();
    expect(config.stage).toBeDefined();
    expect(config.layerManager).toBeDefined();
    expect(config.eventBus).toBeDefined();
    expect(config.composer).toBeDefined();
    expect(config.timingCalculator).toBeDefined();
  });
});

describe('SeededRandom', () => {
  let random: SeededRandom;

  beforeEach(() => {
    random = new SeededRandom(42);
  });

  it('should generate same sequence with same seed', () => {
    const rand1 = new SeededRandom(42);
    const rand2 = new SeededRandom(42);

    const seq1 = [rand1.next(), rand1.next(), rand1.next()];
    const seq2 = [rand2.next(), rand2.next(), rand2.next()];

    expect(seq1).toEqual(seq2);
  });

  it('should generate integers in range', () => {
    for (let i = 0; i < 100; i++) {
      const num = random.nextInt(5, 10);
      expect(num).toBeGreaterThanOrEqual(5);
      expect(num).toBeLessThanOrEqual(10);
    }
  });

  it('should choose random element from array', () => {
    const arr = ['a', 'b', 'c'];
    const choice = random.choice(arr);
    expect(arr).toContain(choice);
  });

  it('should shuffle array consistently with seed', () => {
    const arr = [1, 2, 3, 4, 5];
    const rand1 = new SeededRandom(42);
    const rand2 = new SeededRandom(42);

    const shuffled1 = rand1.shuffle(arr);
    const shuffled2 = rand2.shuffle(arr);

    expect(shuffled1).toEqual(shuffled2);
  });

  it('should generate array of random numbers', () => {
    const randoms = random.randoms(10, 0, 100);
    expect(randoms.length).toBe(10);
    expect(randoms.every(n => n >= 0 && n <= 100)).toBe(true);
  });

  it('should reset seed for reproducibility', () => {
    const rand = new SeededRandom(42);
    const first1 = rand.next();
    const first2 = rand.next();

    rand.reset(42);
    const again1 = rand.next();
    const again2 = rand.next();

    expect(first1).toBe(again1);
    expect(first2).toBe(again2);
  });

  it('should use weighted choice', () => {
    const items = ['rare', 'common'];
    const weights = [0.1, 0.9];

    let rareCount = 0;
    for (let i = 0; i < 100; i++) {
      if (random.weightedChoice(items, weights) === 'rare') {
        rareCount++;
      }
    }

    // Should be roughly 10%, allow some variance
    expect(rareCount).toBeLessThan(30);
    expect(rareCount).toBeGreaterThan(0);
  });

  it('global testRandom should be reusable', () => {
    resetTestRandom();
    const val1 = testRandom.next();

    resetTestRandom();
    const val2 = testRandom.next();

    expect(val1).toBe(val2);
  });

  it('should create independent seeded random instances', () => {
    const rand1 = createSeededRandom(42);
    const rand2 = createSeededRandom(42);

    expect(rand1.next()).toBe(rand2.next());
  });
});
