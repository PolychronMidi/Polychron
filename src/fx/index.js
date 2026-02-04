// src/fx/index.js - central entry for fx helpers and manager
// @ts-ignore: load side-effect module with globals
require('./stutterFade');
// @ts-ignore: load side-effect module with globals
require('./stutterPan');
// @ts-ignore: load side-effect module with globals
require('./stutterFX');
// @ts-ignore: load side-effect module with globals
require('./setBinaural');
// @ts-ignore: load side-effect module with globals
require('./setBalanceAndFX');
// @ts-ignore: load side-effect module with globals
require('./stutterConfig');
// Register the original helper early so any scheduling that runs after fx load can find it
// @ts-ignore: load side-effect module with globals
require('./stutterNotes');
// Ensure the original helper is registered with StutterConfig (defensive explicit registration)
try {
  // @ts-ignore: runtime-only naked global registration
  if (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.registerOriginalHelper === 'function' && typeof stutterNotes === 'function') {
    // @ts-ignore: runtime-only naked global registration
    StutterConfig.registerOriginalHelper(stutterNotes);
  }
} catch (e) { /* ignore */ }
// Ensure generic note-cascade helper is available for scheduling
// @ts-ignore: load side-effect module with globals
require('../noteCascade');
// @ts-ignore: load side-effect module with globals
require('./StutterManager');
