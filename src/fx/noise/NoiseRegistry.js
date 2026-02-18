// NoiseRegistry.js - generator registry and shared simplex instance

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

// Cache generator keys to avoid repeated Object.keys() calls
generatorKeys = Object.keys(noiseGenerators);

// Get random generator name from registry — texture-biased (#6)
// During chord bursts → smooth generators (simplex, sine, fbm, gaussian)
// During flurries → chaotic generators (turbulence, ridged, worley, metaRecursive)
randomNoiseGenerator = function() {
  if (typeof DrumTextureCoupler !== 'undefined' && DrumTextureCoupler && typeof DrumTextureCoupler.getMetrics === 'function') {
    const texMetrics = DrumTextureCoupler.getMetrics();
    if (texMetrics.intensity > 0.2) {
      const smoothKeys = ['simplex', 'sine', 'fbm', 'gaussian', 'metaSimplex2D'];
      const chaoticKeys = ['turbulence', 'ridged', 'worley', 'metaRecursive', 'metaFBM'];
      const burstDom = texMetrics.burstCount > texMetrics.flurryCount;
      const preferred = burstDom ? smoothKeys : chaoticKeys;
      if (rf() < 0.7) {
        const available = preferred.filter(k => noiseGenerators[k]);
        if (available.length > 0) return available[ri(0, available.length - 1)];
      }
    }
  }
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
