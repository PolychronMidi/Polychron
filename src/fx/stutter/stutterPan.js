stutterPan = function stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
  const CHsToStutter = ri(1, 2);
  const channelsToStutter = new Set();
  const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));

  while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
    const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
    channelsToStutter.add(ch);
    availableCHs.splice(availableCHs.indexOf(ch), 1);
  }

  if (channelsToStutter.size < CHsToStutter) {
    if (this && this.lastUsedCHs2 && typeof (/** @type {any} */ (this.lastUsedCHs2)).clear === 'function') (/** @type {any} */ (this.lastUsedCHs2)).clear();
  } else {
    this.lastUsedCHs2 = new Set(channelsToStutter);
  }

  const channelsArray = Array.from(channelsToStutter);
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
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
  });
};
