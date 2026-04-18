# conductor/harmonic

Harmonic signal extraction — tonality, chord function, chromatic saturation, consonance/dissonance, pedal fields, surprise index, cadence detection, and pitch gravity. All modules are pure query APIs; none write conductor or cross-layer state.

`harmonicFunctionGraph` is the only module here that emits to an L0 channel (`harmonicFunction`). If you add a new module that needs to publish harmonic state downstream, route it through `harmonicFunctionGraph` or declare a new channel in `l0Channels.js` — never post to L0 ad-hoc with a bare string.

`harmonicFunctionGraph` loads last in `index.js` because it depends on all the trackers being initialized. Never reorder it above its dependencies.

<!-- HME-DIR-INTENT
rules:
  - All modules are pure query APIs — no writes to conductor or cross-layer state from anything in this dir
  - Only harmonicFunctionGraph posts to L0; new downstream harmonic signals need a declared channel, not bare L0 strings
-->
