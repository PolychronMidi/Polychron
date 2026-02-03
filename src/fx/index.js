// src/fx/index.js - central entry for fx helpers and manager
require('./stutterFade');
require('./stutterPan');
require('./stutterFX');
require('./resetChannelTracking');
require('./setBinaural');
require('./setBalanceAndFX');
require('./stutterManager');

// Expose lightweight naked wrappers that delegate to the StutterManager instance
stutterFade = function stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
  try { if (typeof Stutter !== 'undefined' && Stutter && typeof stutterFade === 'function') return stutterFade(channels, numStutters, duration); } catch (e) { /* swallow */ }
};

stutterPan = function stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
  try { if (typeof Stutter !== 'undefined' && Stutter && typeof stutterPan === 'function') return stutterPan(channels, numStutters, duration); } catch (e) { /* swallow */ }
};

stutterFX = function stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
  try { if (typeof Stutter !== 'undefined' && Stutter && typeof stutterFX === 'function') return stutterFX(channels, numStutters, duration); } catch (e) { /* swallow */ }
};
