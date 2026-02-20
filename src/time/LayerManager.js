
/**
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 */

const V = Validator.create('LayerManager');

LM = layerManager ={
  layers: {},
  layerComposers: {},
  phraseFamily: null,
  activeLayer: null,

  /**
   * Register a layer with buffer and initial timing state.
   * @param {string} name
   * @param {object} [initialState]
   * @param {Function} [setupFn]
   */
  register: (name, buffer, initialState = {}, setupFn = undefined) => {
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
      divMotifs: [],
      measureComposer: null
    };

    // Validate initialState if provided
    if (initialState !== undefined) V.assertObject(initialState, 'initialState');
    // Build the flattened timing object from defaults + any provided initialState
    const layer = Object.assign({ id: name }, defaults, initialState);
    let buf;

    if (typeof buffer === 'string') {
      // Name-only buffer; keep a clean array for events but record the name
      layer.bufferName = buffer;
      buf = [];
    } else {
      if (!Array.isArray(buffer)) {
        throw new Error('LayerManager.register: buffer must be an array or layer buffer name string');
      }
      buf = buffer;
    }

    // Attach buffer and timing props directly to the layer object
    LM.layers[name] = Object.assign({ buffer: buf }, layer);
    const globalComposer = composer ? composer : null;
    const registeredComposer = (LM.layers[name].measureComposer && typeof LM.layers[name].measureComposer === 'object')
      ? LM.layers[name].measureComposer
      : globalComposer;
    LM.layerComposers[name] = registeredComposer;

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
    const globalComposer = composer ? composer : null;
    const layerComposer = (LM.layerComposers[name] && typeof LM.layerComposers[name] === 'object')
      ? LM.layerComposers[name]
      : ((layer.measureComposer && typeof layer.measureComposer === 'object') ? layer.measureComposer : globalComposer);
    if (layerComposer && typeof layerComposer === 'object') {
      LM.layerComposers[name] = layerComposer;
      layer.measureComposer = layerComposer;
      composer = layerComposer;
    }
    // Set active layer context in PhaseLockedRhythmGenerator for layer-aware phase tracking
    if (PhaseLockedRhythmGenerator) {
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
    V.requireDefined(layer, `layer "${name}"`);
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
    V.requireDefined(layer, `layer "${name}"`);
    layer.sectionStart = phraseStart;
    layer.sectionStartTime = phraseStartTime;
  },

  setSectionStartAll: () => {
    Object.keys(LM.layers).forEach((ln) => LM.setSectionStartFor(ln));
  },

  setPhraseFamily: (familyName) => {
    V.assertNonEmptyString(familyName, 'familyName');
    LM.phraseFamily = familyName;
    return familyName;
  },

  getPhraseFamily: () => {
    V.assertNonEmptyString(LM.phraseFamily, 'phraseFamily');
    return LM.phraseFamily;
  },

  setComposerFor: (name, nextComposer) => {
    V.assertNonEmptyString(name, 'layer name');
    V.assertObject(nextComposer, 'composer');
    const layer = LM.layers[name];
    V.requireDefined(layer, `layer "${name}"`);
    LM.layerComposers[name] = nextComposer;
    layer.measureComposer = nextComposer;
    if (LM.activeLayer === name) {
      composer = nextComposer;
    }
    return nextComposer;
  },

  setComposerForAll: (nextComposer) => {
    V.assertObject(nextComposer, 'composer');
    const layerNames = Object.keys(LM.layers);
    if (layerNames.length === 0) {
      throw new Error('LayerManager.setComposerForAll: no registered layers');
    }
    for (let i = 0; i < layerNames.length; i++) {
      LM.setComposerFor(layerNames[i], nextComposer);
    }
    return nextComposer;
  },

  getComposerFor: (name) => {
    V.assertNonEmptyString(name, 'layer name');
    const layer = LM.layers[name];
    V.requireDefined(layer, `layer "${name}"`);
    const mappedComposer = LM.layerComposers[name];
    const layerComposer = layer.measureComposer;
    const globalComposer = composer ? composer : null;
    const resolvedComposer = (mappedComposer && typeof mappedComposer === 'object')
      ? mappedComposer
      : ((layerComposer && typeof layerComposer === 'object') ? layerComposer : globalComposer);

    if (!resolvedComposer) {
      V.requireDefined(resolvedComposer, `composer for layer "${name}"`);
    }

    LM.layerComposers[name] = resolvedComposer;
    layer.measureComposer = resolvedComposer;
    return resolvedComposer;
  },

};

/**
 * Restore timing into naked globals without using banned globals.
 */
function loadLayerToGlobals(layer) {
  V.requireDefined(layer, 'layer');
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
