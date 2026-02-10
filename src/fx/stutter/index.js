// src/fx/stutter/index.js - central entry for stutter system
// @ts-ignore: load side-effect module with globals
require('./StutterConfigStore');
// @ts-ignore: load side-effect module with globals
require('./StutterMetrics');
// @ts-ignore: load side-effect module with globals
require('./StutterRegistry');
// @ts-ignore: load side-effect module with globals
require('./stutterConfig');
// @ts-ignore: load side-effect module with globals
require('./stutterNotes');
// @ts-ignore: load side-effect module with globals
require('./StutterAsNoteSource');
// @ts-ignore: load side-effect module with globals
require('./stutterNoteSourceScheduler');
// @ts-ignore: load side-effect module with globals
require('./stutterFade');
// @ts-ignore: load side-effect module with globals
require('./stutterPan');
// @ts-ignore: load side-effect module with globals
require('./stutterFX');

// Ensure the helper is registered with StutterConfig (defensive explicit registration)
try {
  // @ts-ignore: runtime-only naked global registration
  if (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.registerHelper === 'function' && typeof stutterNotes === 'function') {
    // @ts-ignore: runtime-only naked global registration
    StutterConfig.registerHelper(stutterNotes);
  }
} catch (e) { /* ignore */ }

// @ts-ignore: load side-effect module with globals
require('./StutterManager');
