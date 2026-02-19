// src/rhythm/drumMap.js - central drum map with local fallback
const LOCAL_DRUM_MAP = {
  snare1: { note: 31, velocityRange: [99, 111] },
  snare2: { note: 33, velocityRange: [99, 111] },
  snare3: { note: 124, velocityRange: [77, 88] },
  snare4: { note: 125, velocityRange: [77, 88] },
  snare5: { note: 75, velocityRange: [77, 88] },
  snare6: { note: 85, velocityRange: [77, 88] },
  snare7: { note: 118, velocityRange: [66, 77] },
  snare8: { note: 41, velocityRange: [66, 77] },
  kick1: { note: 12, velocityRange: [111, 127] },
  kick2: { note: 14, velocityRange: [111, 127] },
  kick3: { note: 0, velocityRange: [99, 111] },
  kick4: { note: 2, velocityRange: [99, 111] },
  kick5: { note: 4, velocityRange: [88, 99] },
  kick6: { note: 5, velocityRange: [88, 99] },
  kick7: { note: 6, velocityRange: [88, 99] },
  cymbal1: { note: 59, velocityRange: [66, 77] },
  cymbal2: { note: 53, velocityRange: [66, 77] },
  cymbal3: { note: 80, velocityRange: [66, 77] },
  cymbal4: { note: 81, velocityRange: [66, 77] },
  conga1: { note: 60, velocityRange: [66, 77] },
  conga2: { note: 61, velocityRange: [66, 77] },
  conga3: { note: 62, velocityRange: [66, 77] },
  conga4: { note: 63, velocityRange: [66, 77] },
  conga5: { note: 64, velocityRange: [66, 77] }
};

drumMap = {};
Object.assign(drumMap, LOCAL_DRUM_MAP);
if (typeof DRUM_MAP !== 'undefined' && DRUM_MAP && typeof DRUM_MAP === 'object') {
  Object.assign(drumMap, DRUM_MAP);
}
