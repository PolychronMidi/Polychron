// noiseConfig.js - Noise profile instantiation and configuration lookup

// Validate that NOISE_PROFILES global is available from src/conductor/config.js
if (!NOISE_PROFILES) {
  throw new Error('noiseConfig.js: NOISE_PROFILES global not found (must be loaded from src/conductor/config.js)');
}

// Instantiate a noise profile with factory functions applied
// This is the main entry point - converts static config into dynamic instances
getNoiseProfile = function(profileName = 'moderate') {
  if (!NOISE_PROFILES[profileName]) {
    throw new Error(`Unknown noise profile: ${profileName}`);
  }

  const profile = NOISE_PROFILES[profileName];

  // Static profiles (subtle) - fixed generator names, low influence
  if (typeof profile.generatorX === 'string' && typeof profile.generatorY === 'string') {
    return {
      generatorX: profile.generatorX,
      generatorY: profile.generatorY,
      influenceX: profile.influenceX,
      influenceY: profile.influenceY,
      offsetX: createNoiseOffset(),
      offsetY: createNoiseOffset()
    };
  }

  // Dynamic profiles (moderate, chaotic) - null generators, null influences
  if (profile.generatorX === null && profile.generatorY === null) {
    return {
      generatorX: randomNoiseGenerator(),
      generatorY: randomNoiseGenerator(),
      influenceX: noiseInfluenceMap(),
      influenceY: noiseInfluenceMap(),
      offsetX: createNoiseOffset(),
      offsetY: createNoiseOffset()
    };
  }

  // Array-based profiles (dramatic) - pick from array choices, range influences
  if (Array.isArray(profile.generatorX) && Array.isArray(profile.generatorY)) {
    return {
      generatorX: profile.generatorX[ri(0, profile.generatorX.length - 1)],
      generatorY: profile.generatorY[ri(0, profile.generatorY.length - 1)],
      influenceX: rf(profile.influenceX.min, profile.influenceX.max),
      influenceY: rf(profile.influenceY.min, profile.influenceY.max),
      offsetX: createNoiseOffset(),
      offsetY: createNoiseOffset()
    };
  }

  throw new Error(`Cannot instantiate profile ${profileName}: format not recognized`);
};
