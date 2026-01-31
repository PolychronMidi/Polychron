// src/rhythm/makeOnsets.js - extracted from src/rhythm.js
// Preserves original logic and uses __POLYCHRON_TEST__ for debug logging
makeOnsets = (length, valuesOrRange) => {
  if (__POLYCHRON_TEST__?.enableLogging) console.log('[makeOnsets] START', length, valuesOrRange);
  let onsets = []; let total = 0;
  let iterations = 0;
  while (total < length) {
    if (__POLYCHRON_TEST__?.enableLogging) console.log(`[makeOnsets] iteration ${iterations}, total=${total}`);
    let v = ra(valuesOrRange);
    if (__POLYCHRON_TEST__?.enableLogging) console.log(`[makeOnsets] v=${v}`);
    if (total + (v + 1) <= length) {
      onsets.push(v);
      total += v + 1;
      if (__POLYCHRON_TEST__?.enableLogging) console.log(`[makeOnsets] added onset, new total=${total}`);
    } else if (Array.isArray(valuesOrRange) && valuesOrRange.length === 2) {
      v = valuesOrRange[0];
      if (total + (v + 1) <= length) {
        onsets.push(v);
        total += v + 1;
        if (__POLYCHRON_TEST__?.enableLogging) console.log(`[makeOnsets] added onset, new total=${total}`);
      }
      if (__POLYCHRON_TEST__?.enableLogging) console.log('[makeOnsets] breaking');
      break;
    } else {
      if (__POLYCHRON_TEST__?.enableLogging) console.log('[makeOnsets] breaking');
      break;
    }
    iterations++;
    if (iterations > length * 10) {
      if (__POLYCHRON_TEST__?.enableLogging) console.log('[makeOnsets] breaking');
      break;
    }
  }
  if (__POLYCHRON_TEST__?.enableLogging) console.log('[makeOnsets] building rhythm array');
  let rhythm = [];
  for (let onset of onsets) { rhythm.push(1); for (let i = 0; i < onset; i++) { rhythm.push(0); } }
  while (rhythm.length < length) { rhythm.push(0); }
  if (__POLYCHRON_TEST__?.enableLogging) console.log('[makeOnsets] END, length=', rhythm.length);
  return rhythm;
};
