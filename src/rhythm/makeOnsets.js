// src/rhythm/makeOnsets.js - utility to create rhythm arrays from onset distances

// Helper to generate rhythm array given length and either an array of possible
// onset distances or a [min,max] range for random selection of onset distances.
makeOnsets = (length, valuesOrRange) => {
  const onsets = []; let total = 0;
  let iterations = 0;
  while (total < length) {
    let v = ra(valuesOrRange);
    if (total + (v + 1) <= length) {
      onsets.push(v);
      total += v + 1;
    } else if (Array.isArray(valuesOrRange) && valuesOrRange.length === 2) {
      v = valuesOrRange[0];
      if (total + (v + 1) <= length) {
        onsets.push(v);
        total += v + 1;
      }
      break;
    } else {
      break;
    }
    iterations++;
    if (iterations > length * 10) {
      break;
    }
  }
  const rhythm = [];
  for (const onset of onsets) { rhythm.push(1); for (let i = 0; i < onset; i++) { rhythm.push(0); } }
  while (rhythm.length < length) { rhythm.push(0); }
  return rhythm;
};
