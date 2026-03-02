// playNotesComputeUnit.js - Per-unit note parameter computation for playNotes.
// Computes timing, sustain, velocity, and noise context for a single emission unit.
// Caches layer ID seed on the layer object (avoids recomputing per micro-unit).
// Mutates the global `velocity` as a side effect.

const V = validator.create('playNotesComputeUnit');

/**
 * Compute note timing, velocity, and noise context for one emission unit.
 * Side effect: sets the global `velocity`.
 *
 * @param {string} unit - 'beat' | 'div' | 'subdiv' | 'subsubdiv'
 * @param {any} emissionAdjustments - from composerRuntimeProfileAdapter
 * @param {any} emissionCfg - emissionScaling merged with noiseProfile
 * @param {any} layer - active layer object (mutated to cache _cachedLayerIdSeed)
 * @returns {{ on: number, sustain: number, binVel: number, noiseInfluence: number, currentTime: number, voiceIdSeed: number }}
 */
playNotesComputeUnit = function playNotesComputeUnit(unit, emissionAdjustments, emissionCfg, layer) {
  const baseVelocitySeed = V.requireFinite(emissionAdjustments.baseVelocity, 'emissionAdjustments.baseVelocity');
  const combinedVelocityScale = V.requireFinite(emissionAdjustments.velocityScale, 'emissionAdjustments.velocityScale');
  if (combinedVelocityScale <= 0) {
    throw new Error(`${unit}.playNotesComputeUnit: combined profile velocity scale must be a positive finite number`);
  }
  const motifTimingOffsetUnits = V.requireFinite(emissionAdjustments.timingOffsetUnits, 'emissionAdjustments.timingOffsetUnits');
  const rhythmSwingAmount = V.requireFinite(emissionAdjustments.swingAmount, 'emissionAdjustments.swingAmount');

  // Validate timing globals and compute swing offset
  V.requireFinite(Number(tpUnit), 'tpUnit');
  V.requireFinite(Number(beatStart), 'beatStart');
  const swingTicks = V.requireFinite(
    Number(RhythmManager.swingOffset(V.requireFinite(beatIndex, 'beatIndex'), rhythmSwingAmount)),
    'swingTicks'
  );
  const timingOffsetTicks = (motifTimingOffsetUnits * Number(tpUnit)) + swingTicks;

  const tempoFeelOffset = V.requireFinite(Number(tempoFeelEngine.getTickOffset()), 'tempoFeelOffset');

  // Compute on-tick and sustain durations
  const on = unitStart + timingOffsetTicks + tempoFeelOffset + (tpUnit * rv(rf(.2), [-.1, .07], .3));
  const shortSustain = rv(rf(m.max(tpUnit * .5, tpUnit / unitsPerParent), (tpUnit * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
  const longSustain = rv(rf(tpUnit * .8, (tpParent * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -0.1]);
  const useShort = subdivsPerMinute > ri(400, 650);
  const sustain = (useShort ? shortSustain : longSustain) * rv(rf(.8, 1.3));

  // Build velocity through successive profile passes (sets global `velocity`)
  velocity = rl(baseVelocitySeed, -3, 3, 95, 105);
  velocity = m.max(1, m.min(127, m.round(velocity * combinedVelocityScale)));

  // Unit-level velocity scaling (beat=1.0, div=0.9, subdiv=0.85, subsubdiv=0.8 - finer units play softer)
  const unitProfile = motifConfig.getUnitProfile(unit);
  if (unitProfile && Number.isFinite(unitProfile.velocityScale)) {
    velocity = m.max(1, m.min(127, m.round(velocity * unitProfile.velocityScale)));
  }

  // voiceConfig blend for additional velocity shaping
  const vcProfile = voiceConfig.getProfile('default');
  if (vcProfile && Number.isFinite(vcProfile.baseVelocity)) {
    velocity = m.max(1, m.min(127, m.round(velocity * (1 - emissionCfg.voiceConfigBlend) + vcProfile.baseVelocity * emissionCfg.voiceConfigBlend)));
  }

  const binVel = rv(velocity * rf(.4, .9));

  // Noise influence for organic velocity modulation
  V.requireType(getNoiseProfile, 'function', 'getNoiseProfile');
  const noiseProfile = getNoiseProfile(emissionCfg.noiseProfile);
  V.assertObject(noiseProfile, `getNoiseProfile(${emissionCfg.noiseProfile})`);
  const influenceX = V.requireFinite(Number(noiseProfile.influenceX), 'noiseProfile.influenceX');
  const influenceY = V.requireFinite(Number(noiseProfile.influenceY), 'noiseProfile.influenceY');
  const noiseInfluence = clamp((influenceX + influenceY) / 2, 0, 1);
  const currentTime = beatStart + tpUnit * 0.5; // Approximate time within the unit

  // Layer ID seed - cached on layer object to avoid recomputing per micro-unit
  let layerIdSeed = layer._cachedLayerIdSeed;
  if (layerIdSeed === undefined) {
    const layerIdValue = layer && Object.prototype.hasOwnProperty.call(layer, 'id') ? layer.id : null;
    if (typeof layerIdValue === 'number' && Number.isFinite(layerIdValue)) {
      layerIdSeed = layerIdValue;
    } else if (typeof layerIdValue === 'string' && layerIdValue.length > 0) {
      let sum = 0;
      for (let ci = 0; ci < layerIdValue.length; ci++) sum += layerIdValue.charCodeAt(ci);
      layerIdSeed = sum;
    } else {
      V.assertNonEmptyString(LM.activeLayer, 'LM.activeLayer');
      const activeLayerName = /** @type {string} */ (LM.activeLayer);
      let sum = 0;
      for (let ci = 0; ci < activeLayerName.length; ci++) sum += activeLayerName.charCodeAt(ci);
      layerIdSeed = sum;
    }
    layer._cachedLayerIdSeed = layerIdSeed;
  }
  const voiceIdSeed = m.round(Number(beatStart) * 73 + layerIdSeed * 43 + V.requireFinite(measureCount, 'measureCount'));

  return { on, sustain, binVel, noiseInfluence, currentTime, voiceIdSeed };
};
