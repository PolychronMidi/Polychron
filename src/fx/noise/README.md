# fx/noise

Simplex-noise-based parameter modulation — velocity and pan variation driven by noise profiles. `noiseManager` is the bridge to audio parameters: `applyNoiseToVelocity()` and `applyNoiseToPan()` are the only entry points for noise-derived modulation.

Pan range comes from `conductorConfig.getNoiseCanvasParams()` — never hardcode a pan range in a noise module. Velocity and pan outputs are clamped to valid MIDI ranges [0–127] inside `noiseManager`; callers must not re-clamp.

`SimplexNoise.js` is vendored — do not modify it. `metaRecursive.js` loads first because it provides the recursive noise layer used by the registry generators.

<!-- HME-DIR-INTENT
rules:
  - Pan range comes from conductorConfig.getNoiseCanvasParams() — never hardcode it in a noise module
  - SimplexNoise.js is vendored — do not modify; metaRecursive.js must load before noiseRegistry (load order in index.js is a dependency)
-->
