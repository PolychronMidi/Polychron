// drumKitRotator.js - per-phrase rotation across the drumMap families.
// Without this, playDrums hardcodes literal names ('kick1','kick3') and the
// listener hears the same kit forever. Cymbals/congas were unused except via
// the rare 'random' fallback. Rotation is keyed on sectionIndex+phraseIndex
// so kits change every phrase but stay stable within one phrase.

const V_kitRotator = validator.create('drumKitRotator');

drumKitRotator = (() => {
  const KICKS = ['kick1','kick2','kick3','kick4','kick5','kick6','kick7'];
  const SNARES = ['snare1','snare2','snare3','snare4','snare5','snare6','snare7','snare8'];
  const CYMBALS = ['cymbal1','cymbal2','cymbal3','cymbal4'];
  const CONGAS = ['conga1','conga2','conga3','conga4','conga5'];

  // Multipliers must be coprime with family sizes (4,5,7,8) so every phrase
  // rotates every family. 11 and 3 hit gcd=1 against all four.
  function phraseSeed() {
    V_kitRotator.requireFinite(sectionIndex, 'sectionIndex');
    V_kitRotator.requireFinite(phraseIndex, 'phraseIndex');
    return sectionIndex * 11 + phraseIndex * 3;
  }

  function pickFromFamily(family, slot) {
    V_kitRotator.assertArray(family, 'family');
    V_kitRotator.requireFinite(slot, 'slot');
    const idx = (phraseSeed() + slot * 3) % family.length;
    return family[idx];
  }

  return {
    pickKick: (slot) => pickFromFamily(KICKS, slot),
    pickSnare: (slot) => pickFromFamily(SNARES, slot),
    pickCymbal: (slot = 0) => pickFromFamily(CYMBALS, slot),
    pickConga: (slot = 0) => pickFromFamily(CONGAS, slot),
    pickKicks: (n) => Array.from({ length: n }, (_, i) => pickFromFamily(KICKS, i)),
    pickSnares: (n) => Array.from({ length: n }, (_, i) => pickFromFamily(SNARES, i))
  };
})();
