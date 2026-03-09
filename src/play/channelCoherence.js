// channelCoherence.js - Extracts per-channel stutter/crossMod coherence adjustments
// Shared by source, reflection, and bass emission blocks in playNotes.

const V = validator.create('channelCoherence');

/**
 * Computes per-channel stutter coherence adjustments and noise-shaped velocity.
 *
 * @param {number} ch         MIDI channel
 * @param {string} profile    stutterConfig profile name ('source'|'reflection'|'bass')
 * @param {number} noiseBase  Pre-noise velocity (rawVel * (1 - factor * noiseInfluence))
 * @param {number} voiceId    Deterministic voice identifier for noise seeding
 * @param {number} time       Current time for noise sampling
 * @returns {{ perProbScaled: number, onVel: number, velocityScaleBias: number }}
 */
getChannelCoherence = function(ch, profile, noiseBase, voiceId, time) {
  V.assertObject(stutterConfig, 'stutterConfig');
  V.requireType(stutterConfig.getCrossModRules, 'function', 'stutterConfig.getCrossModRules');
  V.requireType(stutterConfig.getProfileConfig, 'function', 'stutterConfig.getProfileConfig');
  V.assertObject(conductorConfig, 'conductorConfig');
  V.requireType(conductorConfig.getEmissionScaling, 'function', 'conductorConfig.getEmissionScaling');

  // 1. Channel mod from stutter beat-context
  const chMod = (stutter && StutterManager.beatContext &&
    StutterManager.beatContext.mod && StutterManager.beatContext.mod[ch])
    ? StutterManager.beatContext.mod[ch]
    : null;

  // 2. Cross-modulation rules from stutterConfig
  const crossRules = stutterConfig.getCrossModRules();
  V.assertObject(crossRules, 'crossRules');
  V.assertObject(crossRules.pan, 'crossRules.pan');
  V.assertObject(crossRules.fade, 'crossRules.fade');
  V.assertObject(crossRules.fx, 'crossRules.fx');

  // 3. Accumulate per-prob scale and velocity bias from pan/fade/fx modifiers
  let perProbScale = 1;
  let velocityScaleBias = 0;
  if (chMod) {
    if (typeof chMod.pan === 'number') {
      perProbScale *= (1 + (crossRules.pan.stutterProbScale - 1) * m.abs(chMod.pan));
    }
    if (typeof chMod.fade === 'number') {
      velocityScaleBias += V.requireFinite(crossRules.fade.velocityScaleBias, 'crossRules.fade.velocityScaleBias') * chMod.fade;
    }
    // fx currently only influences shift-range in stutterNotes; perProbScale unchanged
  }

  // 4. Profile-specific per-prob from stutterConfig
  const profileCfg = stutterConfig.getProfileConfig(profile);
  V.assertObject(profileCfg, `profileCfg.${profile}`);
  const perProbScaled = clamp(V.requireFinite(profileCfg.perProb, `profileCfg.${profile}.perProb`) * perProbScale, 0, 1);

  // 5. Noise-shaped velocity with bias (noise profile from conductor)
  const emissionScaling = conductorConfig.getEmissionScaling();
  V.assertObject(emissionScaling, 'conductorConfig.getEmissionScaling()');
  const emissionNoiseProfile = V.assertNonEmptyString(emissionScaling.noiseProfile, 'conductorConfig.getEmissionScaling().noiseProfile');
  const onVelBase = applyNoiseToVelocity(noiseBase, voiceId, time, emissionNoiseProfile);
  const onVel = clamp(m.round(onVelBase * (1 + velocityScaleBias)), 1, MIDI_MAX_VALUE);

  return { perProbScaled, onVel, velocityScaleBias };
};
