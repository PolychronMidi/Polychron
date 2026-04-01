// stutterTempoFeel.js - modulates tempo feel based on stutter density.
// High stutter = micro-accelerando, low = micro-ritardando.
// Creates organic rubato driven by stutter activity.

stutterTempoFeel = (() => {
  let intensityEma = 0.3;
  const EMA_ALPHA = 0.12;

  function getTempoModulation() {
    const raw = safePreBoot.call(() => stutterFeedbackListener.getIntensity(), null);
    const intensity = (raw && Number.isFinite(raw.overall)) ? raw.overall : 0.3;
    intensityEma += (intensity - intensityEma) * EMA_ALPHA;
    return clamp((intensityEma - 0.3) * 0.04, -0.02, 0.02);
  }

  function reset() { intensityEma = 0.3; }

  return { getTempoModulation, reset };
})();
crossLayerRegistry.register('stutterTempoFeel', stutterTempoFeel, ['all', 'section']);
