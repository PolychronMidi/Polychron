/** @this {any} */
stutterFade = function stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
  const eventName = (typeof EventCatalog !== 'undefined' && EventCatalog && EventCatalog.names)
    ? EventCatalog.names.STUTTER_APPLIED
    : 'stutter-applied';
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
    try {
      const reflCandidates = (typeof reflection !== 'undefined' && Array.isArray(reflection)) ? reflection.slice() : [];
      for (const ch of reflCandidates) {
        if (this.beatContext.selectedReflectionChannels.size < 2 && rf() < 0.5) this.beatContext.selectedReflectionChannels.add(ch);
      }
    } catch { /* ignore */ }
    try {
      const bassCandidates = (typeof bass !== 'undefined' && Array.isArray(bass)) ? bass.slice() : [];
      for (const ch of bassCandidates) {
        if (this.beatContext.selectedBassChannels.size < 2 && rf() < 0.5) this.beatContext.selectedBassChannels.add(ch);
      }
    } catch { /* ignore */ }
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
      const mod = getParameterModulation(channelToStutter, 'fade', tick);
      // If a plan coherenceKey is present, overlay correlated noise
      const coherenceKey = (this.beatContext && this.beatContext.coherenceKey) ? this.beatContext.coherenceKey : null;
      let coh = { x: 0.5, y: 0.5 };
      if (coherenceKey) {
        try { coh = getParameterModulation(channelToStutter, coherenceKey, tick); } catch { coh = { x: 0.5, y: 0.5 }; }
      }

      // Modulate volume by noise influence (combine local + coherence)
      const noiseVariation = (mod.x - 0.5) * 2 * maxVol * noiseProfile.influenceX + (coh.x - 0.5) * maxVol * 0.25;
      volume = modClamp(m.floor(baseVolume + noiseVariation), 25, maxVol);

      // Publish modulation bus entry for cross-mod sampling (0..1 normalized)
      try {
        const norm = clamp(volume / (maxVol || 127), 0, 1);
        if (!this.beatContext.mod) this.beatContext.mod = {};
        this.beatContext.mod[channelToStutter] = Object.assign(this.beatContext.mod[channelToStutter] || {}, { fade: norm });
      } catch { /* ignore */ }

      // Emit a stutter-applied event for feedback loops (include inferred profile)
      try {
        const profile = (typeof reflection !== 'undefined' && reflection.includes(channelToStutter)) ? 'reflection' : (typeof bass !== 'undefined' && bass.includes(channelToStutter)) ? 'bass' : 'source';
        if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') EventBus.emit(eventName, { type: 'cc', subtype: 'fade', profile, channel: channelToStutter, intensity: clamp(volume / 127, 0, 1), tick });
      } catch { /* ignore */ }

      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 7, m.round(volume / rf(1.5, 5))] });
      p(c, { tick: tick + duration * rf(.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume] });
    }
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol] });
  });
};
