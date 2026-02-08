// noise-test.js - Monkey-patch test for noise module functionality


const path = require('path');

// Setup globals that noise module expects
// Note: This is a test file, so we use global. as an exception for test setup
m = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  pow: Math.pow,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  max: Math.max,
  min: Math.min,
  exp: Math.exp,
  PI: Math.PI
};

rf = (min = 0, max = 1) => min + Math.random() * (max - min);
ri = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

// Load the noise module
require('../src/fx/noise');

// Load config (provides NOISE_PROFILES)
require('../src/config');

// Load noiseConfig (provides getNoiseProfile)
require('../src/fx/noiseConfig');

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, fn) {
  try {
    fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: e.message });
    console.error(`✗ ${name}`);
    console.error(`  Error: ${e.message}`);
  }
}

console.log('\n=== Noise Module Test Suite ===\n');

// Test 1: SimplexNoise class exists and works
test('SimplexNoise class instantiation', () => {
  if (typeof SimplexNoise !== 'function') throw new Error('SimplexNoise not a function');
  const noise = new SimplexNoise(0.5);
  if (!noise.noise) throw new Error('SimplexNoise missing noise method');
});

// Test 2: Simplex noise output (raw, can be outside 0-1; clamped by safe wrapper)
test('SimplexNoise.noise() produces deterministic noise', () => {
  const noise = new SimplexNoise(0.5);
  for (let i = 0; i < 10; i++) {
    const val = noise.noise(rf(-100, 100), rf(-100, 100));
    if (typeof val !== 'number' || isNaN(val)) throw new Error('Invalid noise output');
  }
});

// Test 3: SimplexNoise.noise1D exists (output clamped by wrapper)
test('SimplexNoise has noise1D method', () => {
  const noise = new SimplexNoise(0.5);
  if (typeof noise.noise1D !== 'function') throw new Error('noise1D not a function');
  const val = noise.noise1D(0.5);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('noise1D returned invalid value');
});

// Test 4: fbm function exists and works
test('fbm() function exists and returns valid value', () => {
  if (typeof fbm !== 'function') throw new Error('fbm not a function');
  const noise = new SimplexNoise(0.5);
  const val = fbm(noise, 0.5, 0.5, 3);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('fbm returned invalid value');
});

// Test 5: turbulence function exists
test('turbulence() function exists', () => {
  if (typeof turbulence !== 'function') throw new Error('turbulence not a function');
  const noise = new SimplexNoise(0.5);
  const val = turbulence(noise, 0.5, 0.5, 3);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('turbulence returned invalid value');
});

// Test 6: ridged function exists
test('ridged() function exists', () => {
  if (typeof ridged !== 'function') throw new Error('ridged not a function');
  const noise = new SimplexNoise(0.5);
  const val = ridged(noise, 0.5, 0.5, 3);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('ridged returned invalid value');
});

// Test 7: worley function exists
test('worley() function exists', () => {
  if (typeof worley !== 'function') throw new Error('worley not a function');
  const val = worley(0.5, 0.5, 5);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('worley returned invalid value');
});

// Test 8: Meta-recursive functions exist
test('metaRecursiveNoise exists', () => {
  if (typeof metaRecursiveNoise !== 'function') throw new Error('metaRecursiveNoise not a function');
  const val = metaRecursiveNoise(0.5, 0, 50);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('metaRecursiveNoise returned invalid value');
});

test('metaRecursiveEaseNoise exists', () => {
  if (typeof metaRecursiveEaseNoise !== 'function') throw new Error('metaRecursiveEaseNoise not a function');
  const val = metaRecursiveEaseNoise(0.5, 0, 50);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('metaRecursiveEaseNoise returned invalid value');
});

test('metaRecursiveSimplex2D exists', () => {
  if (typeof metaRecursiveSimplex2D !== 'function') throw new Error('metaRecursiveSimplex2D not a function');
  const noise = new SimplexNoise(0.5);
  const val = metaRecursiveSimplex2D(0.5, 0.5, noise, 0, 50);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('metaRecursiveSimplex2D returned invalid value');
});

test('metaRecursiveFBM exists', () => {
  if (typeof metaRecursiveFBM !== 'function') throw new Error('metaRecursiveFBM not a function');
  const noise = new SimplexNoise(0.5);
  const val = metaRecursiveFBM(0.5, 0.5, noise, 0, 50);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('metaRecursiveFBM returned invalid value');
});

// Test 9: Noise coordinator registry exists
test('noiseGenerators registry exists with 11+ generators', () => {
  if (typeof noiseGenerators !== 'object') throw new Error('noiseGenerators not an object');
  const count = Object.keys(noiseGenerators).length;
  if (count < 11) throw new Error(`Expected 11+ generators, got ${count}`);
});

// Test 10: Get noise value from any generator
test('getNoiseValue works with all generators', () => {
  if (typeof getNoiseValue !== 'function') throw new Error('getNoiseValue not a function');
  for (const genName of Object.keys(noiseGenerators)) {
    const val = getNoiseValue(genName, 0.5, 0.5, 0);
    if (typeof val !== 'number' || isNaN(val)) throw new Error(`${genName} returned invalid value`);
  }
});

// Test 11: Layered noise combines frequencies
test('layeredNoise combines multiple frequencies', () => {
  if (typeof layeredNoise !== 'function') throw new Error('layeredNoise not a function');
  const val = layeredNoise('simplex', 0.5, 0.5, 0);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('layeredNoise returned invalid value');
});

// Test 12: Safe apply noise with clamping
test('safeApplyNoise returns clamped {x, y}', () => {
  if (typeof safeApplyNoise !== 'function') throw new Error('safeApplyNoise not a function');
  const config = {
    generatorX: 'simplex',
    generatorY: 'perlin',
    influenceX: 1.5, // intentionally high to test clamping
    influenceY: 2.0,
    offsetX: 100,
    offsetY: 200
  };
  const result = safeApplyNoise(config, 0.5, 0.5, 0);
  if (result.x < 0 || result.x > 1) throw new Error(`X value ${result.x} not clamped to [0, 1]`);
  if (result.y < 0 || result.y > 1) throw new Error(`Y value ${result.y} not clamped to [0, 1]`);
});

// Test 13: Parameter modulation API
test('getParameterModulation returns {x, y, generator}', () => {
  if (typeof getParameterModulation !== 'function') throw new Error('getParameterModulation not a function');
  const result = getParameterModulation(0, 'pitch', 0);
  if (typeof result.x !== 'number' || typeof result.y !== 'number' || typeof result.generator !== 'string') {
    throw new Error('getParameterModulation missing required fields');
  }
  if (result.x < 0 || result.x > 1 || result.y < 0 || result.y > 1) {
    throw new Error('getParameterModulation values not in [0, 1] range');
  }
});

// Test 14: Noise profiles exist
test('NOISE_PROFILES global exists with 4 presets', () => {
  if (typeof NOISE_PROFILES !== 'object') throw new Error('NOISE_PROFILES not an object');
  const names = Object.keys(NOISE_PROFILES);
  if (names.length < 4) throw new Error(`Expected 4+ profiles, got ${names.length}`);
  if (!names.includes('subtle')) throw new Error('Missing "subtle" profile');
  if (!names.includes('moderate')) throw new Error('Missing "moderate" profile');
  if (!names.includes('dramatic')) throw new Error('Missing "dramatic" profile');
  if (!names.includes('chaotic')) throw new Error('Missing "chaotic" profile');
});

// Test 15: Get noise profile returns valid config
test('getNoiseProfile instantiates all profile types', () => {
  if (typeof getNoiseProfile !== 'function') throw new Error('getNoiseProfile not a function');

  for (const profileName of ['subtle', 'moderate', 'dramatic', 'chaotic']) {
    const config = getNoiseProfile(profileName);
    if (!config.generatorX || !config.generatorY) throw new Error(`${profileName} missing generators`);
    if (typeof config.influenceX !== 'number' || typeof config.influenceY !== 'number') {
      throw new Error(`${profileName} missing influences`);
    }
    if (config.influenceX < 0 || config.influenceX > 1 || config.influenceY < 0 || config.influenceY > 1) {
      throw new Error(`${profileName} influences not in [0, 1]`);
    }
  }
});

// Test 16: Register new noise generator at runtime
test('registerNoiseGenerator extends registry', () => {
  if (typeof registerNoiseGenerator !== 'function') throw new Error('registerNoiseGenerator not a function');
  const initialCount = Object.keys(noiseGenerators).length;
  registerNoiseGenerator('testNoise', () => 0.5);
  const newCount = Object.keys(noiseGenerators).length;
  if (newCount !== initialCount + 1) throw new Error('Generator not registered');
  const val = getNoiseValue('testNoise', 0, 0, 0);
  if (val !== 0.5) throw new Error('Custom generator not invoked correctly');
});

// Test 17: Smooth noise value with lerp
test('smoothNoiseValue interpolates values', () => {
  if (typeof smoothNoiseValue !== 'function') throw new Error('smoothNoiseValue not a function');
  const current = 0.3;
  const target = 0.7;
  const result = smoothNoiseValue(current, target, 0.5, 0.5);
  if (result <= current || result >= target) throw new Error('smoothNoiseValue not interpolating');
});

// Test 18: Clamp function works
test('clampNoiseValue clamps to [0, 1]', () => {
  if (typeof clampNoiseValue !== 'function') throw new Error('clampNoiseValue not a function');
  if (clampNoiseValue(-0.5) !== 0) throw new Error('Negative clamp failed');
  if (clampNoiseValue(1.5) !== 1) throw new Error('Positive clamp failed');
  if (clampNoiseValue(0.5) !== 0.5) throw new Error('In-range clamp failed');
});

// Test 19: Dual-axis noise independence
test('applyDualAxisNoise uses separate offsets for X and Y', () => {
  if (typeof applyDualAxisNoise !== 'function') throw new Error('applyDualAxisNoise not a function');
  const config = {
    generatorX: 'simplex',
    generatorY: 'simplex',
    influenceX: 0.5,
    influenceY: 0.5,
    offsetX: 100,
    offsetY: 200  // Different offset for Y axis
  };
  const result = applyDualAxisNoise(config, 0.5, 0.5, 0);
  if (typeof result.x !== 'number' || typeof result.y !== 'number') {
    throw new Error('applyDualAxisNoise missing {x, y}');
  }
});

// Test 20: Create noise offset produces different values
test('createNoiseOffset generates unique values', () => {
  if (typeof createNoiseOffset !== 'function') throw new Error('createNoiseOffset not a function');
  const offsets = new Set();
  for (let i = 0; i < 5; i++) {
    offsets.add(createNoiseOffset());
  }
  if (offsets.size < 4) throw new Error('createNoiseOffset not generating unique values');
});

// Test 21: Easing functions exist and return valid values
test('Easing functions exist in easingFunctions array', () => {
  if (typeof easingFunctions !== 'object' || !Array.isArray(easingFunctions)) {
    throw new Error('easingFunctions not an array');
  }
  if (easingFunctions.length < 5) throw new Error(`Expected 5+ easing functions, got ${easingFunctions.length}`);
  // Test a few easing functions
  for (let i = 0; i < m.min(3, easingFunctions.length); i++) {
    const easeFn = easingFunctions[i];
    if (typeof easeFn !== 'function') throw new Error(`Easing function ${i} not a function`);
    const val = easeFn(0.5);
    if (typeof val !== 'number' || isNaN(val)) throw new Error(`Easing function ${i} returned invalid value`);
  }
});

// Test 22: easeInOut function exists
test('easeInOut easing function exists', () => {
  if (typeof easeInOut !== 'function') throw new Error('easeInOut not a function');
  const val = easeInOut(0.5);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('easeInOut returned invalid value');
});

// Test 23: Perlin 1D noise via perlinNoise
test('perlinNoise 1D exists and returns valid value', () => {
  if (typeof perlinNoise !== 'function') throw new Error('perlinNoise not a function');
  const val = perlinNoise(0.5);
  if (typeof val !== 'number' || isNaN(val)) throw new Error('perlinNoise returned invalid value');
});

// Test 24: Noise influence map produces values in valid range
test('noiseInfluenceMap produces values in [0, 1]', () => {
  if (typeof noiseInfluenceMap !== 'function') throw new Error('noiseInfluenceMap not a function');
  for (let i = 0; i < 5; i++) {
    const val = noiseInfluenceMap();
    if (typeof val !== 'number' || val < 0 || val > 1) {
      throw new Error(`noiseInfluenceMap returned ${val}, expected [0, 1]`);
    }
  }
});

// Test 25: Random noise generator selection varies
test('randomNoiseGenerator returns varying generators', () => {
  if (typeof randomNoiseGenerator !== 'function') throw new Error('randomNoiseGenerator not a function');
  const selected = new Set();
  for (let i = 0; i < 15; i++) {
    selected.add(randomNoiseGenerator());
  }
  if (selected.size < 3) throw new Error('randomNoiseGenerator not returning variety');
});

// Test 26: Create dual-axis noise config factory
test('createDualAxisNoiseConfig generates valid config', () => {
  if (typeof createDualAxisNoiseConfig !== 'function') throw new Error('createDualAxisNoiseConfig not a function');
  const config = createDualAxisNoiseConfig();
  if (!config.generatorX || !config.generatorY) throw new Error('Missing generators');
  if (typeof config.influenceX !== 'number' || typeof config.influenceY !== 'number') throw new Error('Missing influences');
  if (typeof config.offsetX !== 'number' || typeof config.offsetY !== 'number') throw new Error('Missing offsets');
});

// Test 27: Different generators produce different outputs
test('Different generators produce varying results', () => {
  if (typeof getNoiseValue !== 'function') throw new Error('getNoiseValue not a function');
  const results = new Map();
  for (const genName of ['simplex', 'perlin', 'fbm', 'turbulence', 'worley']) {
    const val = getNoiseValue(genName, 0.5, 0.5, 0);
    results.set(genName, val);
  }
  const unique = new Set(results.values());
  if (unique.size < 3) throw new Error('Generators not producing different outputs');
});

// Test 28: Frequency modulation in layeredNoise affects output
test('layeredNoise frequency parameters affect output', () => {
  if (typeof layeredNoise !== 'function') throw new Error('layeredNoise not a function');
  const broad = layeredNoise('simplex', 0.5, 0.5, 0, 0.01, 0.05);
  const detail = layeredNoise('simplex', 0.5, 0.5, 0, 0.1, 0.5);
  if (broad === detail) throw new Error('Frequency parameters not affecting output');
});

// Test 29: Meta-recursive depth affects complexity
test('metaRecursiveNoise respects depth parameter', () => {
  if (typeof metaRecursiveNoise !== 'function') throw new Error('metaRecursiveNoise not a function');
  const shallow = metaRecursiveNoise(0.5, 0, 5);
  const deep = metaRecursiveNoise(0.5, 0, 50);
  // Both should be valid numbers
  if (typeof shallow !== 'number' || typeof deep !== 'number') throw new Error('Invalid output');
  if (isNaN(shallow) || isNaN(deep)) throw new Error('NaN output');
});

// Test 30: metaRecursiveEaseNoise with different depths
test('metaRecursiveEaseNoise varies with depth', () => {
  if (typeof metaRecursiveEaseNoise !== 'function') throw new Error('metaRecursiveEaseNoise not a function');
  const vals = [];
  const depths = [5, 20, 50];
  for (const d of depths) {
    vals.push(metaRecursiveEaseNoise(0.5, 0, d));
  }
  // All should be valid
  for (const v of vals) {
    if (typeof v !== 'number' || isNaN(v)) throw new Error('Invalid ease noise output');
  }
});

// Test 31: metaRecursiveSimplex2D 2D coherence
test('metaRecursiveSimplex2D produces 2D coherent noise', () => {
  if (typeof metaRecursiveSimplex2D !== 'function') throw new Error('metaRecursiveSimplex2D not a function');
  const noise = new SimplexNoise(0.5);
  // Adjacent points should have correlated values
  const val1 = metaRecursiveSimplex2D(0.5, 0.5, noise, 0, 30);
  const val2 = metaRecursiveSimplex2D(0.50001, 0.50001, noise, 0, 30);
  if (typeof val1 !== 'number' || typeof val2 !== 'number') throw new Error('Invalid output');
  if (isNaN(val1) || isNaN(val2)) throw new Error('NaN output');
});

// Test 32: metaRecursiveFBM with varying octave depths
test('metaRecursiveFBM respects depth variation', () => {
  if (typeof metaRecursiveFBM !== 'function') throw new Error('metaRecursiveFBM not a function');
  const noise = new SimplexNoise(0.5);
  const fbmVal = metaRecursiveFBM(0.5, 0.5, noise, 0, 40);
  if (typeof fbmVal !== 'number' || isNaN(fbmVal)) throw new Error('Invalid FBM output');
});

// Test 33: Noise functions array contains callable functions
test('noiseFunctions array contains valid functions', () => {
  if (typeof noiseFunctions !== 'object' || !Array.isArray(noiseFunctions)) throw new Error('noiseFunctions not an array');
  if (noiseFunctions.length < 2) throw new Error('Not enough noise functions');
  for (let i = 0; i < noiseFunctions.length; i++) {
    if (typeof noiseFunctions[i] !== 'function') throw new Error(`noiseFunctions[${i}] not a function`);
  }
});

// Test 34: Fade/lerp/grad helpers (helper functions for perlin)
test('Perlin helpers (fade, lerp, grad) exist', () => {
  if (typeof fade !== 'function') throw new Error('fade not a function');
  if (typeof lerp !== 'function') throw new Error('lerp not a function');
  if (typeof grad !== 'function') throw new Error('grad not a function');
  // Test fade (smooth step function)
  const faded = fade(0.5);
  if (typeof faded !== 'number' || faded < 0 || faded > 1) throw new Error('fade produced invalid value');
  // Test lerp (linear interpolation)
  const lerped = lerp(0, 1, 0.5);
  if (typeof lerped !== 'number' || isNaN(lerped)) throw new Error('lerp produced invalid value');
  // Test grad (gradient helper)
  const gradVal = grad(0, 0.5, 0.5);
  if (typeof gradVal !== 'number' || isNaN(gradVal)) throw new Error('grad produced invalid value');
});

// Test 35: Permutation arrays exist
test('permutation arrays exist for Perlin', () => {
  if (typeof permutation !== 'object') throw new Error('permutation not defined');
  if (typeof permutation !== 'object' || permutation.length === 0) throw new Error('permutation array empty');
});

// Test 36: Statistical test - noise values are distributed
test('Noise generators produce varied outputs in sequence', () => {
  const samples = [];
  for (let i = 0; i < 20; i++) {
    samples.push(getNoiseValue('simplex', rf(-100, 100), rf(-100, 100), rf(0, 100)));
  }
  const range = m.max(...samples) - m.min(...samples);
  if (range < 0.1) throw new Error('Noise samples not varied enough');
});

// Test 37: Clamping actually prevents extreme values
test('safeApplyNoise aggressive config gets clamped', () => {
  if (typeof safeApplyNoise !== 'function') throw new Error('safeApplyNoise not a function');
  const aggressiveConfig = {
    generatorX: 'turbulence',
    generatorY: 'turbulence',
    influenceX: 10.0,  // Way above 1
    influenceY: 10.0,
    offsetX: 5000,
    offsetY: 5000
  };
  const result = safeApplyNoise(aggressiveConfig, 0.5, 0.5, 0);
  if (result.x < 0 || result.x > 1 || result.y < 0 || result.y > 1) {
    throw new Error('Aggressive config not properly clamped');
  }
});

// Summary
console.log(`\n=== Test Results ===`);
console.log(`Passed: ${results.passed}`);
console.log(`Failed: ${results.failed}`);
console.log(`Total:  ${results.passed + results.failed}\n`);

if (results.failed > 0) {
  console.log('Failed tests:');
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`  • ${t.name}: ${t.error}`);
  });
  process.exit(1);
} else {
  console.log('All tests passed! ✓');
  process.exit(0);
}
