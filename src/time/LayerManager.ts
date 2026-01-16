// LayerManager.ts - Manage per-layer timing contexts and buffer switching.
// minimalist comments, details at: time.md

import { TimingContext } from './TimingContext.js';

// Declare CSVBuffer type from writer.js
declare const CSVBuffer: any;

/**
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 * Handles registration, activation, and advancement of timing layers.
 */
export const LayerManager = {
  layers: {} as Record<string, { buffer: any; state: TimingContext }>,
  activeLayer: '' as string,

  /**
   * Register a layer with buffer and initial timing state.
   */
  register: (name: string, buffer: any, initialState: Partial<TimingContext> = {}, setupFn: ((state: TimingContext, buf: any) => void) | null = null) => {
    const state = new TimingContext(initialState);

    // Accept a CSVBuffer instance, array, or string name
    let buf: any;
    if (buffer && buffer.constructor && buffer.constructor.name === 'CSVBuffer') {
      buf = buffer;
      state.bufferName = buffer.name;
    } else if (typeof buffer === 'string') {
      state.bufferName = buffer;
      buf = new CSVBuffer(buffer);
    } else {
      buf = Array.isArray(buffer) ? buffer : [];
    }

    // Attach buffer onto both LM entry and the returned state
    LayerManager.layers[name] = { buffer: buf, state };
    state.buffer = buf;

    // If a per-layer setup function was provided, call it with `c` set
    // to the layer buffer so existing setup functions that rely on
    // the active buffer continue to work.
    const prevC = typeof (globalThis as any).c !== 'undefined' ? (globalThis as any).c : undefined;
    try {
      (globalThis as any).c = buf;
      if (typeof setupFn === 'function') setupFn(state, buf);
    } catch (e) {
      // Ignore setup errors
    }

    // Restore previous `c`
    if (prevC === undefined) {
      (globalThis as any).c = undefined;
    } else {
      (globalThis as any).c = prevC;
    }

    // Return both the state and direct buffer reference so callers can
    // destructure in one line and avoid separate buffer assignment lines
    return { state, buffer: buf };
  },

  /**
   * Activate a layer; restores timing globals and sets meter.
   */
  activate: (name: string, isPoly: boolean = false) => {
    const layer = LayerManager.layers[name];
    (globalThis as any).c = layer.buffer;
    LayerManager.activeLayer = name;

    const g = globalThis as any;

    // Store meter into layer state (set externally before activation)
    layer.state.numerator = g.numerator;
    layer.state.denominator = g.denominator;
    layer.state.meterRatio = g.numerator / g.denominator;
    layer.state.tpSec = g.tpSec;
    layer.state.tpMeasure = g.tpMeasure;

    // Restore layer timing state to globals
    layer.state.restoreTo(globalThis);

    if (isPoly) {
      g.numerator = g.polyNumerator;
      g.denominator = g.polyDenominator;
      g.measuresPerPhrase = g.measuresPerPhrase2;
    } else {
      g.measuresPerPhrase = g.measuresPerPhrase1;
    }
    g.spPhrase = g.spMeasure * g.measuresPerPhrase;
    g.tpPhrase = g.tpMeasure * g.measuresPerPhrase;

    return {
      phraseStart: layer.state.phraseStart,
      phraseStartTime: layer.state.phraseStartTime,
      sectionStart: layer.state.sectionStart,
      sectionStartTime: layer.state.sectionStartTime,
      sectionEnd: layer.state.sectionEnd,
      tpSec: layer.state.tpSec,
      tpSection: layer.state.tpSection,
      spSection: layer.state.spSection,
      state: layer.state
    };
  },

  /**
   * Advance a layer's timing state.
   */
  advance: (name: string, advancementType: 'phrase' | 'section' = 'phrase') => {
    const layer = LayerManager.layers[name];
    if (!layer) return;
    (globalThis as any).c = layer.buffer;

    const g = globalThis as any;
    g.beatRhythm = g.divRhythm = g.subdivRhythm = g.subsubdivRhythm = 0;

    // Advance using layer's own state values
    if (advancementType === 'phrase') {
      // Save current globals for phrase timing (layer was just active)
      layer.state.saveFrom({
        numerator: g.numerator,
        denominator: g.denominator,
        measuresPerPhrase: g.measuresPerPhrase,
        tpPhrase: g.tpPhrase,
        spPhrase: g.spPhrase,
        measureStart: g.measureStart,
        measureStartTime: g.measureStartTime,
        tpMeasure: g.tpMeasure,
        spMeasure: g.spMeasure,
        phraseStart: g.phraseStart,
        phraseStartTime: g.phraseStartTime,
        sectionStart: g.sectionStart,
        sectionStartTime: g.sectionStartTime,
        sectionEnd: g.sectionEnd,
        tpSec: g.tpSec,
        tpSection: g.tpSection,
        spSection: g.spSection
      });
      layer.state.advancePhrase(layer.state.tpPhrase, layer.state.spPhrase);
    } else if (advancementType === 'section') {
      // For section advancement, use layer's own accumulated tpSection/spSection
      // Don't pull from globals - they may be from a different layer!
      layer.state.advanceSection();
    }

    // Restore advanced state back to globals so they stay in sync
    layer.state.restoreTo(globalThis);
  },
};

// Export layer manager to global scope for access from other modules
(globalThis as any).LM = LayerManager;
(globalThis as any).layerManager = LayerManager;
