// variants/stereoWidthModulation.js - oscillating stereo width for stutter echoes.
// Uses balance (CC10) consistent with setBalanceAndFX.js. Reacts to flipBin
// state so width modulation tracks binaural inversion correctly.
// Sweeps within current side without crossing center.


moduleLifecycle.registerInitializer('stereoWidthModulation-registration', () => {
  stutterVariants.register('stereoWidthModulation', function stereoWidthModulation(opts) {
    const width = (StutterManager.beatContext && Number.isFinite(StutterManager.beatContext.stereoWidth))
      ? StutterManager.beatContext.stereoWidth : 0.6;

    // Determine which logical side this channel is on AFTER flipBin inversion.
    // When flipBin is true, left channels play the right balance and vice versa.
    const physicalLeft = [lCH1, lCH2, lCH3, lCH4, lCH5, lCH6].includes(opts.channel);
    const physicalRight = [rCH1, rCH2, rCH3, rCH4, rCH5, rCH6].includes(opts.channel);
    if (!physicalLeft && !physicalRight) return stutterNotes(opts);

    // After flipBin, the actual audible side is inverted
    const audibleLeft = flipBin ? physicalRight : physicalLeft;

    // Use current lBal/rBal from setBalanceAndFX as the baseline center-of-side,
    // then modulate width around it. lBal is typically 0-54, rBal is typically 74-127.
    const sideBaseline = audibleLeft ? lBal : rBal;
    const centerVal = 64;

    // Width modulation: sweep between baseline and further from center
    // audibleLeft: sweep from sideBaseline toward 0 (further left)
    // audibleRight: sweep from sideBaseline toward 127 (further right)
    const spreadAmount = m.round(m.abs(sideBaseline - centerVal) * width * rf(0.5, 1.0));
    const balTarget = audibleLeft
      ? clamp(sideBaseline - spreadAmount, 0, sideBaseline)
      : clamp(sideBaseline + spreadAmount, sideBaseline, 127);

    // Per-channel jitter: slight to moderate pan variation so each channel
    // sits at a slightly different position within the width sweep
    const jitter = ri(-8, 8) + m.round(rf(-3, 3) * width * 5);
    const jitteredTarget = clamp(balTarget + jitter, audibleLeft ? 0 : centerVal, audibleLeft ? centerVal : 127);

    // Emit balance CC before stutter note
    channelStateField.observeControl(opts.channel, 10, jitteredTarget, 'stereoWidthModulation');
    p(c, { timeInSeconds: opts.on, type: 'control_c', vals: [opts.channel, 10, jitteredTarget] });

    const vel = clamp(m.round(opts.velocity * rf(0.35, 0.6)), 1, 127);
    const result = stutterNotes(Object.assign({}, opts, {
      velocity: vel, binVel: vel
    }));

    // Restore balance to baseline + mild residual jitter for organic feel
    const restoreJitter = ri(-3, 3);
    const restoreVal = clamp(sideBaseline + restoreJitter, audibleLeft ? 0 : centerVal, audibleLeft ? centerVal : 127);
    channelStateField.observeControl(opts.channel, 10, restoreVal, 'stereoWidthModulation');
    p(c, { timeInSeconds: opts.on + opts.sustain * 0.8, type: 'control_c', vals: [opts.channel, 10, restoreVal] });

    return result;
  }, 0.7, { selfGate: 0.75, maxPerSection: 180 });

}, ['stutterVariants']);
