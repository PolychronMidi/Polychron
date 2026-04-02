
/**
 * LayerManager (LM): manage per-layer timing contexts and buffer switching.
 */

const V = validator.create('LayerManager');

class LayerManager {
  static layers = {};
  static layerComposers = {};
  static phraseFamily = /** @type {string|null} */ (null);
  static activeLayer = /** @type {string|null} */ (null);
  static flipBinByLayer = { L1: false, L2: false };
  // Per-layer state for globals that must not bleed between layers
  static perLayerState = {
    L1: { crossModulation: 0, lastCrossMod: 0, balOffset: 0, sideBias: 0, lBal: 0, rBal: 127, cBal: 64, cBal2: 64, cBal3: 64, refVar: 0, bassVar: 0 },
    L2: { crossModulation: 0, lastCrossMod: 0, balOffset: 0, sideBias: 0, lBal: 0, rBal: 127, cBal: 64, cBal2: 64, cBal3: 64, refVar: 0, bassVar: 0 }
  };

  /**
   * Register a layer with buffer and initial timing state.
   * @param {string} name
   * @param {object} [initialState]
   * @param {Function} [setupFn]
   */
  static register(name, buffer, initialState = {}, setupFn = undefined) {
    // Create a plain timing object (flattened, no TimingContext class)
    const defaults = {
      phraseStartTime: 0,
      sectionStartTime: 0,
      spSection: 0,
      numerator: 0,
      denominator: 0,
      spPhrase: 0,
      measureStartTime: 0,
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
      V.assertArray(buffer, 'buffer');
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
    const prevC = c;
    try {
      c = buf;
      if (typeof setupFn === 'function') setupFn(LM.layers[name], buf);
    } catch (e) {
      throw new Error('LayerManager.register: layer setup function threw: ' + (e && e.stack ? e.stack : String(e)));
    }
    // restore previous `c`
    if (prevC === undefined) c = undefined; else c = prevC;
    // return the layer object
    return { layer: LayerManager.layers[name], buffer: buf };
  }

  /**
   * Activate a layer; restores timing globals and sets meter.
   * @param {string} name - Layer name.
   * @param {boolean} [isPoly=false] - Whether this is a polyrhythmic layer.
   * @returns {{numerator: number, denominator: number, spMeasure: number}} Snapshot of key timing values.
   */
  static activate(name, isPoly = false) {
    // Save outgoing layer's state before switching
    if (LayerManager.activeLayer && LayerManager.layers[LayerManager.activeLayer]) {
      saveGlobalsToLayer(LayerManager.layers[LayerManager.activeLayer]);
      LayerManager.flipBinByLayer[LayerManager.activeLayer] = flipBin;
    }
    const layer = LayerManager.layers[name];
    c = layer.buffer;
    LayerManager.activeLayer = name;
    // Restore per-layer flipBin
    flipBin = LayerManager.flipBinByLayer[name] !== undefined ? LayerManager.flipBinByLayer[name] : false;
    loadLayerToGlobals(layer);
    const globalComposer = composer ? composer : null;
    const layerComposer = (LayerManager.layerComposers[name] && typeof LayerManager.layerComposers[name] === 'object')
      ? LayerManager.layerComposers[name]
      : ((layer.measureComposer && typeof layer.measureComposer === 'object') ? layer.measureComposer : globalComposer);
    if (layerComposer && typeof layerComposer === 'object') {
      LayerManager.layerComposers[name] = layerComposer;
      layer.measureComposer = layerComposer;
      composer = layerComposer;
    }
    // Set active layer context in phaseLockedRhythmGenerator for layer-aware phase tracking
    if (phaseLockedRhythmGenerator) {
      phaseLockedRhythmGenerator.setActiveLayer(name);
    }
    if (isPoly) {
      numerator = polyNumerator;
      denominator = polyDenominator;
    }
    return layer;
  }

  /**
   * Advance a layer's timing state.
   * @param {string} name - Layer name.
   * @param {'phrase'|'section'} [advancementType='phrase'] - Type of advancement.
   * @returns {void}
   */
  static advance(name, advancementType = 'phrase') {
    const layer = LayerManager.layers[name];
    V.requireDefined(layer, `layer "${name}"`);
    c = layer.buffer;

    // Advance using the layer's timing values
    if (advancementType === 'phrase') {
      phraseStartTime+=spPhrase;
      // Save current globals into the flattened layer object
      Object.assign(layer, {
        spPhrase,
        phraseStartTime,

        spMeasure,
        measureStartTime,

        spSection,
        sectionStartTime,
      });

    } else if (advancementType === 'section') {
      layer.sectionStartTime=phraseStartTime;
    }
  }

  // Minimal helpers to initialize section origin for layers (keeps it tiny and explicit).
  static setSectionStartFor(name) {
    const layer = LayerManager.layers[name];
    V.requireDefined(layer, `layer "${name}"`);
    layer.sectionStartTime = phraseStartTime;
  }

  static setSectionStartAll() {
    Object.keys(LayerManager.layers).forEach((ln) => LayerManager.setSectionStartFor(ln));
  }

  static setPhraseFamily(familyName) {
    V.assertNonEmptyString(familyName, 'familyName');
    LayerManager.phraseFamily = familyName;
    return familyName;
  }

  static getPhraseFamily() {
    V.assertNonEmptyString(LayerManager.phraseFamily, 'phraseFamily');
    return /** @type {string} */ (LayerManager.phraseFamily);
  }

  static setComposerFor(name, nextComposer) {
    V.assertNonEmptyString(name, 'layer name');
    V.assertObject(nextComposer, 'composer');
    const layer = LayerManager.layers[name];
    V.requireDefined(layer, `layer "${name}"`);
    LayerManager.layerComposers[name] = nextComposer;
    layer.measureComposer = nextComposer;
    if (LayerManager.activeLayer === name) {
      composer = nextComposer;
    }
    return nextComposer;
  }

  static setComposerForAll(nextComposer) {
    V.assertObject(nextComposer, 'composer');
    const layerNames = Object.keys(LayerManager.layers);
    if (layerNames.length === 0) {
      throw new Error('LayerManager.setComposerForAll: no registered layers');
    }
    for (let i = 0; i < layerNames.length; i++) {
      LayerManager.setComposerFor(layerNames[i], nextComposer);
    }
    return nextComposer;
  }

  static getComposerFor(name) {
    V.assertNonEmptyString(name, 'layer name');
    const layer = LayerManager.layers[name];
    V.requireDefined(layer, `layer "${name}"`);
    const mappedComposer = LayerManager.layerComposers[name];
    const layerComposer = layer.measureComposer;
    const globalComposer = composer ? composer : null;
    const resolvedComposer = (mappedComposer && typeof mappedComposer === 'object')
      ? mappedComposer
      : ((layerComposer && typeof layerComposer === 'object') ? layerComposer : globalComposer);

    if (!resolvedComposer) {
      V.requireDefined(resolvedComposer, `composer for layer "${name}"`);
    }

    LayerManager.layerComposers[name] = resolvedComposer;
    layer.measureComposer = resolvedComposer;
    return resolvedComposer;
  }

  /**
   * Save current timing globals back to the active layer.
   */
  static saveActive() {
    if (!LayerManager.activeLayer) return;
    saveGlobalsToLayer(LayerManager.layers[LayerManager.activeLayer]);
  }

  /**
   * Get a layer by name.
   * @param {string} name
   * @returns {object}
   */
  static getLayer(name) {
    return LayerManager.layers[name];
  }

  /**
   * Get all registered layer names.
   * @returns {string[]}
   */
  static getLayerNames() {
    return Object.keys(LayerManager.layers);
  }

  /**
   * Reset all layers (clear buffers and timing state).
   */
  static resetAll() {
    for (const name of Object.keys(LayerManager.layers)) {
      const layer = LayerManager.layers[name];
      layer.buffer.length = 0;
      layer.phraseStartTime = 0;
      layer.sectionStartTime = 0;
      layer.spSection = 0;
      layer.spPhrase = 0;
      layer.measureStartTime = 0;
      layer.spMeasure = 0;
      layer.divMotifs = [];
    }
    LayerManager.activeLayer = null;
    LayerManager.phraseFamily = null;
  }
}

LM = layerManager = LayerManager;

/**
 * Restore timing into naked globals without using banned globals.
 */
function loadLayerToGlobals(layer) {
  V.requireDefined(layer, 'layer');
  spSection = layer.spSection;
  sectionStartTime = layer.sectionStartTime;

  spPhrase = layer.spPhrase;
  phraseStartTime = layer.phraseStartTime;

  measureStartTime = layer.measureStartTime;
  spMeasure = layer.spMeasure;

  // Restore per-layer state for globals that must not bleed between layers
  const pls = LayerManager.perLayerState[layer.id];
  if (pls) {
    crossModulation = pls.crossModulation;
    lastCrossMod = pls.lastCrossMod;
    balOffset = pls.balOffset;
    sideBias = pls.sideBias;
    lBal = pls.lBal;
    rBal = pls.rBal;
    cBal = pls.cBal;
    cBal2 = pls.cBal2;
    cBal3 = pls.cBal3;
    refVar = pls.refVar;
    bassVar = pls.bassVar;
  }
}

function saveGlobalsToLayer(layer) {
  V.requireDefined(layer, 'layer');
  layer.spSection = spSection;
  layer.sectionStartTime = sectionStartTime;

  layer.spPhrase = spPhrase;
  layer.phraseStartTime = phraseStartTime;

  layer.measureStartTime = measureStartTime;
  layer.spMeasure = spMeasure;

  // Save per-layer state before switching away
  const pls = LayerManager.perLayerState[layer.id];
  if (pls) {
    pls.crossModulation = crossModulation;
    pls.lastCrossMod = lastCrossMod;
    pls.balOffset = balOffset;
    pls.sideBias = sideBias;
    pls.lBal = lBal;
    pls.rBal = rBal;
    pls.cBal = cBal;
    pls.cBal2 = cBal2;
    pls.cBal3 = cBal3;
    pls.refVar = refVar;
    pls.bassVar = bassVar;
  }
}
