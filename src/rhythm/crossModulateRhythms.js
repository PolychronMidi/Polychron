/**
 * Calculates cross-modulation value based on rhythm state across all levels
 * @returns {void}
 */
crossModulateRhythms = () => {
  lastCrossMod=crossModulation; crossModulation=0;
  crossModulation+=
  (beatRhythm[beatIndex] > 0 ? rf(1.5,3) : m.max(rf(.625,1.25),(1 / numerator) * beatsOff + (1 / numerator) * beatsOn)) +
  (divRhythm[divIndex] > 0 ? rf(1,2) : m.max(rf(.5,1),(1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn )) +
  (subdivRhythm[subdivIndex] > 0 ? rf(.5,1) : m.max(rf(.25,.5),(1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn)) +
  (subsubdivRhythm[subsubdivIndex] > 0 ? rf(.25,.5) : m.max(rf(.125,.25),(1 / subsubsPerSub) * subsubdivsOff + (1 / subsubsPerSub) * subsubdivsOn)) +
  (subsubdivsOn > ri(1,5) ? rf(-.3,-.5) : rf(.1)) + (subsubdivsOff < ri(3) ? rf(-.3,-.5) : rf(.1)) +
  (subdivsOn < ri(7,15) ? rf(.1,.3) : rf(-.1)) + (subdivsOff > ri() ? rf(.1,.3) : rf(-.1)) +
  (divsOn < ri(9,15) ? rf(.1,.3) : rf(-.1)) + (divsOff > ri(3,7) ? rf(.1,.3) : rf(-.1)) +
  (subdivsOn > ri(7,15) ? rf(-.3,-.5) : rf(.1)) + (subdivsOff < ri() ? rf(-.3,-.5) : rf(.1)) +
  (divsOn > ri(9,15) ? rf(-.2,-.4) : rf(.1)) + (divsOff < ri(3,7) ? rf(-.2,-.4) : rf(.1)) +
  (beatsOn > ri(3) ? rf(-.2,-.3) : rf(.1)) + (beatsOff < ri(3) ? rf(-.1,-.3) : rf(.1)) +
  (subdivsPerMinute > ri(400,600) ? rf(-.4,-.6) : rf(.1)) + (subdivsOn * rf(-.05,-.15)) +
  (beatRhythm[beatIndex]<1?rf(.4,.5):0) + (divRhythm[divIndex]<1?rf(.3,.4):0) + (subdivRhythm[subdivIndex]<1?rf(.2,.3):0);
}
