/** @this {any} */
stutterFX = function stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
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

      // If a coherence key exists, overlay correlated noise
      const coherenceKey = (this.beatContext && this.beatContext.coherenceKey) ? this.beatContext.coherenceKey : null;
      let coh = { x: 0.5, y: 0.5 };
      if (coherenceKey) {
        try { coh = getParameterModulation(channelToStutter, coherenceKey, tick); } catch { coh = { x: 0.5, y: 0.5 }; }
      }

      const rampWarp = (mod.x - 0.5) * 2 * 40 * noiseProfile.influenceX + (coh.x - 0.5) * 10;
      const flutter = (mod.y - 0.5) * 2 * 20 * noiseProfile.influenceY + (coh.y - 0.5) * 6;
      const currentValue = modClamp(m.floor(baseValue + rampWarp + flutter), 0, 127);

      // publish modulation bus entry for cross‑mod sampling
      try {
        const norm = clamp(currentValue / 127, 0, 1);
        if (!this.beatContext.mod) this.beatContext.mod = {};
        this.beatContext.mod[channelToStutter] = Object.assign(this.beatContext.mod[channelToStutter] || {}, { fx: norm });
      } catch { /* ignore */ }

      // feedback event
      try { if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') EventBus.emit('stutter-applied', { type: 'cc', subtype: 'fx', channel: channelToStutter, intensity: clamp(currentValue / 127, 0, 1), tick }); } catch { /* ignore */ }

      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, currentValue] });
    }
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, 64] });
  });
};
