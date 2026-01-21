# structure.ts - Section Profile & Composition Structure Helpers

> **Status**: Composition Architecture
> **Dependencies**: Backstage globals (SECTION_TYPES, PHRASES_PER_SECTION, random helpers)


## Overview

`structure.ts` defines section types, profiles, and helpers that shape the overall composition structure at the section level. It provides section type normalization, random selection, and profile resolution to determine section characteristics (type, phrase count, BPM scale, dynamics, motifs).

**Core Responsibilities:**
- Normalize section type definitions into consistent format
- Select random section type based on weighted probabilities
- Resolve detailed section profiles (phrase counts, dynamics, motif seeds)
- Expose interfaces for `SectionProfile` and `NormalizedSectionType`

---

## API

### Types

#### `interface NormalizedSectionType`

Normalized section configuration with weights and ranges:

```typescript
interface NormalizedSectionType {
  type: string;              // Section type name (e.g., "intro", "verse")
  weight: number;            // Selection probability weight
  bpmScale: number;          // BPM multiplier for this section
  dynamics: string;          // Dynamics marking (e.g., "mf", "pp", "ff")
  phrasesMin: number;        // Minimum phrases in section
  phrasesMax: number;        // Maximum phrases in section
  motif: number[] | null;    // Motif note offsets (null = no motif)
}
```

#### `interface SectionProfile`

Resolved profile for a specific section instance:

```typescript
interface SectionProfile {
  type: string;              // Section type
  phrasesPerSection: number; // Actual phrase count (randomized between min/max)
  bpmScale: number;          // BPM multiplier
  dynamics: string;          // Dynamics for this section
  motif: number[] | null;    // Motif note offsets
}
```

### Functions

#### `normalizeSectionType(entry?)`

Normalize a section type definition to consistent format with defaults.

**Example:**
```typescript
const normalized = normalizeSectionType({
  type: 'verse',
  phrases: { min: 2, max: 4 },
  bpmScale: 1.0,
  dynamics: 'mf'
});
```

#### `selectSectionType()`

Randomly select a section type from global SECTION_TYPES based on weights.

#### `resolveSectionProfile(sectionType?)`

Resolve a section profile from a section type, randomizing phrase count within range.

---

## Global Integration

Functions are exposed on `globalThis`:

```typescript
globalThis.normalizeSectionType = normalizeSectionType;
globalThis.selectSectionType = selectSectionType;
globalThis.resolveSectionProfile = resolveSectionProfile;
```

---

## Usage Example

```typescript
import { resolveSectionProfile, selectSectionType } from '../src/structure';

// Use in composition loop:
const sectionType = selectSectionType();
const profile = resolveSectionProfile(sectionType);

console.log(`Section: ${profile.type}`);
console.log(`Phrases: ${profile.phrasesPerSection}`);
console.log(`BPM Scale: ${profile.bpmScale}`);
console.log(`Dynamics: ${profile.dynamics}`);
```

---

## Configuration via Globals

Define sections in backstage.js or globals:

```typescript
globalThis.PHRASES_PER_SECTION = { min: 2, max: 4 };
globalThis.SECTION_TYPES = [
  { type: 'intro', weight: 1, bpmScale: 0.8, dynamics: 'pp', phrases: { min: 1, max: 2 } },
  { type: 'verse', weight: 3, bpmScale: 1.0, dynamics: 'mf', phrases: { min: 2, max: 4 } },
  { type: 'chorus', weight: 2, bpmScale: 1.2, dynamics: 'f', phrases: { min: 3, max: 5 }, motif: [0, 2, 4] },
  { type: 'outro', weight: 1, bpmScale: 0.6, dynamics: 'pp', phrases: { min: 1, max: 2 } }
];
```

---

## Related Modules

- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Calls resolveSectionProfile per section
- sheet.ts ([code](../src/sheet.ts)) ([doc](sheet.md)) - Maps sections to note arrays
- backstage.ts ([code](../src/backstage.ts)) ([doc](backstage.md)) - Provides SECTION_TYPES global
