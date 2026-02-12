// SimplexNoise.js - Simplex noise implementation with supporting noise functions

// Simplex noise constants
const F2 = 0.5 * (m.sqrt(3) - 1);
const G2 = (3 - m.sqrt(3)) / 6;
const grad3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];

SimplexNoise = class {
  constructor(seed = rf()) {
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      this.p[i] = m.floor(seed * 256);
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

  noise1D(xin) {
    return this.noise(xin, xin);
  }

  noise(xin, yin) {
    let n0, n1, n2;
    let s = (xin + yin) * F2;
    let i = m.floor(xin + s);
    let j = m.floor(yin + s);
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
    value += amplitude * m.abs(simplexInstance.noise(freqX, freqY));
    freqX *= 2;
    freqY *= 2;
    amplitude *= 0.5;
  }
  return value;
};

// Ridged Multifractal - sharp ridges for terrain/dramatic effects
ridged = function(simplexInstance, x, y, octaves = 4, persistence = 0.5, lacunarity = 2) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    const sample = 1 - m.abs(simplexInstance.noise(x * frequency, y * frequency));
    value += amplitude * sample * sample;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
};

// Worley Noise (Cellular Noise) - creates organic cellular patterns
worley = function(x, y, cellCount = 4) {
  const cellX = m.floor(x * cellCount);
  const cellY = m.floor(y * cellCount);
  const fracX = x * cellCount - cellX;
  const fracY = y * cellCount - cellY;
  let minDist = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = cellX + dx;
      const ny = cellY + dy;
      // Pseudo-random point in cell using hash function
      const hashX = m.sin(nx * 73.156 + ny * 94.673) * 43758.5453;
      const hashY = m.sin(nx * 45.164 + ny * 94.673) * 43758.5453;
      const px = (hashX - m.floor(hashX)) + dx - fracX;
      const py = (hashY - m.floor(hashY)) + dy - fracY;
      const dist = m.sqrt(px * px + py * py);
      if (dist < minDist) minDist = dist;
    }
  }
  return m.min(1, minDist);
};
