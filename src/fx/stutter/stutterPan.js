/** @this {any} */
stutterPan = function stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
  const channelsArray = pickStutterChannels(channels, ri(1, 2), this.lastUsedCHs2);

  // Write beat-level pan context for spatial-aware octave shifts (task 7)
  if (!this.beatContext) this.beatContext = {};
  this.beatContext.panChannels = new Set(channelsArray);
  this.beatContext.panDirections = {};

  channelsArray.forEach(channelToStutter => {
    const edgeMargin = ri(7, 25);
    const fullRange = 127 - edgeMargin;
    const centerZone = fullRange / 3;
    const leftBoundary = edgeMargin + centerZone;
    const rightBoundary = edgeMargin + 2 * centerZone;

    // Use dramatic noise profile for pan movement (creates interesting flutter)
    const noiseProfile = getNoiseProfile('dramatic');

    let currentPan = edgeMargin;
    let direction = 1;
    let tick;

    for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
      tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);

      // Compute base pan direction
      if (currentPan >= rightBoundary) direction = -1;
      else if (currentPan <= leftBoundary) direction = 1;

      // Apply noise modulation to pan movement
      let basePanDelta = direction * (fullRange / numStutters) * rf(.5, 1.5);
      const mod = getParameterModulation(channelToStutter, 'pan', tick);
      // Y axis controls pan flutter - add oscillation on top of movement
      const flutterAmount = (mod.y - 0.5) * 2 * fullRange * 0.3 * noiseProfile.influenceY;
      basePanDelta += flutterAmount;

      currentPan += basePanDelta;
      currentPan = modClamp(m.floor(currentPan), edgeMargin, 127 - edgeMargin);
      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 10, currentPan] });
    }

    // Record final pan position for note cooperation —
    // negative = left-biased, positive = right-biased, 0 = center
    this.beatContext.panDirections[channelToStutter] = (currentPan - 64) / 64;

    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
  });
};
