const midiData = {
  program: [
    { number: 0, name: "Acoustic Grand Piano" },
    { number: 1, name: "Bright Acoustic Piano" },
    { number: 2, name: "Electric Grand Piano" },
    { number: 3, name: "Honky-tonk Piano" },
    { number: 4, name: "Electric Piano 1" },
    { number: 5, name: "Electric Piano 2" },
    { number: 6, name: "Harpsichord" },
    { number: 7, name: "Clavi" },
    { number: 8, name: "Celesta" },
    { number: 9, name: "Glockenspiel" },
    { number: 10, name: "Music Box" },
    { number: 11, name: "Vibraphone" },
    { number: 12, name: "Marimba" },
    { number: 13, name: "Xylophone" },
    { number: 14, name: "Tubular Bells" },
    { number: 15, name: "Dulcimer" },
    { number: 16, name: "Drawbar Organ" },
    { number: 17, name: "Percussive Organ" },
    { number: 18, name: "Rock Organ" },
    { number: 19, name: "Church Organ" },
    { number: 20, name: "Reed Organ" },
    { number: 21, name: "Accordion" },
    { number: 22, name: "Harmonica" },
    { number: 23, name: "Tango Accordion" },
    { number: 24, name: "Acoustic Guitar (nylon)" },
    { number: 25, name: "Acoustic Guitar (steel)" },
    { number: 26, name: "Electric Guitar (jazz)" },
    { number: 27, name: "Electric Guitar (clean)" },
    { number: 28, name: "Electric Guitar (muted)" },
    { number: 29, name: "Overdriven Guitar" },
    { number: 30, name: "Distortion Guitar" },
    { number: 31, name: "Guitar Harmonics" },
    { number: 32, name: "Acoustic Bass" },
    { number: 33, name: "Electric Bass (finger)" },
    { number: 34, name: "Electric Bass (pick)" },
    { number: 35, name: "Fretless Bass" },
    { number: 36, name: "Slap Bass 1" },
    { number: 37, name: "Slap Bass 2" },
    { number: 38, name: "Synth Bass 1" },
    { number: 39, name: "Synth Bass 2" },
    { number: 40, name: "Violin" },
    { number: 41, name: "Viola" },
    { number: 42, name: "Cello" },
    { number: 43, name: "Contrabass" },
    { number: 44, name: "Tremolo Strings" },
    { number: 45, name: "Pizzicato Strings" },
    { number: 46, name: "Orchestral Harp" },
    { number: 47, name: "Timpani" },
    { number: 48, name: "String Ensemble 1" },
    { number: 49, name: "String Ensemble 2" },
    { number: 50, name: "Synth Strings 1" },
    { number: 51, name: "Synth Strings 2" },
    { number: 52, name: "Choir Aahs" },
    { number: 53, name: "Voice Oohs" },
    { number: 54, name: "Synth Voice" },
    { number: 55, name: "Orchestra Hit" },
    { number: 56, name: "Trumpet" },
    { number: 57, name: "Trombone" },
    { number: 58, name: "Tuba" },
    { number: 59, name: "Muted Trumpet" },
    { number: 60, name: "French Horn" },
    { number: 61, name: "Brass Section" },
    { number: 62, name: "Synth Brass 1" },
    { number: 63, name: "Synth Brass 2" },
    { number: 64, name: "Soprano Sax" },
    { number: 65, name: "Alto Sax" },
    { number: 66, name: "Tenor Sax" },
    { number: 67, name: "Baritone Sax" },
    { number: 68, name: "Oboe" },
    { number: 69, name: "English Horn" },
    { number: 70, name: "Bassoon" },
    { number: 71, name: "Clarinet" },
    { number: 72, name: "Piccolo" },
    { number: 73, name: "Flute" },
    { number: 74, name: "Recorder" },
    { number: 75, name: "Pan Flute" },
    { number: 76, name: "Blown Bottle" },
    { number: 77, name: "Shakuhachi" },
    { number: 78, name: "Whistle" },
    { number: 79, name: "Ocarina" },
    { number: 80, name: "Lead 1 (square)" },
    { number: 81, name: "Lead 2 (sawtooth)" },
    { number: 82, name: "Lead 3 (calliope)" },
    { number: 83, name: "Lead 4 (chiff)" },
    { number: 84, name: "Lead 5 (charang)" },
    { number: 85, name: "Lead 6 (voice)" },
    { number: 86, name: "Lead 7 (fifths)" },
    { number: 87, name: "Lead 8 (bass + lead)" },
    { number: 88, name: "Pad 1 (new age)" },
    { number: 89, name: "Pad 2 (warm)" },
    { number: 90, name: "Pad 3 (polysynth)" },
    { number: 91, name: "Pad 4 (choir)" },
    { number: 92, name: "Pad 5 (bowed)" },
    { number: 93, name: "Pad 6 (metallic)" },
    { number: 94, name: "Pad 7 (halo)" },
    { number: 95, name: "Pad 8 (sweep)" },
    { number: 96, name: "FX 1 (rain)" },
    { number: 97, name: "FX 2 (soundtrack)" },
    { number: 98, name: "FX 3 (crystal)" },
    { number: 99, name: "FX 4 (atmosphere)" },
    { number: 100, name: "FX 5 (brightness)" },
    { number: 101, name: "FX 6 (goblins)" },
    { number: 102, name: "FX 7 (echoes)" },
    { number: 103, name: "FX 8 (sci-fi)" },
    { number: 104, name: "Sitar" },
    { number: 105, name: "Banjo" },
    { number: 106, name: "Shamisen" },
    { number: 107, name: "Koto" },
    { number: 108, name: "Kalimba" },
    { number: 109, name: "Bagpipe" },
    { number: 110, name: "Fiddle" },
    { number: 111, name: "Shanai" },
    { number: 112, name: "Tinkle Bell" },
    { number: 113, name: "Agogo" },
    { number: 114, name: "Steel Drums" },
    { number: 115, name: "Woodblock" },
    { number: 116, name: "Taiko Drum" },
    { number: 117, name: "Melodic Tom" },
    { number: 118, name: "Synth Drum" },
    { number: 119, name: "Reverse Cymbal" },
    { number: 120, name: "Guitar Fret Noise" },
    { number: 121, name: "Breath Noise" },
    { number: 122, name: "Seashore" },
    { number: 123, name: "Bird Tweet" },
    { number: 124, name: "Telephone Ring" },
    { number: 125, name: "Helicopter" },
    { number: 126, name: "Applause" },
    { number: 127, name: "Gunshot" }
  ],
  control: [
    { number: 0, name: "Bank Select" },
    { number: 1, name: "Modulation Wheel" },
    { number: 2, name: "Breath Controller" },
    { number: 4, name: "Foot Controller" },
    { number: 5, name: "Portamento Time" },
    { number: 6, name: "Data Entry MSB" },
    { number: 7, name: "Volume" },
    { number: 8, name: "Balance" },
    { number: 10, name: "Pan" },
    { number: 11, name: "Expression" },
    { number: 64, name: "Sustain" },
    { number: 65, name: "Portamento" },
    { number: 66, name: "Sostenuto" },
    { number: 67, name: "Soft Pedal" },
    { number: 91, name: "Reverb" },
    { number: 93, name: "Chorus" },
    { number: 120, name: "Mute" },
    { number: 121, name: "Reset" },
    { number: 123, name: "Notes Off" }
  ]
};
getMidiValue = (category, name) => {
  if (!midiData[category]) {
    console.warn(`Invalid MIDI category: ${category}`);
    return null;
  }
  const item = midiData[category].find(item => item.name.toLowerCase() === name.toLowerCase());
  return item ? item.number : null;
};
INSTRUMENT = getMidiValue('program', INSTRUMENT);


randomFloat = (min = 0, max) => {
  if (max === undefined) { max = min; min = 0; }
  return Math.random() * (max - min + Number.EPSILON) + min;
};

randomInt = (min = 0, max) => {
  if (max === undefined) { max = min; min = 0; }
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

closestDivisor = (x, target = 2) => {
  let closest = Infinity;
  let smallestDiff = Infinity;
  for (let i = 1; i <= Math.sqrt(x); i++) {
    if (x % i === 0) {
      [i, x / i].forEach(divisor => {
        if (divisor !== closest) {
          let diff = Math.abs(divisor - target);
          if (diff < smallestDiff) {
            smallestDiff = diff;
            closest = divisor;
          }
        }
      });
    }
  }
  if (closest === Infinity) {
    return x;
  }
  return x % target === 0 ? target : closest;
};

buildOnsets = (length, valuesOrRange) => {
  let onsets = [];
  let total = 0;
  function randomValueInRange(val) {
    if (Array.isArray(val)) {
      return val[0] === val[1] ? val[0] : randomInt(val[0], val[1]);
    } else if (typeof val === 'function') {
      // Assuming function returns a number or a range [min, max]
      const result = val();
      return Array.isArray(result) ? randomValueInRange(result) : result;
    }
    return val;
  }
  // Build onsets until we reach or exceed length or run out of values to use
  while (total < length) {
    let v = randomValueInRange(valuesOrRange);
    if (total + (v + 1) <= length) { // +1 because each onset adds 1 to length
      onsets.push(v);
      total += v + 1;
    } else if (Array.isArray(valuesOrRange) && valuesOrRange.length === 2) {
      // Try one more time with the lower end of the range
      v = valuesOrRange[0];
      if (total + (v + 1) <= length) {
        onsets.push(v);
        total += v + 1;
      }
      break; // Stop after trying with the lower end or if it doesn't fit
    } else {
      break; // If not a range or if the range doesn't fit even with the lower value
    }
  }
  // Convert onsets to actual rhythm pattern
  let rhythm = [];
  for (let onset of onsets) {
    rhythm.push(1);
    for (let i = 0; i < onset; i++) {
      rhythm.push(0);
    }
  }
  // If total length is less than desired length, pad with zeros
  while (rhythm.length < length) {
    rhythm.push(0);
  }
  return rhythm;
};

formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};


neutralPitchBend = 8192; semitone = neutralPitchBend / 2;
centsToTuningFreq = 1200 * Math.log2(TUNING_FREQ / 440);
tuningPitchBend = Math.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

binauralFreqOffset = randomFloat(BINAURAL.MIN, BINAURAL.MAX);
centsToOffsetPlus = 1200 * Math.log2((TUNING_FREQ + binauralFreqOffset) / TUNING_FREQ);
centsToOffsetMinus = 1200 * Math.log2((TUNING_FREQ - binauralFreqOffset) / TUNING_FREQ);
binauralPlus = Math.round(tuningPitchBend + (semitone * (centsToOffsetPlus / 100)));
binauralMinus = Math.round(tuningPitchBend + (semitone * (centsToOffsetMinus / 100)));
flipBinaural = lastBinauralFreqOffset = beatsUntilBinauralShift = beatCount = beatOnCount = beatOffCount = 0;

notesUntilRest = noteCount = 0;

centerCH = 0;  leftCH = 1;  rightCH = 2;
leftCH2 = 3;  rightCH2 = 4;
velocity = 99;
currentTick = currentTime = 0;
composition = `0, 0, header, 1, 1, ${PPQ}\n1, 0, start_track\n`;
finale = () => `1, ${finalTick + ticksPerSecond * SILENT_OUTRO_SECONDS}, end_track`;
fs = require('fs');


t = require("tonal");

allNotes = t.Scale.get("C chromatic").notes.map(note => 
  t.Note.enharmonic(t.Note.get(note))
);

allScales = t.Scale.names().filter(scaleName => {
  return allNotes.some(root => {
    const scale = t.Scale.get(`${root} ${scaleName}`);
    return scale.notes.length > 0;
  });
});

allChords = (function() {
  function getChordNotes(chordType, root) {
    const chord = t.Chord.get(`${root} ${chordType}`);
    if (!chord.empty && chord.symbol) {
      return { symbol: chord.symbol, notes: chord.notes };
    }
  }
  const allChords = new Set();
  t.ChordType.all().forEach(chordType => {
    allNotes.forEach(root => {
      const chord = getChordNotes(chordType.name, root);
      if (chord) {
        allChords.add(chord.symbol);
      }
    });
  });
  return Array.from(allChords);
})();

allModes = (() => {
  const allModes = new Set();
  t.Mode.all().forEach(mode => {
    allNotes.forEach(root => {
      const modeName = `${root} ${mode.name}`;
      allModes.add(modeName);
    });
  });
  return Array.from(allModes);
})();


lastBeatRhythm = t.RhythmPattern.random(NUMERATOR.MAX, .8);
lastDivRhythm = t.RhythmPattern.random(DIVISIONS.MAX, .5);
lastSubdivRhythm = t.RhythmPattern.random(SUBDIVISIONS.MAX, .3);
