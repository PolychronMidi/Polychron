
// Auto-generated lab runner for sketch: metaprofile-atmospheric-to-chaotic
process.chdir("/tmp/polychron-lab-qwQBj9");
require("/home/jah/Polychron/src/index");

// Apply config overrides (reassign frozen globals)
const _overrides = {"SECTIONS":{"min":6,"max":6},"PHRASES_PER_SECTION":{"min":3,"max":3}};
for (const [key, val] of Object.entries(_overrides)) {
  if (typeof global[key] !== 'undefined') {
    global[key] = typeof val === 'object' ? Object.freeze(val) : val;
  }
}

// Post-boot hooks
const _postBoot = function postBoot() {
      metaProfiles.setActive('atmospheric');
      console.log('Lab: metaprofile=atmospheric (sections 0-2), chaotic (sections 3-5)');

      const origApply = conductorConfig.applyPhaseProfile;
      conductorConfig.applyPhaseProfile = function(opts) {
        if (sectionIndex === 3) {
          metaProfiles.setActive('chaotic');
          console.log('Lab: PIVOT → metaprofile=chaotic at section 3');
        }
        return origApply.call(conductorConfig, opts);
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
