/** @this {any} */
stutterPan = function stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
  if (!stutterFailFast) {
    throw new Error('stutterPan: stutterFailFast helper is not available');
  }
  const { eventName } = stutterFailFast.requireEventInfra();
  const { reflectionChannels, bassChannels } = stutterFailFast.requireChannelArrays('stutterPan');
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
    let lastIntensity = 0;

    for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
      tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);

      // Compute base pan direction
      if (currentPan >= rightBoundary) direction = -1;
      else if (currentPan <= leftBoundary) direction = 1;

      // Apply noise modulation to pan movement
      let basePanDelta = direction * (fullRange / numStutters) * rf(.5, 1.5);
      const mod = stutterFailFast.assertModulationXY(getParameterModulation(channelToStutter, 'pan', tick), `stutterPan channel=${channelToStutter} tick=${tick}`);

      // If coherence key exists, overlay correlated modulation
      const coherenceKey = (this.beatContext && this.beatContext.coherenceKey) ? this.beatContext.coherenceKey : null;
      let coh = { x: 0.5, y: 0.5 };
      if (coherenceKey) {
        coh = stutterFailFast.assertModulationXY(getParameterModulation(channelToStutter, coherenceKey, tick), `stutterPan coherence key=${coherenceKey} channel=${channelToStutter}`);
      }

      // Y axis controls pan flutter - add oscillation on top of movement
      const flutterAmount = (mod.y - 0.5) * 2 * fullRange * 0.3 * noiseProfile.influenceY + (coh.y - 0.5) * fullRange * 0.08;
      basePanDelta += flutterAmount;

      currentPan += basePanDelta;
      currentPan = modClamp(m.floor(currentPan), edgeMargin, 127 - edgeMargin);
      if (!Number.isFinite(Number(currentPan))) {
        throw new Error(`stutterPan: computed non-finite currentPan for channel=${channelToStutter} tick=${tick}`);
      }

      // publish modulation bus pan intensity (-1..1 normalized to 0..1 for convenience)
      const norm = (currentPan - 64) / 63; // -1..1
      if (!this.beatContext.mod) this.beatContext.mod = {};
      this.beatContext.mod[channelToStutter] = Object.assign(this.beatContext.mod[channelToStutter] || {}, { pan: clamp(norm, -1, 1) });
      lastIntensity = Math.abs(norm);

      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 10, currentPan] });
    }
    if (tick === undefined) throw new Error('stutterPan: for-loop produced no iterations');

    // Emit one summary event per channel (not per-iteration)
    const profile = stutterFailFast.inferProfile(channelToStutter, reflectionChannels, bassChannels);
    eventBus.emit(eventName, { type: 'cc', subtype: 'pan', profile, channel: channelToStutter, intensity: clamp(lastIntensity, 0, 1), tick });

    // Record final pan position for note cooperation —
    // negative = left-biased, positive = right-biased, 0 = center
    this.beatContext.panDirections[channelToStutter] = (currentPan - 64) / 64;

    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 10, 64] });
  });
};
