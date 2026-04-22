# conductor/dynamics

Dynamic-level signal extraction — energy momentum, climax proximity, density waves, velocity shape, durational contour, dynamic range, peak memory, and macro-arc planning. All modules are **pure query APIs**: they record observations and expose signals, never mutate downstream state.

`dynamicArchitectPlanner` is the only closed-loop controller here. Its tension bias drives the long-range pp→ff arc; the gain and clamp range are owned by the meta-controller layer, not hand-tuned constants in this dir.

## Memoization contract

Every signal getter that may be called more than once per beat must be wrapped in `beatCache.create(...)`. Calling the raw computation function directly from two callers produces duplicate work and incoherent reads within the same beat tick.

## Adding a module

Require from `index.js`; no consumer outside this dir should require a module here directly. Expose a single global (IIFE pattern). If the module drives a feedback loop, declare it in `output/metrics/feedback_graph.json`.

<!-- HME-DIR-INTENT
rules:
  - All modules here are pure query APIs — no writes to conductor or cross-layer state
  - Every getter callable more than once per beat must go through `beatCache.create()`; skip it and reads diverge within a tick
  - Constants in `dynamicArchitectPlanner` (gain, clamp range) are owned by meta-controllers — never hand-tune them here
-->
