// stutterNotes.js - single octave-shift stutter per note
// Emits exactly ONE octave-shifted note-on + note-off per call.
// Gated externally by stutterProb in playNotes — this function does NOT
// add its own probability layers or burst multiple events.
// Cooperates with CC effects via beatContext (pan↔register, fade↔velocity).

const _clampStutterNote = (n, isBassLocal) => {
  if (isBassLocal) return modClamp(n, m.max(0, OCTAVE.min * 12 - 1), 59);
  return modClamp(n, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
};

/**
 * Pick a random octave shift with optional pan-position bias.
 * panBias: -1 (hard left) to +1 (hard right), 0 = no bias.
 */
const _pickRandomOctaveShift = (baseNote, isBassLocal, maxOctaves, lastShift = null, panBias = 0) => {
  const minNote = m.max(0, OCTAVE.min * 12 - 1);
  const maxNote = isBassLocal ? 59 : (OCTAVE.max * 12 - 1);
  const candidates = [];
  const maxOct = m.max(1, m.floor(Number(maxOctaves)));
  for (let octaveMag = 1; octaveMag <= maxOct; octaveMag++) {
    const upShift = octaveMag * 12;
    const downShift = -octaveMag * 12;
    if (baseNote + upShift <= maxNote) candidates.push(upShift);
    if (baseNote + downShift >= minNote) candidates.push(downShift);
  }

  if (candidates.length === 0) return 0;

  const filtered = (lastShift !== null && candidates.length > 1)
    ? candidates.filter((shift) => shift !== lastShift)
    : candidates;
  const pool = filtered.length > 0 ? filtered : candidates;

  // Pan-spatial bias: left→up, right→down
  if (m.abs(panBias) > 0.15 && pool.length > 1) {
    const upCandidates = pool.filter(s => s > 0);
    const downCandidates = pool.filter(s => s < 0);
    const biasStrength = m.abs(panBias) * 0.6;
    if (panBias < 0 && upCandidates.length > 0 && rf() < biasStrength) {
      return upCandidates[ri(upCandidates.length - 1)];
    }
    if (panBias > 0 && downCandidates.length > 0 && rf() < biasStrength) {
      return downCandidates[ri(downCandidates.length - 1)];
    }
  }

  return pool[ri(pool.length - 1)];
};

/**
 * stutterNotes: emit ONE octave-shifted echo of the given note.
 * Called only when playNotes has already decided stutter should fire (stutterProb gate).
 * Does NOT add extra probability layers or emit bursts of notes.
 *
 * @param {Object} opts
 * @param {string} [opts.profile='source']
 * @param {string|number} opts.channel
 * @param {number} opts.note
 * @param {number} opts.on
 * @param {number} opts.sustain
 * @param {number} opts.velocity
 * @param {number} opts.binVel
 * @param {boolean} [opts.isPrimary=false]
 * @param {Object} [opts.shared]
 * @param {Object} [opts.beatContext]
 * @returns {Object} shared state
 */
stutterNotes = (/** @type {any} */ opts = {}) => {
  const {
    profile = 'source',
    channel,
    note,
    on,
    sustain,
    velocity,
    binVel,
    isPrimary = false,
    shared = null,
    beatContext = null,
    emit = true // when false, return planned events instead of calling p()
  } = opts;

  if (typeof channel === 'undefined' || typeof note !== 'number') throw new Error('stutterNotes: missing channel or numeric note');
  const baseMidiNote = m.round(Number(note));
  const isBass = profile === 'bass';

  // Shared state for per-beat shift tracking (variety across channels) + optional selected-channel sets
  let localShared = shared;
  if (!localShared) localShared = { shifts: new Map(), global: {} };
  if (!localShared.shifts) localShared.shifts = new Map();
  if (!localShared.global) localShared.global = {};
  const globalState = localShared.global;

  // Reset shift history and selection sets at beat boundary for variety
  const currentBeatIndex = (typeof beatIndex !== 'undefined') ? beatIndex : null;
  if (globalState._lastBeatIndex !== currentBeatIndex) {
    localShared.shifts.clear();
    globalState._lastBeatIndex = currentBeatIndex;
    // selection sets (reflection/bass) — limit stutter to a small random subset of mirror channels
    globalState.selectedReflectionChannels = new Set();
    globalState.selectedBassChannels = new Set();
  }

  // If mirror-selection not yet populated for this beat, lazily choose up to 2 channels
  if (!globalState.selectedReflectionChannels || globalState.selectedReflectionChannels.size === 0) {
    try {
      const candidates = (typeof reflection !== 'undefined' && Array.isArray(reflection)) ? reflection.slice() : [];
      for (const ch of candidates) {
        if (globalState.selectedReflectionChannels.size < 2 && rf() < 0.5) globalState.selectedReflectionChannels.add(ch);
      }
    } catch { /* ignore */ }
  }
  if (!globalState.selectedBassChannels || globalState.selectedBassChannels.size === 0) {
    try {
      const candidates = (typeof bass !== 'undefined' && Array.isArray(bass)) ? bass.slice() : [];
      for (const ch of candidates) {
        if (globalState.selectedBassChannels.size < 2 && rf() < 0.5) globalState.selectedBassChannels.add(ch);
      }
    } catch { /* ignore */ }
  }

  // Pan-spatial bias from CC context
  const panBias = (beatContext && beatContext.panDirections && typeof beatContext.panDirections[channel] === 'number')
    ? beatContext.panDirections[channel]
    : 0;

  // Fade-direction velocity coherence from CC context
  const fadeDir = (beatContext && beatContext.fadeChannels && beatContext.fadeChannels.has && beatContext.fadeChannels.has(channel))
    ? (beatContext.fadeDirection || null)
    : null;

  // Modulation bus (fade/pan/fx) published by CC stutters — used for cross-modulation
  const modBus = (beatContext && beatContext.mod && beatContext.mod[channel]) ? beatContext.mod[channel] : null;

  // Cross-mod rules from config (pan/fade/fx influence on stutter behavior)
  const crossRules = (typeof StutterConfig !== 'undefined' && StutterConfig && typeof StutterConfig.getCrossModRules === 'function')
    ? StutterConfig.getCrossModRules()
    : { pan: { stutterProbScale: 1 }, fade: { velocityScaleBias: 0 }, fx: { shiftRangeScale: 1 } };

  // Apply cross-mod adjustments
  let shiftRangeBias = 0;
  let velocityScaleBias = 0;
  if (modBus) {
    if (typeof modBus.pan === 'number') {
      const panAbs = Math.abs(modBus.pan);
      shiftRangeBias += Math.round((crossRules.pan.shiftRangeBias || 0) * panAbs);
    }
    if (typeof modBus.fade === 'number') {
      velocityScaleBias += (crossRules.fade.velocityScaleBias || 0) * modBus.fade;
    }
    if (typeof modBus.fx === 'number') {
      shiftRangeBias += Math.round((crossRules.fx.shiftRangeScale - 1) * modBus.fx);
    }
  }

  // Per-channel coherence overlay (shared noise key) — can bias shifts/decision
  const coherenceKey = (beatContext && beatContext.coherenceKey) ? beatContext.coherenceKey : null;
  const cohMod = coherenceKey ? (getParameterModulation(channel, coherenceKey, on) || { x: 0.5, y: 0.5 }) : null;

  // Pick ONE octave shift (avoid repeating the last shift used on this channel)
  const lastShift = localShared.shifts.get(channel) || null;
  const baseShiftRange = isBass ? 2 : 3;
  const shiftRange = m.max(1, baseShiftRange + shiftRangeBias);
  const shift = _pickRandomOctaveShift(baseMidiNote, isBass, shiftRange, lastShift, panBias);
  localShared.shifts.set(channel, shift);

  const stutterNote = m.round(_clampStutterNote(baseMidiNote + shift, isBass));

  // Velocity: scaled version of the original, with fade-direction coherence
  const velRanges = (typeof StutterConfig !== 'undefined' && StutterConfig && StutterConfig.getVelocityRange)
    ? StutterConfig.getVelocityRange(profile, isPrimary)
    : (isPrimary ? [0.3, 0.7] : [0.45, 0.8]);
  const rawVel = clamp(m.round(
    isPrimary ? velocity * rf(velRanges[0], velRanges[1]) : binVel * rf(velRanges[0], velRanges[1])
  ), 1, 127);
  let stutterVel = fadeDir === 'in' ? clamp(m.round(rawVel * rf(0.7, 1.0)), 1, 127)
    : fadeDir === 'out' ? clamp(m.round(rawVel * rf(0.4, 0.8)), 1, 127)
    : rawVel;

  // apply cross-mod velocity bias (from beatContext.mod → stutterConfig.fade.velocityScaleBias)
  if (velocityScaleBias && Number.isFinite(Number(velocityScaleBias))) {
    stutterVel = clamp(m.round(stutterVel * (1 + velocityScaleBias)), 1, 127);
  }

  // coherence overlay: small velocity boost when coherence X is high
  if (cohMod && Number.isFinite(cohMod.x) && cohMod.x > 0.6) {
    const boost = m.round((cohMod.x - 0.6) * 8); // modest additive boost
    stutterVel = clamp(stutterVel + boost, 1, 127);
  }

  // Build planned events (single on/off pair)
  const stutterOn = on + sustain * rf(0.05, 0.3);
  const stutterOff = stutterOn + sustain * rf(0.2, 0.6);
  const evOn = { tick: stutterOn, type: 'on', vals: [channel, stutterNote, stutterVel] };
  const evOff = { tick: stutterOff, vals: [channel, stutterNote] };

  if (!emit) {
    // Return planned events for testing/preview
    return { shared: localShared, events: [evOn, evOff] };
  }

  // Emit and metrics
  p(c, evOn);
  try {
    const eventName = (typeof EventCatalog !== 'undefined' && EventCatalog && EventCatalog.names)
      ? EventCatalog.names.STUTTER_APPLIED
      : 'stutter-applied';
    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') EventBus.emit(eventName, { type: 'note', profile, channel, shift, intensity: clamp(stutterVel / 127, 0, 1), tick: stutterOn });
  } catch { /* ignore */ }
  p(c, evOff);
  try { if (typeof StutterMetrics !== 'undefined' && StutterMetrics && typeof StutterMetrics.incEmitted === 'function') StutterMetrics.incEmitted(1, profile); } catch { /* ignore */ }

  return localShared;
};

// Register this helper with StutterRegistry if present so tests/plugins can swap implementations.
try {
  if (typeof StutterRegistry !== 'undefined' && StutterRegistry && typeof StutterRegistry.registerHelper === 'function') {
    StutterRegistry.registerHelper(stutterNotes);
  }
} catch { /* ignore */ }
