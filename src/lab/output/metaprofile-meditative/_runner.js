
// Auto-generated lab runner for sketch: metaprofile-meditative
process.chdir("/tmp/polychron-lab-ToUbJO");
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
      metaProfiles.setActive('meditative');
      console.log('Lab: metaprofile=meditative (full run)');
    };
if (typeof _postBoot === 'function') _postBoot();

// Custom main loop or stock
const _mainLoop = null;
if (typeof _mainLoop === 'function') {
  Promise.resolve(_mainLoop()).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
} else {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
