// drumKitRotator.js - per-phrase kit-preset rotation. Preserves the
// foundational dominant drums (kick1+kick3 for L1, kick2+kick5+kick7 for
// L2) selected for their distinct velocity ranges (kick1/2 are the
// loudest 111-127, snare1/2 loudest 99-111). Each preset varies which
// SUPPLEMENTARY drums flavor the phrase: alt-kick fill identity,
// mix-fill secondary drums, tail snare, end-accent snare, and the
// cymbal/conga that characterize the phrase's color.
//
// Both the preset choice AND the specific drums within each slot rotate
// per phrase via sectionIndex*11 + phraseIndex*3 (multipliers coprime
// with the 4-preset cycle so every new phrase advances). L1 and L2
// pick from disjoint preset banks so the two layers never collide on
// the same drum identity.

const V_kitRotator = validator.create('drumKitRotator');

drumKitRotator = (() => {
  // L1 presets - kick1+kick3 is the foundational backbone in every preset.
  // mixFill always leads with a foundational snare (snare1 or snare4).
  // tailSnare/endAccent stay within the foundational snare set.
  const L1_PRESETS = [
    {
      kicks: ['kick1', 'kick3'],            kickOffs: [0, 0.5],
      altKicks: ['kick2', 'kick5'],         altKickOffs: [0, 0.5],
      mixFill: ['snare1', 'kick4', 'kick7', 'snare4'], mixFillOffs: [0, 0.5, 0.75, 0.25],
      tailSnare: 'snare5',  endAccent: 'snare6',
      cymbal: 'cymbal1',    conga: 'conga1',
    },
    {
      kicks: ['kick1', 'kick3'],            kickOffs: [0, 0.5],
      altKicks: ['kick4', 'kick7'],         altKickOffs: [0, 0.5],
      mixFill: ['snare4', 'kick1', 'kick3', 'snare1'], mixFillOffs: [0, 0.5, 0.75, 0.25],
      tailSnare: 'snare1',  endAccent: 'snare4',
      cymbal: 'cymbal2',    conga: 'conga2',
    },
    {
      kicks: ['kick3', 'kick1'],            kickOffs: [0, 0.5],
      altKicks: ['kick2', 'kick3'],         altKickOffs: [0, 0.25],
      mixFill: ['snare1', 'kick4', 'kick7', 'snare5'], mixFillOffs: [0, 0.5, 0.75, 0.25],
      tailSnare: 'snare4',  endAccent: 'snare5',
      cymbal: 'cymbal3',    conga: 'conga3',
    },
    {
      kicks: ['kick1', 'kick3'],            kickOffs: [0, 0.5],
      altKicks: ['kick5', 'kick2'],         altKickOffs: [0, 0.5],
      mixFill: ['snare4', 'kick3', 'kick7', 'snare1'], mixFillOffs: [0, 0.5, 0.75, 0.25],
      tailSnare: 'snare6',  endAccent: 'snare1',
      cymbal: 'cymbal4',    conga: 'conga4',
    },
  ];

  // L2 presets - kick2+kick5+kick7 is the foundational backbone. mixFill
  // leads with a foundational L2 snare (snare2 or snare3). tailSnare in
  // {snare2, snare3, snare7, snare8}.
  const L2_PRESETS = [
    {
      kicks: ['kick2', 'kick5', 'kick7'],   kickOffs: [0, 0.5, 0.25],
      altKicks: ['kick1', 'kick3', 'kick7'], altKickOffs: [0, 0.5, 0.25],
      mixFill: ['snare2', 'kick6', 'snare3'], mixFillOffs: [0, 0.5, 0.75],
      tailSnare: 'snare7',
      cymbal: 'cymbal4',    conga: 'conga5',
    },
    {
      kicks: ['kick2', 'kick5', 'kick7'],   kickOffs: [0, 0.5, 0.25],
      altKicks: ['kick3', 'kick1', 'kick6'], altKickOffs: [0, 0.5, 0.25],
      mixFill: ['snare3', 'kick2', 'snare7'], mixFillOffs: [0, 0.5, 0.75],
      tailSnare: 'snare2',
      cymbal: 'cymbal3',    conga: 'conga4',
    },
    {
      kicks: ['kick5', 'kick2', 'kick7'],   kickOffs: [0, 0.5, 0.25],
      altKicks: ['kick6', 'kick3', 'kick1'], altKickOffs: [0, 0.5, 0.25],
      mixFill: ['snare2', 'kick7', 'snare8'], mixFillOffs: [0, 0.5, 0.75],
      tailSnare: 'snare3',
      cymbal: 'cymbal2',    conga: 'conga3',
    },
    {
      kicks: ['kick2', 'kick5', 'kick7'],   kickOffs: [0, 0.5, 0.75],
      altKicks: ['kick1', 'kick7', 'kick3'], altKickOffs: [0, 0.5, 0.25],
      mixFill: ['snare2', 'kick5', 'snare7'], mixFillOffs: [0, 0.5, 0.75],
      tailSnare: 'snare8',
      cymbal: 'cymbal1',    conga: 'conga2',
    },
  ];

  // Normal mode: per-phrase rotation. Flair mode: per-beat rotation for
  // touches of rapid randomization. Both modes preserve the foundational
  // dominant drums (every preset already anchors on kick1+kick3 / kick2+
  // kick5+kick7), so flair only varies the supplementary slots.
  function presetIndex(layerOffset, flair) {
    V_kitRotator.requireFinite(sectionIndex, 'sectionIndex');
    V_kitRotator.requireFinite(phraseIndex, 'phraseIndex');
    if (flair) {
      V_kitRotator.requireFinite(measureIndex, 'measureIndex');
      V_kitRotator.requireFinite(beatIndex, 'beatIndex');
      // Adds per-beat-and-measure terms so flair picks a fresh preset on
      // every beat. Multipliers 5 and 2 are coprime with 4-preset count.
      return (sectionIndex * 11 + phraseIndex * 3 + measureIndex * 5 + beatIndex * 2 + layerOffset) % L1_PRESETS.length;
    }
    return (sectionIndex * 11 + phraseIndex * 3 + layerOffset) % L1_PRESETS.length;
  }

  return {
    getL1Preset: (flair) => L1_PRESETS[presetIndex(0, Boolean(flair))],
    getL2Preset: (flair) => L2_PRESETS[presetIndex(1, Boolean(flair))],
  };
})();
