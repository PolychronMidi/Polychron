// stutterTempoFeel.js - modulates tempo feel based on stutter density.
// High stutter = micro-accelerando, low = micro-ritardando.
// Per-layer EMA prevents cross-layer contamination.

stutterTempoFeel = (() => {
  const emaByLayer = { L1: 0.3, L2: 0.3 };
  const EMA_ALPHA = 0.18;

  function getTempoModulation() {
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    const raw = safePreBoot.call(() => stutterFeedbackListener.getIntensity(), null);
    const intensity = (raw && Number.isFinite(raw.overall)) ? raw.overall : 0.3;
    emaByLayer[layer] += (intensity - emaByLayer[layer]) * EMA_ALPHA;
    return clamp((emaByLayer[layer] - 0.3) * 0.06, -0.03, 0.03);
  }

  function reset() { emaByLayer.L1 = 0.3; emaByLayer.L2 = 0.3; }

  return { getTempoModulation, reset };
})();
crossLayerRegistry.register('stutterTempoFeel', stutterTempoFeel, ['all', 'section']);
