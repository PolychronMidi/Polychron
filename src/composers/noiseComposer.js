// noiseComposer.js - Centralized noise application for composer classes
// Keeps composer classes focused on their core responsibilities

/**
 * Apply noise-based pitch variation to a selected note
 * @param {number} selectedNote - The note to vary
 * @param {Object} context - Context for noise calculation (voiceId, callCount, etc.)
 * @returns {number} Note with pitch variation applied
 */
applyComposerPitchNoise = function(selectedNote, context = {}) {
  if (typeof selectedNote !== 'number') {
    throw new Error('applyComposerPitchNoise: selectedNote must be a number');
  }

  const noiseProfile = getNoiseProfile('dramatic');
  const currentTime = (typeof context.callCount === 'number') ? (context.callCount * 0.1) : (typeof context.currentTime === 'number' ? context.currentTime : 0);
  const voiceId = (typeof context.voiceId === 'number') ? context.voiceId : 60;

  const mod = getParameterModulation(voiceId, 'pitch', currentTime);
  const pitchVariation = m.round((mod.y - 0.5) * 2 * 4 * noiseProfile.influenceY); // ±2 semitones
  const variedNote = selectedNote + pitchVariation;

  return m.max(0, m.min(127, variedNote));
};

/**
 * Apply noise variation to melodic development transposition
 * @param {number} baseOffset - Base transposition offset
 * @param {Object} context - Context for noise calculation
 * @param {{degree?: boolean}} [options] - when degree=true, output is in scale-degree steps
 * @returns {number} Modified transposition offset
 */
applyMelodicTranspositionNoise = function(baseOffset, context = {}, options = {}) {
  const noiseProfile = getNoiseProfile('moderate');
  const currentTime = (typeof context.currentTime === 'number') ? context.currentTime : 0;
  const voiceId = (typeof context.voiceId === 'number') ? context.voiceId : 60;
  const phase = (typeof context.phase === 'number') ? context.phase : 0;
  const degreeMode = Boolean(options && options.degree === true);

  const mod = getParameterModulation(voiceId, 'melodic', currentTime);

  // Phase-specific variation ranges
  let variationRange;
  if (degreeMode) {
    if (phase === 0) {
      variationRange = 1; // ±1 degree
    } else if (phase === 1) {
      variationRange = 2; // ±2 degrees
    } else {
      variationRange = 1; // ±1 degree
    }
  } else if (phase === 0) {
    variationRange = 3; // ±1-2 semitones
  } else if (phase === 1) {
    variationRange = 5; // ±2-3 semitones
  } else {
    variationRange = 2; // ±1 semitone
  }

  const variation = m.round((mod.x - 0.5) * 2 * variationRange * noiseProfile.influenceX);
  return baseOffset + variation;
};

/**
 * Apply noise variation to pivot point for inversion
 * @param {number} pivot - Base pivot note
 * @param {Object} context - Context for noise calculation
 * @returns {number} Modified pivot note
 */
applyMelodicPivotNoise = function(pivot, context = {}) {
  const noiseProfile = getNoiseProfile('moderate');
  const currentTime = (typeof context.currentTime === 'number') ? context.currentTime : 0;
  const voiceId = (typeof context.voiceId === 'number') ? context.voiceId : 60;

  const mod = getParameterModulation(voiceId, 'melodic', currentTime);
  const pivotNoise = m.round((mod.y - 0.5) * 2 * 2 * noiseProfile.influenceY); // ±1 semitone

  return clamp(pivot + pivotNoise, 0, 127);
};

/**
 * Apply noise variation to note duration
 * @param {number} baseDuration - Base duration value
 * @param {Object} context - Context for noise calculation
 * @returns {number} Modified duration
 */
applyMelodicDurationNoise = function(baseDuration, context = {}) {
  const noiseProfile = getNoiseProfile('moderate');
  const currentTime = (typeof context.currentTime === 'number') ? context.currentTime : 0;
  const voiceId = (typeof context.voiceId === 'number') ? context.voiceId : 60;

  const mod = getParameterModulation(voiceId, 'melodic', currentTime);
  const durationMod = 0.9 + (mod.y * 0.2 * noiseProfile.influenceY); // 0.9-1.1x multiplier

  return baseDuration * durationMod;
};

/**
 * Apply noise modulation to voice leading weight
 * @param {number} baseWeight - Base weight value
 * @param {string} weightType - Type of weight ('smoothMotion', 'intervalQuality', 'commonTone')
 * @param {Object} context - Context for noise calculation
 * @returns {number} Modified weight
 */
applyVoiceLeadingWeightNoise = function(baseWeight, weightType, context = {}) {
  const noiseProfile = getNoiseProfile('subtle');
  const currentTime = (typeof context.currentTime === 'number') ? context.currentTime : 0;
  const voiceId = (typeof context.voiceId === 'number') ? context.voiceId : 60;

  const mod = getParameterModulation(voiceId, 'voicelead', currentTime);

  // Different modulation ranges per weight type
  let modRange;
  if (weightType === 'smoothMotion') {
    modRange = 0.4; // 0.8x - 1.2x
    return baseWeight * (0.8 + mod.x * modRange * noiseProfile.influenceX);
  } else if (weightType === 'intervalQuality') {
    modRange = 0.2; // 0.9x - 1.1x
    return baseWeight * (0.9 + mod.y * modRange * noiseProfile.influenceY);
  } else if (weightType === 'commonTone') {
    modRange = 0.6; // 0.7x - 1.3x
    return baseWeight * (0.7 + mod.x * modRange * noiseProfile.influenceX);
  }

  return baseWeight;
};
