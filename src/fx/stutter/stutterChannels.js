// stutterChannels.js - shared channel selection helper for stutter effects
// DRYs up the identical ~15-line channel-picking boilerplate from fade/pan/FX.

/**
 * Pick N random channels from `channels`, avoiding those in `excludeSet`.
 * If not enough fresh channels remain, clears the set and retries.
 * Returns an Array of selected channels and updates `excludeSet` in-place.
 *
 * @param {Array<number>} channels  - full channel pool
 * @param {number} count            - desired number of channels
 * @param {Set<number>} excludeSet  - set of recently-used channels (mutated)
 * @returns {Array<number>}
 */
pickStutterChannels = (channels, count, excludeSet) => {
  const selected = new Set();
  const available = channels.filter(ch => !excludeSet.has(ch));

  while (selected.size < count && available.length > 0) {
    const ch = available[ri(available.length - 1)];
    selected.add(ch);
    available.splice(available.indexOf(ch), 1);
  }

  if (selected.size < count) {
    excludeSet.clear();
  } else {
    excludeSet.clear();
    for (const ch of selected) excludeSet.add(ch);
  }

  return Array.from(selected);
};

/**
 * Select up to maxCount mirror channels from a candidate pool with
 * the given probability threshold. Single source of truth for mirror
 * channel selection (was duplicated in stutterNotes, StutterManager, stutterFade).
 * @param {Set<number>} targetSet - set to populate (mutated in-place)
 * @param {number[]} candidates - channel pool
 * @param {number} [maxCount=2] - max channels to select
 * @param {number} [probability=0.5] - per-channel selection probability
 */
selectMirrorChannels = (targetSet, candidates, maxCount, probability) => {
  const max = /** @type {number} */ (Number.isFinite(maxCount) ? maxCount : 2);
  const prob = /** @type {number} */ (Number.isFinite(probability) ? probability : 0.5);
  for (let i = 0; i < candidates.length; i++) {
    if (targetSet.size >= max) break;
    if (rf() < prob) targetSet.add(candidates[i]);
  }
};
