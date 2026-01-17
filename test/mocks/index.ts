// test/mocks/index.ts - Mock implementations for testing

/**
 * Mock Stage for isolated testing
 */
export class MockStage {
  layers: Map<string, any>;
  eventBus: MockEventBus;

  constructor(eventBus?: MockEventBus) {
    this.layers = new Map();
    this.eventBus = eventBus || new MockEventBus();
  }

  addLayer(name: string, layerConfig: any = {}) {
    this.layers.set(name, {
      name,
      notes: [],
      ...layerConfig,
    });
    return this;
  }

  getLayer(name: string) {
    return this.layers.get(name);
  }

  allLayers() {
    return Array.from(this.layers.values());
  }

  reset() {
    this.layers.clear();
  }
}

/**
 * Mock LayerManager for isolated testing
 */
export class MockLayerManager {
  layers: Map<string, any>;
  primaryLayer: string = 'primary';

  constructor() {
    this.layers = new Map();
  }

  createLayer(name: string, config: any = {}) {
    this.layers.set(name, {
      name,
      notes: [],
      meter: config.meter || [4, 4],
      ...config,
    });
    return this.layers.get(name);
  }

  getLayer(name: string) {
    return this.layers.get(name);
  }

  addNote(layerName: string, note: any) {
    const layer = this.layers.get(layerName);
    if (layer) {
      layer.notes.push(note);
    }
  }

  getLayers() {
    return Array.from(this.layers.values());
  }
}

/**
 * Mock EventBus for isolated testing
 */
export class MockEventBus {
  listeners: Map<string, Function[]>;
  emitHistory: Array<{ event: string; data: any }>;

  constructor() {
    this.listeners = new Map();
    this.emitHistory = [];
  }

  on(event: string, handler: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  emit(event: string, data: any) {
    this.emitHistory.push({ event, data });
    const handlers = this.listeners.get(event) || [];
    handlers.forEach(h => {
      try {
        h(data);
      } catch (e) {
        // Swallow errors in mock
      }
    });
  }

  getHistory(event?: string) {
    if (event) {
      return this.emitHistory.filter(e => e.event === event);
    }
    return this.emitHistory;
  }

  clear() {
    this.listeners.clear();
    this.emitHistory = [];
  }
}

/**
 * Mock Composer for isolated testing
 */
export class MockComposer {
  notes: string[];
  octaves: number[];
  voices: number;
  name: string;

  constructor(name: string = 'MockComposer', notes: string[] = ['C', 'E', 'G'], octaves: number[] = [3, 4]) {
    this.name = name;
    this.notes = notes;
    this.octaves = octaves;
    this.voices = 1;
  }

  x(): any[] {
    // Returns mock note objects
    return this.notes.map((note, idx) => ({
      note,
      octave: this.octaves[idx % this.octaves.length],
      velocity: 80,
      duration: 1,
    }));
  }

  setVoices(count: number) {
    this.voices = count;
    return this;
  }

  getNotes(octaveRange?: number[]) {
    return this.notes;
  }
}

/**
 * Mock TimingCalculator for isolated testing
 */
export class MockTimingCalculator {
  tempo: number;
  meter: number[];
  currentTick: number;

  constructor(tempo: number = 120, meter: number[] = [4, 4]) {
    this.tempo = tempo;
    this.meter = meter;
    this.currentTick = 0;
  }

  calculateTicksPerMeasure(): number {
    return (this.meter[0] * 480) / (this.meter[1] / 4);
  }

  calculateDuration(noteValue: number): number {
    return (480 * 4) / noteValue;
  }

  advance(ticks: number) {
    this.currentTick += ticks;
  }

  reset() {
    this.currentTick = 0;
  }
}
