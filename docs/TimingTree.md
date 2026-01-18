<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# TimingTree.ts - Hierarchical Timing State Management

> **Status**: Timing State Utility  
> **Dependencies**: Backstage globals, timing/composition hierarchy


## Overview

`TimingTree.ts` provides a hierarchical tree structure for managing timing state across the composition hierarchy (sections, phrases, measures, beats, divisions, subdivisions). It enables rapid lookup of timing values, sync between global state and tree, and per-layer isolation for multi-layer rendering.

**Core Responsibilities:**
- Build and traverse hierarchical timing tree paths
- Store timing values (beat counts, on/off ratios, BPM, meters) at each level
- Sync timing values between global scope and tree storage
- Create per-layer isolated timing contexts
- Provide fast lookup of timing values without traversing entire hierarchy

---

## API

### Types

#### `interface TimingLeaf`

Individual timing value storage node:

```typescript
interface TimingLeaf {
  [key: string]: number | boolean | string;
}
```

#### `interface TimingTree`

Hierarchical tree structure mapping path → TimingLeaf:

```typescript
interface TimingTree {
  [path: string]: TimingLeaf;
}
```

### Functions

#### `initTimingTree()`

Initialize root timing tree structure.

#### `initLayer(layerName, buffer)`

Initialize a new layer (e.g., "primary", "poly") with its own timing context.

#### `buildPath(...components)`

Build a hierarchical path string from level components.

**Example:**
```typescript
buildPath('section', 0, 'phrase', 2, 'beat', 3);
// Returns: "section/0/phrase/2/beat/3"
```

#### Other Functions

- `getOrCreatePath(path)` – Get or create a leaf node at path
- `getTimingValue(path, key)` – Retrieve single timing value
- `getTimingValues(path)` – Retrieve all timing values at path
- `setTimingValue(path, key, value)` – Set single timing value
- `setTimingValues(path, values)` – Set multiple timing values
- `syncGlobalsToTree(path)` – Copy timing values from globals to tree
- `syncTreeToGlobals(path)` – Copy timing values from tree to globals

---

## Usage Example

```typescript
import { initTimingTree, buildPath, setTimingValue, syncGlobalsToTree } from '../src/TimingTree';

initTimingTree();

// Store timing state at section/phrase/beat level
const beatPath = buildPath('section', 0, 'phrase', 0, 'beat', 3);
setTimingValue(beatPath, 'beatsOn', 8);
setTimingValue(beatPath, 'beatsOff', 2);

// Sync current globals to tree
syncGlobalsToTree(beatPath);

// Later, restore from tree to globals
syncTreeToGlobals(beatPath);
```

---

## Hierarchy Levels

TimingTree supports multi-level hierarchy:

```
section/[sectionIndex]/
  phrase/[phraseIndex]/
    measure/[measureIndex]/
      beat/[beatIndex]/
        division/[divIndex]/
          subdivision/[subdivIndex]/
```

Each level can store its own timing values (beat counts, meter, BPM, polyrhythm ratios, etc.).

---

## Related Modules

- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Main composition loop that populates tree
- time/TimingCalculator.ts ([code](../src/time/TimingCalculator.ts)) ([doc](time/TimingCalculator.md)) - Calculates timing values
- backstage.ts ([code](../src/backstage.ts)) ([doc](backstage.md)) - Global timing state source
