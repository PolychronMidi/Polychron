
/**
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 */

LM = layerManager ={
  layers: {},

  /**
   * Register a layer with buffer and initial timing state.
   * @param {string} name
   * @param {object} [initialState]
   * @param {Function} [setupFn]
   */
  register: (name, buffer, initialState = {}, setupFn = null) => {
    // Create a plain timing object (flattened, no TimingContext class)
    const defaults = {
      phraseStart: 0,
      phraseStartTime: 0,
      sectionStart: 0,
      sectionStartTime: 0,
      tpSec: 0,
      tpSection: 0,
      spSection: 0,
      numerator: 0,
      denominator: 0,
      tpPhrase: 0,
      spPhrase: 0,
      measureStart: 0,
      measureStartTime: 0,
      tpMeasure: 0,
      spMeasure: 0,
      bufferName: '',
      beatMotifs: {}
    };

    // Validate initialState if provided
    if (initialState !== undefined && (typeof initialState !== 'object' || initialState === null)) {
      throw new Error('LayerManager.register: initialState must be an object');
    }
    // Build the flattened timing object from defaults + any provided initialState
    const layer = Object.assign({}, defaults, initialState || {});
    let buf;

    if (typeof buffer === 'string') {
      // Name-only buffer; keep a clean array for events but record the name
      layer.bufferName = buffer;
      buf = [];
    } else {
      buf = Array.isArray(buffer) ? buffer : [];
    }

    // Attach buffer and timing props directly to the layer object
    LM.layers[name] = Object.assign({ buffer: buf }, layer);

    // If a per-layer setup function was provided, call it with `c` set
    // to the layer buffer so existing setup functions that rely on
    // the active buffer continue to work.
    const prevC = typeof c !== 'undefined' ? c : undefined;
    try {
      c = buf;
      if (typeof setupFn === 'function') setupFn(LM.layers[name], buf);
    } catch (e) {
      throw new Error('LayerManager.register: layer setup function threw: ' + (e && e.stack ? e.stack : String(e)));
    }
    // restore previous `c`
    if (prevC === undefined) c = undefined; else c = prevC;
    // return the layer object
    return { layer: LM.layers[name], buffer: buf };
  },

  /**
   * Activate a layer; restores timing globals and sets meter.
   * @param {string} name - Layer name.
   * @param {boolean} [isPoly=false] - Whether this is a polyrhythmic layer.
   * @returns {{numerator: number, denominator: number, tpSec: number, tpMeasure: number}} Snapshot of key timing values.
   */
  activate: (name, isPoly = false) => {
    // no need to pass meter info here, as it stays consitent until the next layer switch
    const layer = LM.layers[name];
    c = layer.buffer;
    LM.activeLayer = name;
    loadLayerToGlobals(layer);
    // Set active layer context in PhaseLockedRhythmGenerator for layer-aware phase tracking
    if (typeof PhaseLockedRhythmGenerator !== 'undefined') {
      PhaseLockedRhythmGenerator.setActiveLayer(name);
    }
    if (isPoly) {
      numerator = polyNumerator;
      denominator = polyDenominator;
    }
    return layer;
  },

  /**
   * Advance a layer's timing state.
   * @param {string} name - Layer name.
   * @param {'phrase'|'section'} [advancementType='phrase'] - Type of advancement.
   * @returns {void}
   */
  advance: (name, advancementType = 'phrase') => {
    const layer = LM.layers[name];
    if (!layer) { throw new Error(`LayerManager.advance: layer "${name}" not found`); }
    c = layer.buffer;

    // Advance using the layer's timing values
    if (advancementType === 'phrase') {
      phraseStart+=tpPhrase; phraseStartTime+=spPhrase;
      // Save current globals into the flattened layer object
      Object.assign(layer, {
        tpPhrase,
        spPhrase,
        phraseStart,
        phraseStartTime,

        tpMeasure,
        spMeasure,
        measureStart,
        measureStartTime,

        tpSection,
        spSection,
        sectionStart,
        sectionStartTime,

        tpSec,
      });

    } else if (advancementType === 'section') {
      layer.sectionStart=phraseStart; layer.sectionStartTime=phraseStartTime;
    }
  },

  // Minimal helpers to initialize section origin for layers (keeps it tiny and explicit).
  setSectionStartFor: (name) => {
    const layer = LM.layers[name];
    if (!layer) { throw new Error(`LayerManager.setSectionStartFor: layer "${name}" not found`); }
    layer.sectionStart = phraseStart;
    layer.sectionStartTime = phraseStartTime;
  },

  setSectionStartAll: () => {
    Object.keys(LM.layers).forEach((ln) => LM.setSectionStartFor(ln));
  },
};

/**
 * Restore timing into naked globals without using banned globals.
 */
function loadLayerToGlobals(layer) {
  if (!layer) { throw new Error('loadLayerToGlobals: no layer provided'); }
  tpSection = layer.tpSection;
  spSection = layer.spSection;
  sectionStart = layer.sectionStart;
  sectionStartTime = layer.sectionStartTime;

  tpPhrase = layer.tpPhrase;
  spPhrase = layer.spPhrase;
  phraseStart = layer.phraseStart;
  phraseStartTime = layer.phraseStartTime;

  measureStart = layer.measureStart;
  measureStartTime = layer.measureStartTime;
  tpMeasure = layer.tpMeasure;
  spMeasure = layer.spMeasure;

  tpSec = layer.tpSec;

}
