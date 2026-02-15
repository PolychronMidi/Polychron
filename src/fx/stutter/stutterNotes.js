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
  } = opts;

  if (typeof channel === 'undefined' || typeof note !== 'number') throw new Error('stutterNotes: missing channel or numeric note');
  const baseMidiNote = m.round(Number(note));
  const isBass = profile === 'bass';

  // Shared state for per-beat shift tracking (variety across channels)
  let localShared = shared;
  if (!localShared) localShared = { shifts: new Map(), global: {} };
  if (!localShared.shifts) localShared.shifts = new Map();
  if (!localShared.global) localShared.global = {};
  const globalState = localShared.global;

  // Reset shift history at beat boundary for variety
  const currentBeatIndex = (typeof beatIndex !== 'undefined') ? beatIndex : null;
  if (globalState._lastBeatIndex !== currentBeatIndex) {
    localShared.shifts.clear();
    globalState._lastBeatIndex = currentBeatIndex;
  }

  // Pan-spatial bias from CC context
  const panBias = (beatContext && beatContext.panDirections && typeof beatContext.panDirections[channel] === 'number')
    ? beatContext.panDirections[channel]
    : 0;

  // Fade-direction velocity coherence from CC context
  const fadeDir = (beatContext && beatContext.fadeChannels && beatContext.fadeChannels.has && beatContext.fadeChannels.has(channel))
    ? (beatContext.fadeDirection || null)
    : null;

  // Pick ONE octave shift (avoid repeating the last shift used on this channel)
  const lastShift = localShared.shifts.get(channel) || null;
  const shiftRange = isBass ? 2 : 3;
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
  const stutterVel = fadeDir === 'in' ? clamp(m.round(rawVel * rf(0.7, 1.0)), 1, 127)
    : fadeDir === 'out' ? clamp(m.round(rawVel * rf(0.4, 0.8)), 1, 127)
    : rawVel;

  // Emit exactly ONE stutter note (octave-shifted echo with slight timing offset)
  const stutterOn = on + sustain * rf(0.05, 0.3);
  const stutterOff = stutterOn + sustain * rf(0.2, 0.6);
  p(c, { tick: stutterOn, type: 'on', vals: [channel, stutterNote, stutterVel] });
  p(c, { tick: stutterOff, vals: [channel, stutterNote] });

  return localShared;
};
