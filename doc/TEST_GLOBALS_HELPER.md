# Hermetic globals helper for test specs

Source-of-truth for `tools/HME/tests/with_globals.js`. Inline comments
were trimmed per CLAUDE.md ("Inline comments single-line and terse").

## Why

Several specs (drum_kit_rotator, rhythm_flair) need to mutate
`global.validator` / `global.rf` / `global.<index>` to inject test
doubles for code that pulls those symbols off the global object at
require-time. Doing the mutate-then-restore by hand is fragile — a
missed restore poisons every later spec in the `run.js` single-process
suite. (Pollution incident 2026-05-01: drum_kit_rotator's stub
`validator` lacked `optionalFinite`, breaking metaprofile tests that
loaded later.)

## Usage

    const { withGlobals } = require('../with_globals');

    const rotator = withGlobals(
      {
        validator: { create: () => ({ requireFinite: ..., assertArray: ... }) },
        sectionIndex: 0,
        phraseIndex: 1,
      },
      () => {
        delete require.cache[require.resolve(ROTATOR_PATH)];
        require(ROTATOR_PATH);
        return global.drumKitRotator;
      }
    );

The body runs with the override globals visible; on return (or throw),
every key passed in is restored to its prior value (or deleted if it
didn't exist before).
