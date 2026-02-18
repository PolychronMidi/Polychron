// channelCoherence.js — Extracts per-channel Stutter/crossMod coherence adjustments
// Shared by source, reflection, and bass emission blocks in playNotes.

/**
 * Computes per-channel stutter coherence adjustments and noise-shaped velocity.
 *
 * @param {number} ch         MIDI channel
 * @param {string} profile    StutterConfig profile name ('source'|'reflection'|'bass')
 * @param {number} noiseBase  Pre-noise velocity (rawVel * (1 - factor * noiseInfluence))
 * @param {number} voiceId    Deterministic voice identifier for noise seeding
 * @param {number} time       Current time for noise sampling
 * @returns {{ perProbScaled: number, onVel: number, velocityScaleBias: number }}
 */
getChannelCoherence = function(ch, profile, noiseBase, voiceId, time) {
  // 1. Channel mod from Stutter beat-context
  const chMod = (typeof Stutter !== 'undefined' && Stutter && Stutter.beatContext &&
    Stutter.beatContext.mod && Stutter.beatContext.mod[ch])
    ? Stutter.beatContext.mod[ch]
    : null;

  // 2. Cross-modulation rules from StutterConfig
  const crossRules = (typeof StutterConfig !== 'undefined' && StutterConfig &&
    typeof StutterConfig.getCrossModRules === 'function')
    ? StutterConfig.getCrossModRules()
    : { pan: { stutterProbScale: 1 }, fade: { velocityScaleBias: 0 }, fx: { shiftRangeScale: 1 } };

  // 3. Accumulate per-prob scale and velocity bias from pan/fade/fx modifiers
  let perProbScale = 1;
  let velocityScaleBias = 0;
  if (chMod) {
    if (typeof chMod.pan === 'number') {
      perProbScale *= (1 + (crossRules.pan.stutterProbScale - 1) * m.abs(chMod.pan));
    }
    if (typeof chMod.fade === 'number') {
      velocityScaleBias += (crossRules.fade.velocityScaleBias || 0) * chMod.fade;
    }
    // fx currently only influences shift-range in stutterNotes; perProbScale unchanged
  }

  // 4. Profile-specific per-prob from StutterConfig
  const profileCfg = (typeof StutterConfig !== 'undefined' && StutterConfig &&
    typeof StutterConfig.getProfileConfig === 'function')
    ? StutterConfig.getProfileConfig(profile)
    : { perProb: 1 };
  const perProbScaled = clamp((profileCfg.perProb || 0) * perProbScale, 0, 1);

  // 5. Noise-shaped velocity with bias (noise profile from conductor)
  const emissionNoiseProfile = (typeof ConductorConfig !== 'undefined' && ConductorConfig && typeof ConductorConfig.getEmissionScaling === 'function')
    ? (ConductorConfig.getEmissionScaling().noiseProfile || 'subtle')
    : 'subtle';
  const onVelBase = applyNoiseToVelocity(noiseBase, voiceId, time, emissionNoiseProfile);
  const onVel = clamp(m.round(onVelBase * (1 + velocityScaleBias)), 1, 127);

  return { perProbScaled, onVel, velocityScaleBias };
};
