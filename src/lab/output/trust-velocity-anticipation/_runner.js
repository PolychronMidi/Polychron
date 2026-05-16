
// Auto-generated lab runner for sketch: trust-velocity-anticipation
process.chdir("/tmp/polychron-lab-5tMBk1");
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
      let lastMotifTrust = 1.0;
      let lastStutterTrust = 1.0;
      const origEmitPick = playNotesEmitPick;
      playNotesEmitPick = function(opts) {
        const motifTrust = safePreBoot.call(
          () => adaptiveTrustScores.getWeight(trustSystems.names.MOTIF_ECHO), 1.0
        );
        const stutterTrust = safePreBoot.call(
          () => adaptiveTrustScores.getWeight(trustSystems.names.STUTTER_CONTAGION), 1.0
        );
        const mt = Number.isFinite(motifTrust) ? motifTrust : 1.0;
        const st = Number.isFinite(stutterTrust) ? stutterTrust : 1.0;
        const motifVelocity = mt - lastMotifTrust;
        const stutterVelocity = st - lastStutterTrust;
        lastMotifTrust = mt;
        lastStutterTrust = st;
        // Motif trust rising rapidly -> lean into echo-friendly register
        if (motifVelocity > 0.01) {
          const adjusted = Object.assign({}, opts, {
            resolvedRegisterBias: (opts.resolvedRegisterBias || 0) + motifVelocity * 20
          });
          return origEmitPick(adjusted);
        }
        // Stutter trust dropping -> reduce stutter to let it recover
        if (stutterVelocity < -0.01) {
          const adjusted = Object.assign({}, opts, {
            resolvedStutterProb: clamp((opts.resolvedStutterProb || 0.3) * 0.7, 0, 0.95)
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
