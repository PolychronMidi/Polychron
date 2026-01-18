<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# sheet.ts - Notation Helpers

> **Status**: Utility  
> **Dependencies**: `structure.ts`, `playNotes.ts`


## Overview

`sheet.ts` provides lightweight helpers to map composition structures into staff-like representations and feed them into note rendering utilities. It exports type aliases and wrapper functions to keep sheet rendering in sync with structure definitions.

**Core Responsibilities:**
- Expose sheet/section types consumed by composers
- Provide factory helpers that translate structured sections into note events
- Keep notation helpers aligned with `structure.ts` abstractions

---

## API Highlights

This module is intentionally thin. Key exports include:

- `Sheet` / `SheetSection` types (re-exported from `structure.ts`)
- `sheetSectionsToNotes(sections, ctx)` – map sheet sections to playable notes
- `playSheetSections(sections, ctx)` – convenience wrapper that renders directly

---

## Usage Example

```typescript
import { playSheetSections } from '../src/sheet';

playSheetSections([{ name: 'A', notes: [...] }], ctx);
```

---

## Related Modules

- structure.ts ([code](../src/structure.ts)) ([doc](structure.md)) - Defines sheet/section shapes
- playNotes.ts ([code](../src/playNotes.ts)) ([doc](playNotes.md)) - Executes note rendering
- writer.ts ([code](../src/writer.ts)) ([doc](writer.md)) - Writes MIDI using rendered notes
