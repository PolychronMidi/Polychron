/** @this {any} */
stutterFade = function stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
  if (typeof StutterFailFast === 'undefined' || !StutterFailFast) {
    throw new Error('stutterFade: StutterFailFast helper is not available');
  }
  const { eventName } = StutterFailFast.requireEventInfra();
  const { reflectionChannels, bassChannels } = StutterFailFast.requireChannelArrays('stutterFade');
  const channelsArray = pickStutterChannels(channels, ri(1, 5), this.lastUsedCHs);

  // Write beat-level fade context for note-velocity coherence (task 8)
  const isFadeInGlobal = rf() < 0.5;
  if (!this.beatContext) this.beatContext = {};
  this.beatContext.fadeDirection = isFadeInGlobal ? 'in' : 'out';
  this.beatContext.fadeChannels = new Set(channelsArray);

  // Ensure modulation bus exists for cross-mod sampling by stutterNotes
  if (!this.beatContext.mod) this.beatContext.mod = {};

  // Populate beat-scoped reflection/bass selection sets (up to 2 channels each).
  // These are consulted by `playNotes` so mirrored channels only stutter when selected.
  if (this.beatContext._lastBeatIndex !== beatIndex) {
    this.beatContext._lastBeatIndex = beatIndex;
    this.beatContext.selectedReflectionChannels = new Set();
    this.beatContext.selectedBassChannels = new Set();
    const reflCandidates = reflectionChannels.slice();
    for (const ch of reflCandidates) {
      if (this.beatContext.selectedReflectionChannels.size < 2 && rf() < 0.5) this.beatContext.selectedReflectionChannels.add(ch);
    }
    const bassCandidates = bassChannels.slice();
    for (const ch of bassCandidates) {
      if (this.beatContext.selectedBassChannels.size < 2 && rf() < 0.5) this.beatContext.selectedBassChannels.add(ch);
    }
  }

  channelsArray.forEach(channelToStutter => {
    const maxVol = ri(90, 120);
    const isFadeIn = isFadeInGlobal;

    // Use moderate noise profile for stutter fades (more interesting than subtle)
    const noiseProfile = getNoiseProfile('moderate');

    let tick, volume;

    for (let i = m.floor(numStutters * (rf(1/3, 2/3))); i < numStutters; i++) {
      tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);

      // Compute base fade curve
      let baseVolume;
      if (isFadeIn) {
        baseVolume = m.floor(maxVol * (i / (numStutters - 1)));
      } else {
        baseVolume = m.floor(100 * (1 - (i / (numStutters - 1))));
      }

      // Apply noise modulation to fade curve
      const mod = StutterFailFast.assertModulationXY(getParameterModulation(channelToStutter, 'fade', tick), `stutterFade channel=${channelToStutter} tick=${tick}`);
      // If a plan coherenceKey is present, overlay correlated noise
      const coherenceKey = (this.beatContext && this.beatContext.coherenceKey) ? this.beatContext.coherenceKey : null;
      let coh = { x: 0.5, y: 0.5 };
      if (coherenceKey) {
        coh = StutterFailFast.assertModulationXY(getParameterModulation(channelToStutter, coherenceKey, tick), `stutterFade coherence key=${coherenceKey} channel=${channelToStutter}`);
      }

      // Modulate volume by noise influence (combine local + coherence)
      const noiseVariation = (mod.x - 0.5) * 2 * maxVol * noiseProfile.influenceX + (coh.x - 0.5) * maxVol * 0.25;
      volume = modClamp(m.floor(baseVolume + noiseVariation), 25, maxVol);

      // Publish modulation bus entry for cross-mod sampling (0..1 normalized)
      const norm = clamp(volume / (maxVol || 127), 0, 1);
      if (!this.beatContext.mod) this.beatContext.mod = {};
      this.beatContext.mod[channelToStutter] = Object.assign(this.beatContext.mod[channelToStutter] || {}, { fade: norm });

      // Emit a stutter-applied event for feedback loops (include inferred profile)
      const profile = StutterFailFast.inferProfile(channelToStutter, reflectionChannels, bassChannels);
      EventBus.emit(eventName, { type: 'cc', subtype: 'fade', profile, channel: channelToStutter, intensity: clamp(volume / 127, 0, 1), tick });

      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 7, m.round(volume / rf(1.5, 5))] });
      p(c, { tick: tick + duration * rf(.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume] });
    }
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol] });
  });
};
