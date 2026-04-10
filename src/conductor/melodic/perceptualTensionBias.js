// src/conductor/melodic/perceptualTensionBias.js
// Cross-run perceptual feedback: previous run's EnCodec CB0 entropy per section
// drives a small tension bias modifier, closing the tension->CB0->tension loop.
// Validated correlation: conductor tension r=0.644 with CB0 entropy.
// High CB0 (complex section) -> slight tension boost; low CB0 -> reduction.
// Effect scales with confidence: at 15% -> ~25% of full effect (+-0.02 max).
// Full effect at confidence >= 0.30 (+-0.08 max).

perceptualTensionBias = (() => {
  const _perc = (() => {
    try {
      const fs = require('fs');
      const statePath = require('path').join(process.cwd(), 'metrics', 'perceptual-report.json');
      const rep = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const secs = (rep.encodec && rep.encodec.sections) || {};
      const cb0Values = Object.values(secs)
        .map(s => s.entropies && s.entropies.cb0)
        .filter(Number.isFinite);
      if (cb0Values.length === 0) return null;
      const meanCb0 = cb0Values.reduce((a, b) => a + b, 0) / cb0Values.length;
      return { secs, meanCb0, confidence: rep.confidence || 0 };
    } catch { return null; }
  })();

  conductorIntelligence.registerTensionBias('perceptualTensionBias', () => {
    if (!_perc || _perc.confidence < 0.10) return 1.0;
    const secData = _perc.secs[String(sectionIndex)];
    const cb0 = secData && secData.entropies && secData.entropies.cb0;
    if (!Number.isFinite(cb0)) return 1.0;
    const strength = m.min(1, (_perc.confidence - 0.10) / 0.20);
    const bias = (cb0 - _perc.meanCb0) * 0.15 * strength;
    return 1.0 + m.max(-0.08, m.min(0.08, bias));
  }, 0.92, 1.08);

  function reset() {}
  conductorIntelligence.registerModule('perceptualTensionBias', { reset }, ['section']);

  return {};
})();
