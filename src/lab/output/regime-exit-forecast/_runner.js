
// Auto-generated lab runner for sketch: regime-exit-forecast
process.chdir("/tmp/polychron-lab-E8JrZ4");
require("/home/jah/Polychron/src/index");

// Apply config overrides (reassign frozen globals)
const _overrides = {"SECTIONS":{"min":5,"max":5},"PHRASES_PER_SECTION":{"min":3,"max":3}};
for (const [key, val] of Object.entries(_overrides)) {
  if (typeof global[key] !== 'undefined') {
    global[key] = typeof val === 'object' ? Object.freeze(val) : val;
  }
}

// Post-boot hooks
const _postBoot = function postBoot() {
      conductorConfig.setActiveProfile('atmospheric');
      const velocityHistory = [];
      const origEmitPick = playNotesEmitPick;
      playNotesEmitPick = function(opts) {
        const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
        const velocity = snap ? snap.velocity : 0;
        velocityHistory.push(velocity);
        if (velocityHistory.length > 8) velocityHistory.shift();
        // Predict regime exit: rising velocity in coherent = exit coming
        if (velocityHistory.length >= 4) {
          const recent = velocityHistory.slice(-4);
          const slope = (recent[3] - recent[0]) / 3;
          const regime = snap ? snap.regime : 'evolving';
          if (regime === 'coherent' && slope > 0.02) {
            // Coherent exit predicted: anticipatory stutter boost
            const adjusted = Object.assign({}, opts, {
              resolvedStutterProb: clamp((opts.resolvedStutterProb || 0.3) * (1 + slope * 8), 0, 0.95)
            });
            return origEmitPick(adjusted);
          }
          if (regime === 'exploring' && slope < -0.015) {
            // Exploring exit predicted: calming, reduce stutter
            const adjusted = Object.assign({}, opts, {
              resolvedStutterProb: clamp((opts.resolvedStutterProb || 0.3) * (1 - m.abs(slope) * 5), 0.05, 0.95)
            });
            return origEmitPick(adjusted);
          }
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
