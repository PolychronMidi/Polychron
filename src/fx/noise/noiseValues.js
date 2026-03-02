// NoiseValues.js - noise value helpers and modulation utilities

// Get noise with fallback to simplex
getNoiseValue = function(generatorName, x, y, time) {
  const generator = noiseGenerators[generatorName];
  if (!generator) throw new Error(`Unknown noise generator: ${generatorName}`);
  return generator(x, y, time);
};

// Multi-frequency layered noise (combines broad movement with fine detail)
// Useful for natural-feeling parameter modulation
layeredNoise = function(generatorName, x, y, time, freqLow = 0.01, freqHigh = 0.1, mixLow = 0.7, mixHigh = 0.3) {
  const broadNoise = getNoiseValue(generatorName, x * freqLow, y * freqLow, time);
  const detailNoise = getNoiseValue(generatorName, x * freqHigh, y * freqHigh, time * 3);
  return broadNoise * mixLow + detailNoise * mixHigh;
};

// Create unique offset for decorrelated noise instances
// Use this to give each voice/channel/parameter its own noise space
createNoiseOffset = function() {
  return rf(-100000, 100000);
};

// Create noise influence mapper using meta-recursive easing
// Returns value 0-1 determining how much noise affects a parameter
noiseInfluenceMap = function(seed = rf()) {
  return metaRecursiveEaseNoise(seed, 0, ri(5, 10));
};

// Dual-axis noise configuration (e.g., for stereo L/R modulation)
// Returns object with independent noise generators and influence amounts
createDualAxisNoiseConfig = function() {
  return {
    generatorX: randomNoiseGenerator(),
    generatorY: randomNoiseGenerator(),
    influenceX: noiseInfluenceMap(),
    influenceY: noiseInfluenceMap(),
    offsetX: createNoiseOffset(),
    offsetY: createNoiseOffset()
  };
};

// Apply dual-axis noise at given position and time
applyDualAxisNoise = function(config, x, y, time) {
  const noiseX = layeredNoise(
    config.generatorX,
    x + config.offsetX,
    y + config.offsetX,
    time
  ) * config.influenceX;

  const noiseY = layeredNoise(
    config.generatorY,
    x + config.offsetY,
    y + config.offsetY,
    time
  ) * config.influenceY;

  return { x: noiseX, y: noiseY };
};

// Clamp noise values to 0-1 range
clampNoiseValue = function(value) {
  return m.max(0, m.min(1, value));
};

// Apply noise with automatic clamping (safe integration API)
safeApplyNoise = function(config, x, y, time) {
  const noise = applyDualAxisNoise(config, x, y, time);
  return {
    x: clampNoiseValue(noise.x),
    y: clampNoiseValue(noise.y)
  };
};

// One-shot unified modulation call (typical integration pattern)
// Returns {x, y} values 0-1 for parameter modulation
getParameterModulation = function(voiceId, paramKey, time, generatorName = randomNoiseGenerator()) {
  const V = validator.create('noiseValues');
  const voiceIdNum = V.requireFinite(Number(voiceId), 'voiceId');
  V.assertNonEmptyString(paramKey, 'paramKey');
  V.requireFinite(Number(time), 'time');
  V.assertNonEmptyString(generatorName, 'generatorName');

  const seed = voiceIdNum * 73 + paramKey.length * 43; // deterministic seed from voice+param
  const offsetX = rf(-1000, 1000) + seed;
  const offsetY = rf(-1000, 1000) + seed * 2;
  const x = clampNoiseValue(layeredNoise(generatorName, offsetX, offsetY, Number(time), 0.01, 0.1));
  const y = clampNoiseValue(layeredNoise(generatorName, offsetY, offsetX, Number(time), 0.01, 0.1));
  V.requireFinite(x, 'modulation.x');
  V.requireFinite(y, 'modulation.y');
  return {
    x,
    y,
    generator: generatorName
  };
};

// Smooth noise value integration with lerping (prevents sudden jumps)
smoothNoiseValue = function(currentValue, targetNoise, deltaTime, smoothing = 0.7) {
  const lerpAmount = deltaTime * smoothing;
  return currentValue + (targetNoise - currentValue) * lerpAmount;
};
