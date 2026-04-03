// trustEcologyCharacter.js - Maps trust system dominance to composer family
// bias. When a trust system dominates, the composition's "personality" shifts
// toward the musical character that system represents.

trustEcologyCharacter = (() => {
  const TRUST_TO_FAMILY = {
    stutterContagion: 'rhythmicDrive',
    harmonicIntervalGuard: 'diatonicCore',
    convergenceHarmonicTrigger: 'harmonicMotion',
    motifEcho: 'development',
    temporalGravity: 'tonalExploration',
    articulationComplement: 'expressiveDynamic',
    dynamicEnvelope: 'expressiveDynamic',
    grooveTransfer: 'rhythmicDrive',
    spectralComplementarity: 'diatonicCore',
    cadenceAlignment: 'harmonicMotion'
  };

  const DOMINANCE_BOOST = 1.5;
  let dominantSystem = null;
  let dominantFamily = null;

  function update() {
    const snap = adaptiveTrustScores.getSnapshot();
    let topSystem = null;
    let topScore = -1;
    for (const name of Object.keys(TRUST_TO_FAMILY)) {
      const data = snap[name];
      if (data && data.score > topScore) {
        topScore = data.score;
        topSystem = name;
      }
    }
    dominantSystem = topSystem;
    dominantFamily = topSystem ? TRUST_TO_FAMILY[topSystem] : null;
  }

  function biasWeights(baseWeights) {
    if (!dominantFamily || !baseWeights[dominantFamily]) return baseWeights;
    const result = Object.assign({}, baseWeights);
    result[dominantFamily] = (result[dominantFamily] || 1.0) * DOMINANCE_BOOST;
    return result;
  }

  function getDominant() { return { system: dominantSystem, family: dominantFamily }; }

  function reset() { dominantSystem = null; dominantFamily = null; }

  return { update, biasWeights, getDominant, reset };
})();
crossLayerRegistry.register('trustEcologyCharacter', trustEcologyCharacter, ['all', 'section']);
