
// Auto-generated lab runner for sketch: dimensionality-response
process.chdir("/tmp/polychron-lab-nCnD2E");
require("/home/jah/Polychron/src/index");

// Apply config overrides (reassign frozen globals)
const _overrides = {"SECTIONS":{"min":4,"max":4},"PHRASES_PER_SECTION":{"min":3,"max":3}};
for (const [key, val] of Object.entries(_overrides)) {
  if (typeof global[key] !== 'undefined') {
    global[key] = typeof val === 'object' ? Object.freeze(val) : val;
  }
}

// Post-boot hooks
const _postBoot = function postBoot() {
      conductorConfig.setActiveProfile('atmospheric');
      const origEmitPick = playNotesEmitPick;
      playNotesEmitPick = function(opts) {
        const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
        const effDim = snap ? snap.effectiveDimensionality : 3;
        if (effDim < 2.5) {
          // Collapsed dimensionality: widen palette
          const collapseDepth = clamp((2.5 - effDim) / 1.5, 0, 1);
          const adjusted = Object.assign({}, opts, {
            resolvedRegisterBias: (opts.resolvedRegisterBias || 0) + collapseDepth * 4,
            resolvedVelocity: m.max(30, m.round((opts.resolvedVelocity || 80) * (1 + collapseDepth * 0.15)))
          });
          return origEmitPick(adjusted);
        }
        if (effDim > 4.0) {
          // High dimensionality: focus expression
          const focusDepth = clamp((effDim - 4.0) / 2.0, 0, 1);
          const adjusted = Object.assign({}, opts, {
            resolvedRegisterBias: (opts.resolvedRegisterBias || 0) - focusDepth * 2
          });
          return origEmitPick(adjusted);
        }
        return origEmitPick(opts);
      };
    };
if (typeof _postBoot === 'function') _postBoot();

// Custom main loop or stock
const _mainLoop = null;
if (typeof _mainLoop === 'function') {
  Promise.resolve(_mainLoop()).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
} else {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
