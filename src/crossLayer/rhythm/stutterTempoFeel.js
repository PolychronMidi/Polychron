// stutterTempoFeel.js - modulates tempo feel based on stutter density.
// High stutter = micro-accelerando, low = micro-ritardando.
// Per-layer EMA prevents cross-layer contamination.

moduleLifecycle.declare({
  name: 'stutterTempoFeel',
  subsystem: 'crossLayer',
  deps: ['stutterFeedbackListener', 'validator'],
  provides: ['stutterTempoFeel'],
  crossLayerScopes: ['all', 'section'],
  init: (deps) => {
  const stutterFeedbackListener = deps.stutterFeedbackListener;
  const V = deps.validator.create('stutterTempoFeel');
  const emaByLayer = { L1: 0.3, L2: 0.3 };
  const EMA_ALPHA = 0.18;

  function getTempoModulation() {
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    const raw = stutterFeedbackListener.getIntensity();
    const intensity = (raw && Number.isFinite(raw.overall)) ? raw.overall : 0.3;
    emaByLayer[layer] += (intensity - emaByLayer[layer]) * EMA_ALPHA;
    const base = clamp((emaByLayer[layer] - 0.3) * 0.06, -0.03, 0.03);
    // Melodic coupling: ascending phrases micro-accelerate, descending micro-decelerate.
    const melodicCtxSTF = emergentMelodicEngine.getContext();
    const dirBias = melodicCtxSTF ? V.optionalFinite(melodicCtxSTF.directionBias, 0) : 0;
    return clamp(base + dirBias * 0.008, -0.04, 0.04);
  }

  function reset() { emaByLayer.L1 = 0.3; emaByLayer.L2 = 0.3; }

  return { getTempoModulation, reset };
  },
});
