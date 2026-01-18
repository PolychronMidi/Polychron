# backstage (src/backstage.ts)

- Source: ../src/backstage.ts
- Area: Core utilities and randomization helpers used across modules.

## Overview
Provides foundational helpers for experimental composition workflows (randomization, small utilities) used by composers, timing, and stage modules.

## Key Exports
- See source for the evolving API surface. Prefer importing named utilities directly from the module.

## Usage
```ts
import * as backstage from '../src/backstage';
// Example: use a random helper or shared utility
// const v = backstage.rf(0, 1);
```

## Integration Notes
- Heavily used by composers and rhythm/timing modules.
- Keep functions deterministic for tests by seeding upstream where relevant.

## Tests
- test/backstage.test.ts
- test/coverage-boosts.test.ts

## Related (old docs)
- docs_old/backstage.md

## Changelog
- TODO: record notable changes as the module evolves.
