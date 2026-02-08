// NoiseCoordinator.js - Central noise generation registry and multi-layer coordination
// Patterns extracted from visual screensaver adapted for audio parameter modulation

// Initialize default simplex instance for shared use
defaultSimplex = new SimplexNoise(rf());

// Noise generator registry with named generators
// Each returns values in range appropriate for audio modulation
noiseGenerators = {
  // Core 2D noise
  simplex: (x, y, time) => defaultSimplex.noise(x + time * 0.1, y + time * 0.1),

  // 1D variants (y param ignored)
  perlin: (x, y, time) => perlinNoise(x + time),
  metaRecursive: (x, y, time) => metaRecursiveNoise(x + time, 0, ri(33, 111), noiseFunctions[ri(0, noiseFunctions.length - 1)]),

  // Multi-octave variants
  fbm: (x, y, time, octaves = ri(3, 6)) => fbm(defaultSimplex, x + time * 0.05, y + time * 0.05, octaves),
  turbulence: (x, y, time, octaves = ri(3, 5)) => turbulence(defaultSimplex, x + time * 0.1, y + time * 0.1, octaves),
  ridged: (x, y, time, octaves = ri(3, 5)) => ridged(defaultSimplex, x + time * 0.05, y + time * 0.05, octaves),

  // Cellular patterns
  worley: (x, y, time, cells = ri(3, 8)) => worley(x + time * 0.05, y + time * 0.05, cells),

  // Mathematical noise functions
  sine: (x, y, time) => m.sin(x * 10 + time) * 0.5 + 0.5,
  gaussian: (x, y, time) => m.exp(-m.pow((x + time * 0.1) % 1 - 0.5, 2) / 0.05),

  // Meta-recursive 2D variants
  metaSimplex2D: (x, y, time) => metaRecursiveSimplex2D(x + time * 0.05, y + time * 0.05, defaultSimplex, 0, ri(20, 80)),
  metaFBM: (x, y, time) => metaRecursiveFBM(x + time * 0.05, y + time * 0.05, defaultSimplex, 0, ri(15, 45))
};

// Get noise with fallback to simplex
getNoiseValue = function(generatorName, x, y, time) {
  try {
    const generator = noiseGenerators[generatorName];
    if (!generator) throw new Error(`Unknown noise generator: ${generatorName}`);
    return generator(x, y, time);
  } catch (e) {
    return defaultSimplex.noise(x, y || x);
  }
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

// Get random generator name from registry
randomNoiseGenerator = function() {
  const keys = Object.keys(noiseGenerators);
  return keys[ri(0, keys.length - 1)];
};

// Create noise influence mapper using meta-recursive easing
// Returns value 0-1 determining how much noise affects a parameter
noiseInfluenceMap = function(seed = rf()) {
  return metaRecursiveEaseNoise(seed, 0, ri(20, 100));
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

// Cache generatorKeys to avoid repeated Object.keys() calls
generatorKeys = Object.keys(noiseGenerators);

// Get random generator name from registry (optimized with cached keys)
randomNoiseGenerator = function() {
  return generatorKeys[ri(0, generatorKeys.length - 1)];
};

// Register additional noise generator at runtime (updates cache)
registerNoiseGenerator = function(name, generatorFunc) {
  if (noiseGenerators[name]) {
    throw new Error(`Noise generator '${name}' already registered`);
  }
  noiseGenerators[name] = generatorFunc;
  generatorKeys = Object.keys(noiseGenerators);
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
  const seed = voiceId * 73 + paramKey.length * 43; // deterministic seed from voice+param
  const offsetX = rf(-1000, 1000) + seed;
  const offsetY = rf(-1000, 1000) + seed * 2;
  return {
    x: clampNoiseValue(layeredNoise(generatorName, offsetX, offsetY, time, 0.01, 0.1)),
    y: clampNoiseValue(layeredNoise(generatorName, offsetY, offsetX, time, 0.01, 0.1)),
    generator: generatorName
  };
};



// Smooth noise value integration with lerping (prevents sudden jumps)
smoothNoiseValue = function(currentValue, targetNoise, deltaTime, smoothing = 0.7) {
  const lerpAmount = deltaTime * smoothing;
  return currentValue + (targetNoise - currentValue) * lerpAmount;
};
