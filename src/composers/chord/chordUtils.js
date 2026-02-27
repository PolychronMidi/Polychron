// chordUtils.js - small utilities for chord normalization and helpers (naked global for project style)
const _chord_enharmonicMap = {
  'B#': 'C', 'E#': 'F', 'Cb': 'B', 'Fb': 'E',
  'Bb#': 'B', 'Eb#': 'E', 'Ab#': 'A', 'Db#': 'D', 'Gb#': 'G',
  'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'
};

normalizeChordSymbol = function(chordSymbol) {
  if (typeof chordSymbol !== 'string') {
    if (chordSymbol && typeof chordSymbol === 'object' && typeof chordSymbol.symbol === 'string') {
      chordSymbol = chordSymbol.symbol;
    } else return chordSymbol;
  }

  // Normalize Unicode sharps/flats to ASCII and trim
  let normalized = chordSymbol.replace(/[\u266F\u266D]/g, ch => ch === '\u266F' ? '#' : 'b').trim();

  // Split off a slash-bass if present so we can normalize both parts
  const parts = normalized.split('/');
  let main = parts[0] || '';
  let bass = parts[1] || '';

  const normalizeRoot = (str) => {
    const rootMatch = String(str).match(/^([A-Ga-g][#b]*)(.*)$/);
    if (!rootMatch) return str;
    const rawRoot = rootMatch[1];
    const rest = rootMatch[2] || '';
    const cleanedRoot = rawRoot.replace(/(#b|b#)+/g, '');
    let out = cleanedRoot + rest;
    out = out.replace(/^([a-g])/, ch => ch.toUpperCase());

    for (const [from, to] of Object.entries(_chord_enharmonicMap).sort((a, b) => b[0].length - a[0].length)) {
      if (out.startsWith(from)) {
        out = to + out.slice(from.length);
        break;
      }
    }
    return out;
  };

  main = normalizeRoot(main);
  if (bass) bass = normalizeRoot(bass);
  normalized = bass ? `${main}/${bass}` : main;

  return normalized;
};
