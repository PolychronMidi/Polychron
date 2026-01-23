// LayerManager.ts - Manage per-layer timing contexts and buffer switching.
// minimalist comments, details at: time.md

import { TimingContext } from './TimingContext.js';
import { CSVBuffer } from '../writer.js';

// Use PolychronContext test namespace for DI-only compatibility
import { getPolychronContext } from '../PolychronInit.js';
const poly = getPolychronContext();

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
    const prevTestC = typeof poly.test?.c !== 'undefined' ? poly.test.c : undefined;
    try {
      // Keep DI-friendly test namespace in sync (no global object writes)
      poly.test = poly.test || {} as any;
      poly.test.c = buf;
      if (typeof setupFn === 'function') setupFn(state, buf);
    } catch (_e) {
      // Ignore setup errors
    }

    // Restore previous `c` in the DI test namespace
    poly.test.c = prevTestC;

    // Return both the state and direct buffer reference so callers can
    // destructure in one line and avoid separate buffer assignment lines
    return { state, buffer: buf };
  },

  /**
   * Activate a layer; restores timing globals and sets meter.
   */
  activate: (name: string, isPoly: boolean = false) => {
    const layer = LayerManager.layers[name];
    try {
      try { import('../trace.js').then(({ trace }) => trace('anomaly', '[traceroute] LayerManager.activate', { name, isPoly, currentActive: LayerManager.activeLayer, numerator: (getPolychronContext && getPolychronContext().state && getPolychronContext().state.numerator) || null, tpMeasure: (getPolychronContext && getPolychronContext().state && getPolychronContext().state.tpMeasure) || null })).catch(() => {}); } catch (_e) {}
    } catch (_e) {}
    // Set active buffer in DI test namespace (no globals)
    poly.test = poly.test || {} as any;
    poly.test.c = layer.buffer;
    LayerManager.activeLayer = name;

    // Store meter into layer state (set externally before activation)
    layer.state.numerator = poly.test.numerator;
    layer.state.denominator = poly.test.denominator;
    layer.state.meterRatio = (poly.test.numerator && poly.test.denominator) ? (poly.test.numerator / poly.test.denominator) : layer.state.meterRatio;
    layer.state.tpSec = poly.test.tpSec ?? layer.state.tpSec;
    layer.state.tpMeasure = poly.test.tpMeasure ?? layer.state.tpMeasure;

    // Restore layer timing state into the DI test namespace
    layer.state.restoreTo(poly.test);

    // Mirror restored values into the DI test namespace (authoritative)
    poly.test.phraseStart = layer.state.phraseStart;
    poly.test.phraseStartTime = layer.state.phraseStartTime;
    poly.test.sectionStart = layer.state.sectionStart;
    poly.test.sectionStartTime = layer.state.sectionStartTime;
    poly.test.sectionEnd = layer.state.sectionEnd;
    poly.test.tpSec = layer.state.tpSec;
    poly.test.tpSection = layer.state.tpSection;
    poly.test.spSection = layer.state.spSection;
    poly.test.numerator = layer.state.numerator;
    poly.test.denominator = layer.state.denominator;
    poly.test.measuresPerPhrase = layer.state.measuresPerPhrase;
    poly.test.tpMeasure = layer.state.tpMeasure;
    poly.test.spMeasure = layer.state.spMeasure;

    if (isPoly) {
      poly.test.numerator = poly.test.polyNumerator;
      poly.test.denominator = poly.test.polyDenominator;
      poly.test.measuresPerPhrase = poly.test.measuresPerPhrase2;
    } else {
      poly.test.measuresPerPhrase = poly.test.measuresPerPhrase1;
    }
    poly.test.spPhrase = (poly.test.spMeasure ?? layer.state.spMeasure) * (poly.test.measuresPerPhrase ?? 1);
    poly.test.tpPhrase = (poly.test.tpMeasure ?? layer.state.tpMeasure) * (poly.test.measuresPerPhrase ?? 1);

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
    const gAny = poly.test || {} as any;
    const layer = LayerManager.layers[name];
    if (!layer) return;
    gAny.c = layer.buffer;
    gAny.beatRhythm = gAny.divRhythm = gAny.subdivRhythm = gAny.subsubdivRhythm = 0;

    // Advance using layer's own state values
    if (advancementType === 'phrase') {
      // Save current test-namespace values for phrase timing (layer was just active)
      layer.state.saveFrom({
        numerator: gAny.numerator,
        denominator: gAny.denominator,
        measuresPerPhrase: gAny.measuresPerPhrase,
        tpPhrase: gAny.tpPhrase,
        spPhrase: gAny.spPhrase,
        measureStart: gAny.measureStart,
        measureStartTime: gAny.measureStartTime,
        tpMeasure: gAny.tpMeasure,
        spMeasure: gAny.spMeasure,
        phraseStart: gAny.phraseStart,
        phraseStartTime: gAny.phraseStartTime,
        sectionStart: gAny.sectionStart,
        sectionStartTime: gAny.sectionStartTime,
        sectionEnd: gAny.sectionEnd,
        tpSec: gAny.tpSec,
        tpSection: gAny.tpSection,
        spSection: gAny.spSection
      });
      layer.state.advancePhrase(layer.state.tpPhrase, layer.state.spPhrase);
    } else if (advancementType === 'section') {
      // For section advancement, use layer's own accumulated tpSection/spSection
      layer.state.advanceSection();
    }

    // Restore advanced state back into the test namespace so they stay in sync (no runtime global writes)
    layer.state.restoreTo(gAny);
  },
};
