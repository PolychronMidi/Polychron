function trackBeatRhythm() {
  if (beatRhythm[beatIndex] > 0) { beatsOn++; beatsOff = 0; } else { beatsOn = 0; beatsOff++; }
}

function trackDivRhythm() {
  if (divRhythm[divIndex] > 0) { divsOn++; divsOff = 0; } else { divsOn = 0; divsOff++; }
}

function trackSubdivRhythm() {
  if (subdivRhythm[subdivIndex] > 0) { subdivsOn++; subdivsOff = 0; } else { subdivsOn = 0; subdivsOff++; }
}

function trackSubsubdivRhythm() {
  if (subsubdivRhythm[subsubdivIndex] > 0) { subsubdivsOn++; subsubdivsOff = 0; } else { subsubdivsOn = 0; subsubdivsOff++; }
}

module.exports = {
  trackBeatRhythm,
  trackDivRhythm,
  trackSubdivRhythm,
  trackSubsubdivRhythm
};
