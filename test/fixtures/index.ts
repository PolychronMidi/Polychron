// test/fixtures/index.ts - Factory functions for creating test fixtures

import { MockStage, MockLayerManager, MockEventBus, MockComposer, MockTimingCalculator } from '../mocks/index.js';

/**
 * Create a mock composer with optional configuration
 */
export function createMockComposer(config: any = {}) {
  const {
    name = 'TestComposer',
    notes = ['C', 'E', 'G'],
    octaves = [3, 4],
    voices = 1,
  } = config;

  const composer = new MockComposer(name, notes, octaves);
  if (voices > 1) {
    composer.setVoices(voices);
  }
  return composer;
}

/**
 * Create a mock stage with optional layers
 */
export function createMockStage(config: any = {}) {
  const { layers = {}, eventBus } = config;

  const stage = new MockStage(eventBus);

  Object.entries(layers).forEach(([layerName, layerConfig]: [string, any]) => {
    stage.addLayer(layerName, layerConfig);
  });

  return stage;
}

/**
 * Create a mock layer manager with optional layers
 */
export function createMockLayerManager(config: any = {}) {
  const { layers = [] } = config;

  const manager = new MockLayerManager();

  layers.forEach((layer: any) => {
    manager.createLayer(layer.name || 'layer', layer.config || {});
  });

  return manager;
}

/**
 * Create a mock event bus with optional initial listeners
 */
export function createMockEventBus(config: any = {}) {
  const { listeners = {} } = config;

  const eventBus = new MockEventBus();

  Object.entries(listeners).forEach(([event, handlers]: [string, any]) => {
    const handlerList = Array.isArray(handlers) ? handlers : [handlers];
    handlerList.forEach(handler => {
      eventBus.on(event, handler);
    });
  });

  return eventBus;
}

/**
 * Create a mock timing calculator with optional config
 */
export function createMockTimingCalculator(config: any = {}) {
  const { tempo = 120, meter = [4, 4] } = config;
  return new MockTimingCalculator(tempo, meter);
}

/**
 * Create a complete test configuration with all mocks
 */
export function createTestConfig(overrides: any = {}) {
  const eventBus = createMockEventBus();
  const stage = createMockStage({ eventBus });
  const layerManager = createMockLayerManager();
  const timingCalculator = createMockTimingCalculator();
  const composer = createMockComposer();

  return {
    eventBus,
    stage,
    layerManager,
    timingCalculator,
    composer,
    ...overrides,
  };
}
