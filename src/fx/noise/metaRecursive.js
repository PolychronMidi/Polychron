// metaRecursive.js - Meta-recursive noise and easing functions

easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

easingFunctions = [
  (t) => t < 0.5 ? 4 * t * t * t : 1 - m.pow(-2 * t + 2, 3) / 2, // easeInOutCubic
  (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t, // easeInOutQuad
  (t) => t < 0.5 ? (1 - m.sqrt(1 - 4 * t * t)) / 2 : (m.sqrt(1 - m.pow(-2 * t + 2, 2)) + 1) / 2, // easeInOutCirc
  (t) => -(m.cos(m.PI * t) - 1) / 2, // easeInOutSine
  // easeInOutExpo
  (t) => t === 0 ? 0 : t === 1 ? 1 :
    t < 0.5 ? m.pow(2, 20 * t - 10) / 2 :
    (2 - m.pow(2, -20 * t + 10)) / 2,
  // easeInOutElastic
  (t) => {
    const c5 = (2 * m.PI) / 4.5;
    return t === 0 ? 0 : t === 1 ? 1 :
      t < 0.5 ?
        -(m.pow(2, 20 * t - 10) * m.sin((t * 2 - 1.075) * c5)) / 2 :
        (m.pow(2, -20 * t + 10) * m.sin((t * 2 - 0.075) * c5)) / 2 + 1;
  },
];

// Perlin noise implementation
permutation = [...Array(256)].map(() => ri(0, 255));
const perlinP = [...permutation, ...permutation];

fade = function(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
};

lerp = function(t, a, b) {
  return a + t * (b - a);
};

grad = function(hash, x) {
  const h = hash & 15;
  const grad = 1 + (h & 7);
  return (h & 8 ? -grad : grad) * x;
};

perlinNoise = function(x) {
  const X = m.floor(x) & 255;
  x -= m.floor(x);
  const u = fade(x);
  return lerp(u, grad(perlinP[X], x), grad(perlinP[X+1], x-1));
};

noiseFunctions = [
  (x) => perlinNoise(x),
  (x) => m.sin(x * 10) * 0.5 + 0.5, // Sine wave noise
  (x) => m.exp(-m.pow(x - 0.5, 2) / 0.05), // Gaussian curve
  (x) => m.pow(m.sin(x * m.PI), 3), // Cubic sine wave
];

metaRecursiveEaseNoise = function(t, depth = 0, maxDepth = ri(6, 12)) {
  if (depth >= maxDepth) {
    const randomEase = easingFunctions[ri(0, easingFunctions.length - 1)];
    return randomEase(t);
  }
  const randomEase = easingFunctions[ri(0, easingFunctions.length - 1)];
  const randomNoise = noiseFunctions[ri(0, noiseFunctions.length - 1)];
  const noiseScale = rf();
  const noiseAmplitude = noiseScale / rf(1.5,2.5);
  const easedT = randomEase(t);
  const noiseValue = metaRecursiveNoise(t * noiseScale, depth + 1, maxDepth, randomNoise) * noiseAmplitude;
  return m.max(0, m.min(1, easedT + noiseValue));
};

metaRecursiveNoise = function(x, depth = 0, maxDepth = ri(6, 12), noiseFunc) {
  if (depth >= maxDepth) {
    return noiseFunc(x);
  }
  const X = m.floor(x) & 255;
  x -= m.floor(x);
  const u = metaRecursiveEaseNoise(fade(x), depth + 1, maxDepth);
  return lerp(u, grad(perlinP[X], x), grad(perlinP[X+1], x-1));
};

// Meta-recursive 2D using SimplexNoise - combines easing with simplex at multiple scales
metaRecursiveSimplex2D = function(x, y, simplexInstance, depth = 0, maxDepth = ri(5, 10)) {
  if (depth >= maxDepth) {
    return simplexInstance.noise(x, y);
  }
  const randomEase = easingFunctions[ri(0, easingFunctions.length - 1)];
  const noiseScale = rf(0.5, 2.5);
  const amplitude = rf(0.3, 0.7);
  const xPhase = ((x * noiseScale) % 1 + 1) % 1;
  const yPhase = ((y * noiseScale) % 1 + 1) % 1;
  const easedX = randomEase(xPhase);
  const easedY = randomEase(yPhase);
  if (!Number.isFinite(easedX) || !Number.isFinite(easedY)) {
    throw new Error(`metaRecursiveSimplex2D: non-finite eased values at depth=${depth}, xPhase=${xPhase}, yPhase=${yPhase}`);
  }
  return simplexInstance.noise(easedX, easedY) * (1 - amplitude) +
         metaRecursiveSimplex2D(x * noiseScale, y * noiseScale, simplexInstance, depth + 1, maxDepth) * amplitude;
};

// Meta-recursive FBM - recursively varies octave count and parameters
metaRecursiveFBM = function(x, y, simplexInstance, depth = 0, maxDepth = ri(4, 8)) {
  if (depth >= maxDepth) {
    return simplexInstance.noise(x, y);
  }
  const octaves = ri(2, 6);
  const persistence = rf(0.3, 0.7);
  const lacunarity = rf(1.8, 2.5);
  const scale = rf(1.5, 2.5);
  const mix = rf(0.2, 0.5);
  return fbm(simplexInstance, x, y, octaves, persistence, lacunarity) * (1 - mix) +
         metaRecursiveFBM(x * scale, y * scale, simplexInstance, depth + 1, maxDepth) * mix;
};
