/** @this {any} */
stutterFX = function stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
  if (typeof StutterFailFast === 'undefined' || !StutterFailFast) {
    throw new Error('stutterFX: StutterFailFast helper is not available');
  }
  const { eventName } = StutterFailFast.requireEventInfra();
  const { reflectionChannels, bassChannels } = StutterFailFast.requireChannelArrays('stutterFX');
  const channelsArray = pickStutterChannels(channels, ri(1, 2), this.lastUsedCHs3);

  channelsArray.forEach(channelToStutter => {
    const startValue = ri(0, MIDI_MAX_VALUE);
    const endValue = ri(0, MIDI_MAX_VALUE);
    const ccParam = ra([91, 92, 93, 71, 74]);

    // Use moderate noise for FX curves — aligns with fade's organic treatment
    const noiseProfile = getNoiseProfile('moderate');
    let tick;

    for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
      tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
      const progress = i / (numStutters - 1);
      const baseValue = startValue + (endValue - startValue) * progress;

      // Noise-modulate the FX curve — X axis warps the ramp, Y axis adds flutter
      const mod = StutterFailFast.assertModulationXY(getParameterModulation(channelToStutter, 'fx', tick), `stutterFX channel=${channelToStutter} tick=${tick}`);

      // If a coherence key exists, overlay correlated noise
      const coherenceKey = (this.beatContext && this.beatContext.coherenceKey) ? this.beatContext.coherenceKey : null;
      let coh = { x: 0.5, y: 0.5 };
      if (coherenceKey) {
        coh = StutterFailFast.assertModulationXY(getParameterModulation(channelToStutter, coherenceKey, tick), `stutterFX coherence key=${coherenceKey} channel=${channelToStutter}`);
      }

      const rampWarp = (mod.x - 0.5) * 2 * 40 * noiseProfile.influenceX + (coh.x - 0.5) * 10;
      const flutter = (mod.y - 0.5) * 2 * 20 * noiseProfile.influenceY + (coh.y - 0.5) * 6;
      const currentValue = modClamp(m.floor(baseValue + rampWarp + flutter), 0, MIDI_MAX_VALUE);

      // publish modulation bus entry for cross‑mod sampling
      const norm = clamp(currentValue / MIDI_MAX_VALUE, 0, 1);
      if (!this.beatContext.mod) this.beatContext.mod = {};
      this.beatContext.mod[channelToStutter] = Object.assign(this.beatContext.mod[channelToStutter] || {}, { fx: norm });

      // feedback event (include inferred profile)
      const profile = StutterFailFast.inferProfile(channelToStutter, reflectionChannels, bassChannels);
      EventBus.emit(eventName, { type: 'cc', subtype: 'fx', profile, channel: channelToStutter, intensity: clamp(currentValue / MIDI_MAX_VALUE, 0, 1), tick });

      // Map raw `currentValue` into the hub FX ranges for this channel/CC
      const mapToFxRange = (ch, cc, raw) => {
        const group = reflectionChannels.includes(ch) ? 'reflection' : bassChannels.includes(ch) ? 'bass' : 'source';
        let def = null;
        if (typeof FX_CC_DEFAULTS !== 'undefined' && FX_CC_DEFAULTS) {
          if (FX_CC_DEFAULTS[group] && FX_CC_DEFAULTS[group][cc]) def = FX_CC_DEFAULTS[group][cc];
          else if (FX_CC_DEFAULTS[cc]) def = FX_CC_DEFAULTS[cc];
        }
        if (def && Number.isFinite(Number(def.min)) && Number.isFinite(Number(def.max))) {
          return m.round(def.min + (def.max - def.min) * clamp(raw / 127, 0, 1));
        }
        return clamp(raw, 0, 127);
      };

      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, mapToFxRange(channelToStutter, ccParam, currentValue)] });
    }
    if (tick === undefined) throw new Error('stutterFX: for-loop produced no iterations');
    // restore to mid-point of configured range (falls back to 64)
    const defaultReset = (ch, cc) => {
      let def = null;
      if (typeof FX_CC_DEFAULTS !== 'undefined' && FX_CC_DEFAULTS) {
        const group = reflectionChannels.includes(ch) ? 'reflection' : bassChannels.includes(ch) ? 'bass' : 'source';
        if (FX_CC_DEFAULTS[group] && FX_CC_DEFAULTS[group][cc]) def = FX_CC_DEFAULTS[group][cc];
        else if (FX_CC_DEFAULTS[cc]) def = FX_CC_DEFAULTS[cc];
      }
      if (def && Number.isFinite(Number(def.min)) && Number.isFinite(Number(def.max))) return m.round((Number(def.min) + Number(def.max)) / 2);
      return 64;
    };
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, defaultReset(channelToStutter, ccParam)] });
  });
};
