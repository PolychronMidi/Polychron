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

metaRecursiveNoise = function(x, depth = 0, maxDepth = ri(33,111), noiseFunc) {
  if (depth >= maxDepth) {
    return noiseFunc(x);
  }
  const X = Math.floor(x) & 255;
  x -= Math.floor(x);
  const u = metaRecursiveEaseNoise(fade(x), depth + 1, maxDepth);
  return lerp(u, grad(p[X], x), grad(p[X+1], x-1));
};

// Simplex noise constants
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];
SimplexNoise = class {
  constructor(seed = Math.random()) {
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      this.p[i] = Math.floor(seed * 256);
      seed = (seed * 9301 + 49297) % 233280 / 233280;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
    }
  }

  dot(g, x, y) {
    return g[0] * x + g[1] * y;
  }

  noise(xin, yin) {
    xin = Math.round(xin * 1000) / 1000;
    yin = Math.round(yin * 1000) / 1000;
    let n0, n1, n2;
    let s = (xin + yin) * F2;
    let i = Math.floor(xin + s);
    let j = Math.floor(yin + s);
    let t = (i + j) * G2;
    let X0 = i - t;
    let Y0 = j - t;
    let x0 = xin - X0;
    let y0 = yin - Y0;
    let i1, j1;
    if (x0 > y0) {
      i1 = 1; j1 = 0;
    } else {
      i1 = 0; j1 = 1;
    }
    let x1 = x0 - i1 + G2;
    let y1 = y0 - j1 + G2;
    let x2 = x0 - 1 + 2 * G2;
    let y2 = y0 - 1 + 2 * G2;
    let ii = i & 255;
    let jj = j & 255;
    let perm = this.perm;
    let gi0 = perm[ii + perm[jj]] % 12;
    let gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
    let gi2 = perm[ii + 1 + perm[jj + 1]] % 12;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    n0 = (t0 < 0) ? 0 : (t0 * t0) ** 2 * this.dot(grad3[gi0], x0, y0);
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    n1 = (t1 < 0) ? 0 : (t1 * t1) ** 2 * this.dot(grad3[gi1], x1, y1);
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    n2 = (t2 < 0) ? 0 : (t2 * t2) ** 2 * this.dot(grad3[gi2], x2, y2);
    return 70 * (n0 + n1 + n2);
  }
};

// Perlin noise implementation
permutation = [...Array(256)].map(() => Math.floor(Math.random() * 256));
p = [...permutation, ...permutation];
perlinNoise = function(x) {
  const X = Math.floor(x) & 255;
  x -= Math.floor(x);
  const u = fade(x);
  return lerp(u, grad(p[X], x), grad(p[X+1], x-1));
};

// FBM (Fractional Brownian Motion) - wraps SimplexNoise for multi-octave complexity
fbm = function(simplexInstance, x, y, octaves = 4, persistence = 0.5, lacunarity = 2) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * simplexInstance.noise(x * frequency, y * frequency);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
};

// Turbulence - chaotic swirling effect using absolute values of noise
turbulence = function(simplexInstance, x, y, octaves = 4) {
  let value = 0;
  let amplitude = 1;
  let freqX = x;
  let freqY = y;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * Math.abs(simplexInstance.noise(freqX, freqY));
    freqX *= 2;
    freqY *= 2;
    amplitude *= 0.5;
  }
  return value;
};

// Worley Noise (Cellular Noise) - creates organic cellular patterns
worley = function(x, y, cellCount = 4) {
  const cellX = Math.floor(x * cellCount);
  const cellY = Math.floor(y * cellCount);
  const fracX = x * cellCount - cellX;
  const fracY = y * cellCount - cellY;
  let minDist = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = cellX + dx;
      const ny = cellY + dy;
      // Pseudo-random point in cell using hash function
      const hashX = Math.sin(nx * 73.156 + ny * 94.673) * 43758.5453;
      const hashY = Math.sin(nx * 45.164 + ny * 94.673) * 43758.5453;
      const px = (hashX - Math.floor(hashX)) + dx - fracX;
      const py = (hashY - Math.floor(hashY)) + dy - fracY;
      const dist = Math.sqrt(px * px + py * py);
      if (dist < minDist) minDist = dist;
    }
  }
  return Math.min(1, minDist);
};
