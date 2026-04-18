# fx/stutter/variants

The 20 stutter variant implementations. Each self-registers into `stutterRegistry` at load time via the pattern at the bottom of its IIFE. `index.js` is a pure loader — it requires all variants in order, no other logic.

Never call a variant function directly. Dispatch always goes through `StutterManager` (parent dir) so plan scheduling, channel tracking, last-used-channels deduplication, and metric recording stay coherent. A direct call skips all of that and produces untracked audio events.

Adding a variant: write the file, self-register at the bottom, add a `require` to `index.js`. No other wiring needed.

<!-- HME-DIR-INTENT
rules:
  - Never call variant functions directly — dispatch through StutterManager only; direct calls skip plan scheduling and channel tracking
  - Self-register at file load; add require to index.js — no other wiring needed
-->
