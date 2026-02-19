/** @this {any} */
stutterFX = function stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
  if (typeof EventCatalog === 'undefined' || !EventCatalog || !EventCatalog.names) {
    throw new Error('stutterFX: EventCatalog.names is not available');
  }
  if (typeof EventBus === 'undefined' || !EventBus || typeof EventBus.emit !== 'function') {
    throw new Error('stutterFX: EventBus.emit is not available');
  }
  if (typeof reflection === 'undefined' || !Array.isArray(reflection) || typeof bass === 'undefined' || !Array.isArray(bass)) {
    throw new Error('stutterFX: reflection and bass channel arrays must be defined');
  }
  const eventName = EventCatalog.names.STUTTER_APPLIED;
  const channelsArray = pickStutterChannels(channels, ri(1, 2), this.lastUsedCHs3);

  channelsArray.forEach(channelToStutter => {
    const startValue = ri(0, 127);
    const endValue = ri(0, 127);
    const ccParam = ra([91, 92, 93, 71, 74]);

    // Use moderate noise for FX curves — aligns with fade's organic treatment
    const noiseProfile = getNoiseProfile('moderate');
    let tick;

    for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
      tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
      const progress = i / (numStutters - 1);
      const baseValue = startValue + (endValue - startValue) * progress;

      // Noise-modulate the FX curve — X axis warps the ramp, Y axis adds flutter
      const mod = getParameterModulation(channelToStutter, 'fx', tick);
      if (!mod || !Number.isFinite(Number(mod.x)) || !Number.isFinite(Number(mod.y))) {
        throw new Error(`stutterFX: invalid fx modulation for channel=${channelToStutter} tick=${tick}`);
      }

      // If a coherence key exists, overlay correlated noise
      const coherenceKey = (this.beatContext && this.beatContext.coherenceKey) ? this.beatContext.coherenceKey : null;
      let coh = { x: 0.5, y: 0.5 };
      if (coherenceKey) {
        coh = getParameterModulation(channelToStutter, coherenceKey, tick);
        if (!coh || !Number.isFinite(Number(coh.x)) || !Number.isFinite(Number(coh.y))) {
          throw new Error(`stutterFX: invalid coherence modulation for key="${coherenceKey}" channel=${channelToStutter}`);
        }
      }

      const rampWarp = (mod.x - 0.5) * 2 * 40 * noiseProfile.influenceX + (coh.x - 0.5) * 10;
      const flutter = (mod.y - 0.5) * 2 * 20 * noiseProfile.influenceY + (coh.y - 0.5) * 6;
      const currentValue = modClamp(m.floor(baseValue + rampWarp + flutter), 0, 127);

      // publish modulation bus entry for cross‑mod sampling
      const norm = clamp(currentValue / 127, 0, 1);
      if (!this.beatContext.mod) this.beatContext.mod = {};
      this.beatContext.mod[channelToStutter] = Object.assign(this.beatContext.mod[channelToStutter] || {}, { fx: norm });

      // feedback event (include inferred profile)
      const profile = reflection.includes(channelToStutter) ? 'reflection' : bass.includes(channelToStutter) ? 'bass' : 'source';
      EventBus.emit(eventName, { type: 'cc', subtype: 'fx', profile, channel: channelToStutter, intensity: clamp(currentValue / 127, 0, 1), tick });

      // Map raw `currentValue` into the hub FX ranges for this channel/CC
      const mapToFxRange = (ch, cc, raw) => {
        const group = reflection.includes(ch) ? 'reflection' : bass.includes(ch) ? 'bass' : 'source';
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
    // restore to mid-point of configured range (falls back to 64)
    const defaultReset = (ch, cc) => {
      let def = null;
      if (typeof FX_CC_DEFAULTS !== 'undefined' && FX_CC_DEFAULTS) {
        const group = reflection.includes(ch) ? 'reflection' : bass.includes(ch) ? 'bass' : 'source';
        if (FX_CC_DEFAULTS[group] && FX_CC_DEFAULTS[group][cc]) def = FX_CC_DEFAULTS[group][cc];
        else if (FX_CC_DEFAULTS[cc]) def = FX_CC_DEFAULTS[cc];
      }
      if (def && Number.isFinite(Number(def.min)) && Number.isFinite(Number(def.max))) return m.round((Number(def.min) + Number(def.max)) / 2);
      return 64;
    };
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, defaultReset(channelToStutter, ccParam)] });
  });
};
