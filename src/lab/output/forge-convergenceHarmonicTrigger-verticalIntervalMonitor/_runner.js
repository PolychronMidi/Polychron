
// Auto-generated lab runner for sketch: forge-convergenceHarmonicTrigger-verticalIntervalMonitor
process.chdir("/tmp/polychron-lab-AG81Ax");
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
      // Patch convergenceHarmonicTrigger: densitySurprise boosts event rarity
      // → flows into triggerChance = BASE * (0.5 + rarity*0.5) * ... → more triggers during surprise
      const origOnConvergence = convergenceHarmonicTrigger.onConvergence;
      convergenceHarmonicTrigger.onConvergence = function(event) {
        const rhythmEntry = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
        const ds = rhythmEntry && Number.isFinite(rhythmEntry.densitySurprise) ? rhythmEntry.densitySurprise : 1.0;
        const boostedEvent = (ds !== 1.0)
          ? Object.assign({}, event, { rarity: clamp((event.rarity || 0.5) * clamp(ds, 0.7, 1.5), 0, 1) })
          : event;
        return origOnConvergence.call(this, boostedEvent);
      };

      // Patch verticalIntervalMonitor: densitySurprise tightens collision penalty (antagonist direction)
      // result is negative (penalty), multiplying > 1 makes it more negative → stricter
      const origProcess = verticalIntervalMonitor.process;
      verticalIntervalMonitor.process = function(absoluteSeconds, layer) {
        const result = origProcess.call(this, absoluteSeconds, layer);
        if (result === 0) return 0;
        const rhythmEntry = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
        const ds = rhythmEntry && Number.isFinite(rhythmEntry.densitySurprise) ? rhythmEntry.densitySurprise : 1.0;
        const penaltyScale = ds > 1.1 ? 1.15 : ds < 0.9 ? 0.88 : 1.0;
        return result * penaltyScale;
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
