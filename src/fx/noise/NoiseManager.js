// noiseManager.js - Bridge between noise system and audio parameters

// Apply noise modulation to a velocity value
// Returns velocity modified by noise, clamped to MIDI range [0, 127]
applyNoiseToVelocity = function(baseVelocity, voiceId, currentTime, profileName = 'subtle') {
  if (typeof getParameterModulation !== 'function') {
    throw new Error('applyNoiseToVelocity: getParameterModulation not available');
  }
  if (typeof getNoiseProfile !== 'function') {
    throw new Error('applyNoiseToVelocity: getNoiseProfile not available');
  }

  const mod = getParameterModulation(voiceId, 'velocity', currentTime);
  const profile = getNoiseProfile(profileName);

  // Use the noise influence to scale velocity variation
  // Noise value is 0-1, so we apply it as a percentage change
  const modifier = (mod.x + mod.y) / 2; // Average of X/Y modulation
  const influenceScale = (profile.influenceX + profile.influenceY) / 2;

  // Apply modulation: add/subtract percentage of base velocity
  // If modifier is 1 (high noise), velocity increases; if 0 (low), it decreases
  const noiseAdjustment = baseVelocity * (modifier - 0.5) * 2 * influenceScale;
  const modifiedVelocity = baseVelocity + noiseAdjustment;

  return m.max(0, m.min(127, m.round(modifiedVelocity)));
};

// Apply noise modulation to a pan value (0-127, center=64)
// Returns pan modified by noise, clamped to MIDI range [0, 127]
applyNoiseToPan = function(basePan, voiceId, currentTime, profileName = 'subtle') {
  if (typeof getParameterModulation !== 'function') {
    throw new Error('applyNoiseToPan: getParameterModulation not available');
  }
  if (typeof getNoiseProfile !== 'function') {
    throw new Error('applyNoiseToPan: getNoiseProfile not available');
  }

  const mod = getParameterModulation(voiceId, 'pan', currentTime);
  const profile = getNoiseProfile(profileName);

  // X modulation affects pan position directly
  // Map from [0, 1] noise to [-64, +64] pan offset from center
  const panRange = 60; // Max deviation from center
  const xOffset = (mod.x - 0.5) * 2 * panRange * profile.influenceX;

  const modifiedPan = basePan + xOffset;
  return m.max(0, m.min(127, m.round(modifiedPan)));
};

// Apply noise modulation to sustain/duration
// Returns sustain duration modified by noise
applyNoiseToSustain = function(baseSustain, voiceId, currentTime, profileName = 'subtle') {
  if (typeof getParameterModulation !== 'function') {
    throw new Error('applyNoiseToSustain: getParameterModulation not available');
  }
  if (typeof getNoiseProfile !== 'function') {
    throw new Error('applyNoiseToSustain: getNoiseProfile not available');
  }

  const mod = getParameterModulation(voiceId, 'sustain', currentTime);
  const profile = getNoiseProfile(profileName);

  // Y modulation affects sustain duration
  // Map from [0, 1] noise to [0.8x, 1.2x] sustain multiplier
  const sustainMultiplier = 0.8 + mod.y * 0.4; // Range: 0.8 to 1.2
  const sustainInfluence = profile.influenceY;

  // Apply influence as partial blend toward the multiplier
  const blended = 1.0 + (sustainMultiplier - 1.0) * sustainInfluence;
  return baseSustain * blended;
};

// Apply noise to a generic parameter within bounds
applyNoiseToParameter = function(baseValue, voiceId, paramKey, currentTime, minVal, maxVal, profileName = 'subtle') {
  if (typeof getParameterModulation !== 'function') {
    throw new Error('applyNoiseToParameter: getParameterModulation not available');
  }
  if (typeof getNoiseProfile !== 'function') {
    throw new Error('applyNoiseToParameter: getNoiseProfile not available');
  }

  const mod = getParameterModulation(voiceId, paramKey, currentTime);
  const profile = getNoiseProfile(profileName);

  // Use X modulation for linear parameter variation
  const range = maxVal - minVal;
  const modifier = (mod.x - 0.5) * 2 * range * profile.influenceX;
  const modifiedValue = baseValue + modifier;

  return m.max(minVal, m.min(maxVal, modifiedValue));
};

// Get a noise profile (removed "Safe" - always fails loudly if profile unavailable)
getNoiseProfileOrFail = function(profileName = 'subtle') {
  if (typeof getNoiseProfile !== 'function') {
    throw new Error('getNoiseProfileOrFail: getNoiseProfile not available');
  }
  return getNoiseProfile(profileName);
};
