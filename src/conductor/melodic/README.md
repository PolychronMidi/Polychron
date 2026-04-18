# conductor/melodic

Melodic signal extraction — pitch trajectory, contour shape, interval balance, register pressure, tessiture, voice-leading efficiency, thematic recall, and perceptual tension. All modules are pure query APIs polled by `globalConductor` and downstream advisors; none emit events or write state.

`perceptualTensionBias` loads last because it synthesizes signals from several other modules in this dir. The load order in `index.js` reflects these dependencies — never reorder without tracing the dependency chain.

No module here should post to L0 or write to `conductorIntelligence` directly. Melodic signals enter the conductor pipeline only through the registered bias pattern.

<!-- HME-DIR-INTENT
rules:
  - All modules are pure query APIs — no L0 posts, no direct conductorIntelligence writes; signals enter via registered bias only
  - perceptualTensionBias loads last; it depends on other modules in this dir being initialized — never move it earlier
-->
