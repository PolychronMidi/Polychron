
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
      bufferName: ''
    };

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
    } catch (e) { console.warn('LayerManager.register: layer setup function threw, continuing:', e && e.stack ? e.stack : e); }
    // restore previous `c`
    if (prevC === undefined) c = undefined; else c = prevC;
    // return the layer object (no backward-compatibility `state` key)
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
    if (!layer) return;
    c = layer.buffer;

    beatRhythm = divRhythm = subdivRhythm = subsubdivRhythm = 0;

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
      try { fs.appendFileSync('log/timing-events.log', JSON.stringify({ time: new Date().toISOString(), event: 'advance', layer: name, type: 'section', section: sectionIndex+1, phraseStart, tpSec }) + '\n'); } catch (_e) { console.warn('LayerManager: failed to append timing-events.log:', _e && _e.stack ? _e.stack : _e); }

    }
  },

  // Minimal helpers to initialize section origin for layers (keeps it tiny and explicit).
  setSectionStartFor: (name) => {
    const layer = LM.layers[name];
    if (!layer) return;
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
  if (!layer) return;
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

  // Restore per-layer rhythms into globals so rhythms carry over and can morph between instances.
  // If a layer lacks a rhythm, we avoid clobbering existing globals.
  try {
    // Beat
    if (Array.isArray(layer.beatRhythm)) {
      beatRhythm = [...layer.beatRhythm];
      beatIndex = typeof layer.beatIndex !== 'undefined' ? layer.beatIndex : (typeof beatIndex !== 'undefined' ? beatIndex : 0);
    } else if (typeof beatRhythm === 'undefined') {
      // Ensure a beat rhythm exists by generating one for the layer (best-effort)
      try { setRhythm('beat', layer); if (Array.isArray(layer.beatRhythm)) beatRhythm = [...layer.beatRhythm]; } catch (e) { console.warn('LayerManager: failed to set beat rhythm for layer, continuing:', e && e.stack ? e.stack : e); }
    }

    // Div
    if (Array.isArray(layer.divRhythm)) {
      divRhythm = [...layer.divRhythm];
      divIndex = typeof layer.divIndex !== 'undefined' ? layer.divIndex : (typeof divIndex !== 'undefined' ? divIndex : 0);
    }

    // Subdiv
    if (Array.isArray(layer.subdivRhythm)) {
      subdivRhythm = [...layer.subdivRhythm];
      subdivIndex = typeof layer.subdivIndex !== 'undefined' ? layer.subdivIndex : (typeof subdivIndex !== 'undefined' ? subdivIndex : 0);
    }

    // Subsubdiv
    if (Array.isArray(layer.subsubdivRhythm)) {
      subsubdivRhythm = [...layer.subsubdivRhythm];
      subsubdivIndex = typeof layer.subsubdivIndex !== 'undefined' ? layer.subsubdivIndex : (typeof subsubdivIndex !== 'undefined' ? subsubdivIndex : 0);
    }
  } catch (e) { console.warn('LayerManager.loadLayerToGlobals: unexpected error loading layer rhythms:', e && e.stack ? e.stack : e); }

}
