// metaRecursive.js - Meta-recursive noise and easing functions

easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

easingFunctions = [
  (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, // easeInOutCubic
  (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t, // easeInOutQuad
  (t) => t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2, // easeInOutCirc
  (t) => -(Math.cos(Math.PI * t) - 1) / 2, // easeInOutSine
  // easeInOutExpo
  (t) => t === 0 ? 0 : t === 1 ? 1 :
    t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 :
    (2 - Math.pow(2, -20 * t + 10)) / 2,
  // easeInOutElastic
  (t) => {
    const c5 = (2 * Math.PI) / 4.5;
    return t === 0 ? 0 : t === 1 ? 1 :
      t < 0.5 ?
        -(Math.pow(2, 20 * t - 10) * Math.sin((t * 2 - 1.075) * c5)) / 2 :
        (Math.pow(2, -20 * t + 10) * Math.sin((t * 2 - 0.075) * c5)) / 2 + 1;
  },
];

// Perlin noise implementation
permutation = [...Array(256)].map(() => Math.floor(Math.random() * 256));
p = [...permutation, ...permutation];

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
  const X = Math.floor(x) & 255;
  x -= Math.floor(x);
  const u = fade(x);
  return lerp(u, grad(p[X], x), grad(p[X+1], x-1));
};

noiseFunctions = [
  (x) => perlinNoise(x),
  (x) => Math.sin(x * 10) * 0.5 + 0.5, // Sine wave noise
  (x) => Math.exp(-Math.pow(x - 0.5, 2) / 0.05), // Gaussian curve
  (x) => Math.pow(Math.sin(x * Math.PI), 3), // Cubic sine wave
];

metaRecursiveEaseNoise = function(t, depth = 0, maxDepth = Math.ceil(Math.random() * 300) + 33) {
  if (depth >= maxDepth) {
    const randomEase = easingFunctions[Math.floor(Math.random() * easingFunctions.length)];
    return randomEase(t);
  }
  const randomEase = easingFunctions[Math.floor(Math.random() * easingFunctions.length)];
  const randomNoise = noiseFunctions[Math.floor(Math.random() * noiseFunctions.length)];
  const noiseScale = Math.random();
  const noiseAmplitude = noiseScale / rf(1.5,2.5);
  const easedT = randomEase(t);
  const noiseValue = metaRecursiveNoise(t * noiseScale, depth + 1, maxDepth, randomNoise) * noiseAmplitude;
  return Math.max(0, Math.min(1, easedT + noiseValue));
};

metaRecursiveNoise = function(x, depth = 0, maxDepth = ri(33,111), noiseFunc) {
  if (depth >= maxDepth) {
    return noiseFunc(x);
  }
  const X = Math.floor(x) & 255;
  x -= Math.floor(x);
  const u = metaRecursiveEaseNoise(fade(x), depth + 1, maxDepth);
  return lerp(u, grad(p[X], x), grad(p[X+1], x-1));
};
