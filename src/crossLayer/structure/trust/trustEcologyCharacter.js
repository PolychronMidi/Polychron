// trustEcologyCharacter.js - Maps trust system dominance to composer family
// bias. When a trust system dominates, the composition's "personality" shifts
// toward the musical character that system represents.

moduleLifecycle.declare({
  name: 'trustEcologyCharacter',
  subsystem: 'crossLayer',
  deps: ['validator'],
  lazyDeps: ['adaptiveTrustScores', 'emergentMelodicEngine'],
  provides: ['trustEcologyCharacter'],
  crossLayerScopes: ['all', 'section'],
  init: (deps) => {
  const V = deps.validator.create('trustEcologyCharacter');
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
    const melodicCtxTEC = emergentMelodicEngine.getContext();
    const thematicDensity = melodicCtxTEC ? V.optionalFinite(melodicCtxTEC.thematicDensity, 0) : 0;
    const dynamicBoost = DOMINANCE_BOOST + thematicDensity * 0.3; // 1.5 neutral ... 1.8 strong recall
    result[dominantFamily] = (result[dominantFamily] ?? 1.0) * dynamicBoost;
    return result;
  }

  function getDominant() { return { system: dominantSystem, family: dominantFamily }; }

  function reset() { dominantSystem = null; dominantFamily = null; }

  return { update, biasWeights, getDominant, reset };
  },
});
