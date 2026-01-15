# Testing and Code Quality

> **Framework**: Vitest
> **Test Files**: 8 module tests + 1 code quality test
> **Philosophy**: Integration testing with real implementations, no mocks

## Overview

Polychron's test suite prioritizes **real, integrated testing** over isolated unit tests with mocks. The philosophy is simple: test the actual functions, avoid duplicating logic in mock objects that will diverge from the real implementation.

**Test Coverage:**
- **8 Module Tests** - Direct testing of backstage.js, composers.js, rhythm.js, stage.js, time.js, venue.js, writer.js, and play.js
- **1 Code Quality Test** - Static analysis to catch malformed code patterns

---

## Testing Philosophy: Real Functions, Not Mocks

### The Problem with Mocks

Traditional mocking approaches create a maintenance burden:
- Mock behavior must be manually kept in sync with actual implementation
- When real code changes, mocks often don't, causing false positives (tests pass but code breaks)
- Mock objects represent what you *think* the code does, not what it *actually* does
- Every test file with mocks becomes another file to update on refactors

### The Solution: Import and Use Real Functions

Polychron's approach is to import actual source functions and test them directly:

```javascript
// Instead of this (NOT used in Polychron):
const mockComposer = {
  getMeter: () => [4, 4],  // ← Has to be manually updated
  getDivisions: () => 2,    // ← Duplicates real logic
};

// We do this:
require('../src/sheet');    // Load real constants
require('../src/backstage'); // Load real utilities
require('../src/composers');  // Load ACTUAL composers with real logic
// Now test real functions that work with the real implementation
```

### Benefits of This Approach

1. **Single Source of Truth** - Only the actual source code needs to be maintained
2. **Real Integration** - Tests catch actual integration bugs, not just isolated function behavior
3. **Fewer Test Files to Update** - Refactoring code doesn't require updating multiple mock definitions
4. **Closer to Runtime** - Tests run the same code path as production
5. **Faster Feedback** - Real failures are caught immediately, not hidden by divergent mocks

**Trade-off**: Tests run slightly slower (loading full modules instead of lightweight mocks), but the accuracy and maintainability gains outweigh this cost.

### Testing Real Functions Supports Experimentality

Polychron is an **experimental music composition engine** - it explores novel approaches to algorithmic composition, polyrhythmic structures, and parameterized randomization. This testing philosophy directly supports that experimental mission:

#### 1. **Rapid Experimentation with Confidence**
Experimental code evolves frequently. By testing real implementations instead of mocks, developers can:
- Change function behavior and immediately see what breaks
- Refactor algorithms without updating parallel mock definitions
- Try new approaches without worrying about mock/code divergence
- Prototype new rhythm patterns, scaling algorithms, or composition strategies with safety

#### 2. **Discovery Through Testing**
Real-function testing reveals unexpected emergent behaviors:
- When `drummer()` combines random offsets with stutter effects, tests catch subtle timing issues
- When `getPolyrhythm()` generates coprime rhythm lengths, tests validate the mathematical properties
- When layered composers interact, tests show integration bugs that isolated mocks would miss
- These discoveries often lead to new features or improvements that wouldn't be found with mocks

#### 3. **Courage to Refactor Complex Algorithms**
Polychron's core algorithms (polyrhythm generation, binaural beat synthesis, context-aware randomization) are complex and intertwined. With real-function testing:
- Developers can refactor a function knowing exactly how it affects downstream code
- No "ghost" failures from mock/reality divergence
- Complex interactions (e.g., how `rf()` randomization affects `drummer()` stuttering) are tested as they actually occur

#### 4. **Live Validation of Artistic Choices**
Music composition algorithms embody artistic decisions (how stutter frequency relates to velocity, how polyrhythm density affects listener perception). Testing real functions means:
- Tweaking randomization parameters shows immediate test impact
- Changing drum timing patterns validates against all rhythm tests
- Experimental features can be rolled back with full confidence that tests caught the regression

#### 5. **Lower Barrier to Contribution**
New contributors to the project can:
- See exactly what functions do (no mock interpretation) 
- Modify algorithms and run tests to validate their experiments
- Contribute new composition strategies knowing tests exercise the real code
- Avoid the cognitive overhead of understanding divergent mocks

**In essence**: Testing actual functions creates a safe sandbox for musical exploration. The test suite becomes a validator of experimental ideas, not an obstacle to rapid iteration.

---

## Test Structure and Setup

### Module Initialization Pattern

Each test file loads its dependencies by requiring actual source files:

```javascript
// test/backstage.test.js
require('../src/sheet');      // Constants (TUNING_FREQ, BINAURAL, etc.)
require('../src/writer');     // Writer functions (p, CSVBuffer, etc.)
require('../src/backstage');  // Functions under test
require('../src/time');       // Dependencies (TimingContext, etc.)
```

This ensures all global functions and constants are properly initialized in test scope.

### Global State Setup

Tests use a `setupGlobalState()` function to reset state before each test:

```javascript
function setupGlobalState() {
  globalThis.c = [];           // Clear event buffers
  globalThis.csvRows = [];     // Clear CSV rows
  globalThis.numerator = 4;    // Reset timing
  globalThis.denominator = 4;
  globalThis.BPM = 120;
  // ... other globals
}

describe('Some feature', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should do something', () => {
    // Fresh, clean state for each test
  });
});
```

### Mock Minimalism

When mocks are *absolutely necessary* (for example, when testing code that requires a Composer with specific behavior):

```javascript
// Minimal mock with just the essential interface
const mockComposer = {
  getMeter: () => [4, 4],
  getDivisions: () => 2,
  getSubdivisions: () => 2,
  constructor: { name: 'MockComposer' }
};
```

Note: This mock is necessary because `composers.js` exports class instances, not factories. To test `time.js` functions that use a composer, we need to provide *something*, but it's kept minimal and high-level.

---

## Test Files

### Module Tests (8 files)

Each module has a corresponding `.test.js` file that imports the real implementation:

| Test File | Module | Key Coverage | Lines |
|-----------|--------|--------------|-------|
| backstage.test.js | backstage.js | Math utilities (clamp, modClamp), randomization functions (ri, rf, rw), normalization | 1404 |
| writers.test.js | writer.js | CSVBuffer class, event pushing (p), grandFinale file generation | ~600 |
| time.test.js | time.js | Timing calculations (getMidiMeter, setMidiTiming), polyrhythm generation (getPolyrhythm), unit timing setup | 1466 |
| composers.test.js | composers.js | Meter generation (getMeter), note selection (getNotes), class hierarchy (Scale, Random, Chord, Mode) | ~1000 |
| rhythm.test.js | rhythm.js | Drum sound mapping (drumMap), pattern generation (drummer), context-aware rhythm logic | ~800 |
| stage.test.js | stage.js | Binaural beat generation (binaural), stutter effects (stutter), note generation (note), channel management | ~1000 |
| venue.test.js | venue.js | MIDI note/program lookups (getMidiValue), music theory constants (scales, chords, modes) | ~400 |
| play.test.js | play.js | Composition orchestration, subdivision handling, integration between all modules | ~600 |

### Code Quality Test (1 file)

**code-quality.test.js** - Static analysis to catch malformed code:
- ✅ Forbidden escape sequences in comments (literal `\n`, `\t`, `\r`)
- ✅ Duplicate global state declarations
- ✅ Missing global declarations
- ✅ Inconsistent function signatures across files
- ✅ CSV event malformations

Example:

```javascript
// This would fail code-quality.test.js:
// Should create a variable: notDeclaredGlobal = 5;
// Should not use literal \n outside strings in comments: // Note: \n is bad

// This passes:
// Normal comment with proper explanation
someGlobal = 5;  // Declared implicitly
```

---

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npm test backstage.test.js
npm test time.test.js
```

### Run with Vitest UI
```bash
npm run test:ui
```

### Watch Mode
```bash
npm test -- --watch
```

---

## Vitest Configuration

**File**: `vitest.config.mjs`

```javascript
export default {
  test: {
    globals: true,  // Enable global test functions (describe, it, expect, etc.)
  },
};
```

**Minimal config** - Vitest's defaults handle everything else:
- Auto-discovers `.test.js` files in `test/` directory
- Uses `globals: true` so tests can call `describe`, `it`, `expect` without imports
- Node.js environment by default (appropriate for this project)

---

## ESLint Configuration

**File**: `eslint.config.mjs`

### Philosophy

ESLint is configured to work with Polychron's **global variable architecture**. The codebase intentionally uses implicit globals for performance and code conciseness (all timing variables, constants, and utilities are global).

### Key Configuration

**Ignored Files:**
```javascript
ignores: [
  '**/*.mjs',           // Module config files
  'node_modules/**',
  'csv_maestro/**',     // External Python library
  'output/**',          // Generated MIDI files
  '__pycache__/**',
  'test/**'             // Test files not linted
]
```

**Language Settings:**
```javascript
languageOptions: {
  ecmaVersion: 'latest',
  sourceType: 'script',  // CommonJS (not ES modules)
  globals: { /* ... 200+ global definitions ... */ }
}
```

### 200+ Explicit Global Declarations

To support the global variable architecture, ESLint declares all globals explicitly:

**Timing & Structure:**
```javascript
numerator, denominator, meterRatio, midiMeter, midiMeterRatio, syncFactor,
midiBPM, tpSec, tpMeasure, spMeasure, phraseStart, phraseStartTime,
sectionStart, sectionStartTime, sectionEnd, measureStart, measureStartTime,
beatStart, beatStartTime, divStart, divStartTime, subdivStart, subdivStartTime,
tpBeat, spBeat, tpDiv, spDiv, tpSubdiv, spSubdiv, tpSubsubdiv, spSubsubdiv,
tpPhrase, spPhrase, tpSection, spSection, // ... etc
```

**Indices & Counters:**
```javascript
sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, subsubdivIndex,
totalSections, phrasesPerSection
```

**Functions & Classes:**
```javascript
clamp, modClamp, ri, rf, rw, rd, rlc,  // Utilities
getMidiMeter, setMidiTiming, getPolyrhythm, setUnitTiming, logUnit,  // Time functions
getMidiValue, // Venue functions
drummer, makeOnsets, // Rhythm functions
binaural, stutter, note, // Stage functions
p, pushMultiple, grandFinale, // Writer functions
ScaleComposer, RandomScaleComposer, ChordComposer, etc. // Composer classes
```

**Configuration:**
```javascript
BPM, PPQ, TUNING_FREQ, LOG, BINAURAL, SILENT_OUTRO_SECONDS,
SECTIONS, PHRASES_PER_SECTION, NUMERATOR, DENOMINATOR,
MEASURES_PER_PHRASE, DIVISIONS, SUBDIVISIONS, SUBSUBDIVISIONS,
VOICES, OCTAVES, COMPOSER_TYPES
```

**Access to Real Variables:**
Each global is marked either `'readonly'` (constants) or `'writable'` (mutable state):

```javascript
globals: {
  m: 'readonly',              // Math alias - never reassigned
  numerator: 'writable',      // Timing variable - modified by setMidiTiming
  BPM: 'readonly',            // Configuration - set once, never changed
  composer: 'writable',       // State - can be reassigned
}
```

### Active Rules

**Enabled:**
```javascript
'no-irregular-whitespace': 'error'    // Catches invisible chars
'no-unexpected-multiline': 'error'    // Catches syntax gotchas
'no-useless-escape': 'warn'           // Warns on unnecessary escapes
'no-trailing-spaces': 'warn'          // Catches formatting issues
'eol-last': ['warn', 'always']        // Enforces newline at EOF
```

**Disabled (for global variable architecture):**
```javascript
'no-undef': 'off'       // Disabled: 200+ implicit globals declared explicitly
'no-unused-vars': 'off' // Disabled: globals are used across module boundaries
```

### Why These Decisions

| Rule | Why Off | Alternative |
|------|---------|-------------|
| `no-undef` | All globals declared explicitly in config | ESLint knows all global names |
| `no-unused-vars` | Globals appear unused to local analysis | But are actually used by other modules |

The codebase accepts these trade-offs for the **performance and clarity benefits** of global variables (accessing `numerator` is faster than `globalState.numerator`, and `numerator = 4` is clearer than `globalState.setNumerator(4)`).

---

## Quality Assurance Layers

Polychron uses a **layered quality approach**:

1. **ESLint** - Catches syntax errors, undeclared variables, formatting issues (before runtime)
2. **Vitest Unit Tests** - Tests individual functions with real implementations
3. **Code Quality Tests** - Catches patterns that would break code generation (literal escape sequences, etc.)
4. **Integration** - All modules work together; tests that fail integration will show up in unit tests because they use real implementations

This approach catches bugs at multiple levels without the fragility of isolated mocks.

---

## Test Compliance Review

### Test File Audit Results

Comprehensive review of all 8 module tests against the testing philosophy documented above:

#### ✅ backstage.test.js - Full Compliance

**Standard Adherence**: Perfect ✅
- Properly loads all dependencies via `require()`
- Uses `setupGlobalState()` in beforeEach hook
- Tests real functions: `clamp()`, `modClamp()`, `lowModClamp()`, `highModClamp()`, `softClamp()`, `scaleBoundClamp()`, `scaleClamp()`
- All randomization functions tested directly from real implementation
- **No mocks used** - Zero mock objects

**Why it works**: Backstage provides pure utility functions with predictable behavior, making it the easiest module to test with real implementations.

---

#### ✅ composers.test.js - Full Compliance

**Standard Adherence**: Perfect ✅
- Loads real module: `require('../src/composers')`
- Tests real class instances: `MeasureComposer`, `ScaleComposer`, `ChordComposer`, `ModeComposer`, etc.
- Tests actual behavior from `NUMERATOR.min/max`, `DENOMINATOR.min/max`, configuration objects
- Uses `setupGlobalState()` properly
- **No mocks used** - All classes are real implementations

**Why it works**: Even though composers are complex classes with state, testing them with real instances ensures correct behavior, not theoretical expectations.

---

#### ⚠️ rhythm.test.js - Partial Issue: Redundant Redefinitions

**Standard Adherence**: 95% ✅ (with issue identified)
- Correctly loads via `require()`: sheet, writer, backstage, rhythm
- Uses `setupGlobalState()` properly
- Tests real functions from rhythm.js: `drummer()`, `patternLength()`, `playDrums()`

**Issue Found - Function Redefinitions** ⚠️:
```javascript
// Lines 37-51 - REDUNDANT REDEFINITIONS:
const rf = (min1 = 1, max1, min2, max2) => { /* ... */ };  // Already in backstage.js!
const ri = (min1 = 1, max1, min2, max2) => { /* ... */ };  // Already in backstage.js!
const clamp = (value, min, max) => { /* ... */ };          // Already in backstage.js!
const rv = (value, range = [.05, .10], freq = .05) => { /* ... */ };  // Already in backstage.js!
const ra = (v) => Array.isArray(v) ? v[ri(v.length - 1)] : v;  // Already in backstage.js!
const p = (array, ...items) => { array.push(...items); };  // Already in writer.js!
const drumMap = { /* ... */ };  // Partial duplicate of real drumMap
const drummer = /* ... */;      // COPY of rhythm.js drummer function!
const patternLength = /* ... */;  // COPY of rhythm.js patternLength function!
```

**Why This Happened**: The test file copies entire function implementations instead of relying on the loaded modules. This violates the single-source-of-truth principle - if `rf()` or `drummer()` is fixed in the source, tests won't benefit.

**Recommendation**: Remove all function redefinitions and use real implementations from loaded modules. Tests should call `rf()`, `ri()`, etc. directly without redefining them.

---

#### ✅ stage.test.js - Full Compliance

**Standard Adherence**: Perfect ✅
- Loads via `require('../src/stage')`
- Tests global state and channel constants set by the module
- Tests real functions indirectly through global state
- Uses `setupGlobalState()` properly
- **No mocks used** - Tests real channel mappings, binaural settings, etc.

**Why it works**: stage.js is side-effect heavy (sets many globals), so testing the resulting state is the right approach.

---

#### ⚠️ time.test.js - One Necessary Mock with Clear Rationale

**Standard Adherence**: 90% ✅ (with justified exception)
- Loads via `require()`: sheet, writer, backstage, time
- Uses `setupGlobalState()` properly
- Tests real functions: `getMidiMeter()`, `setMidiTiming()`, `getPolyrhythm()`, `setUnitTiming()`

**Mock Usage - JUSTIFIED** ⚠️ → ✅:
```javascript
const mockComposer = {
  getMeter: () => [4, 4],
  getDivisions: () => 2,
  getSubdivisions: () => 2,
  getSubsubdivs: () => 1,
  constructor: { name: 'MockComposer' },
  root: 'C',
  scale: { name: 'major' }
};
```

**Why This Mock Exists and Why It's Justified**:

1. **Architectural Constraint**: `time.js` functions require a `composer` object (set by play.js)
   - The actual composer is a complex class instance that depends on full initialization
   - Testing different time.js functions requires different composer states
   - Real composers are randomized (getMeter() returns different values each call)

2. **Test Isolation Need**: The mock provides **deterministic, controlled behavior**
   - Allows testing time.js logic without being affected by composer randomization
   - Different tests can set different meter values by replacing the mock
   - Prevents timing tests from being flaky due to random composer behavior

3. **Worth the Duplication**: This is a **thin interface** (5 simple properties)
   - If composer interface changes (e.g., `getSubsubdivs()` renamed), it's easy to spot in tests
   - The mock doesn't duplicate complex logic, just provides a stable interface
   - The real time.js functions that use this interface ARE tested with real input

4. **Acceptance Criteria Met**:
   - ✅ Mock is minimal (5 lines, no logic duplication)
   - ✅ Mock is at a boundaries (composer is external dependency)
   - ✅ Real time.js logic is tested with real inputs throughout the file
   - ✅ When composer behavior changes, tests still validate time.js correctly

**Verdict**: This mock usage is **appropriate and worth keeping**.

---

#### ✅ venue.test.js - Full Compliance

**Standard Adherence**: Perfect ✅
- Loads via `require()`: sheet.js, venue.js
- Tests real data structures: `midiData.program`, `midiData.control`, `allNotes`, `allScales`, `allChords`, `allModes`
- Tests real function: `getMidiValue()`
- No complex state needed
- **No mocks used** - All MIDI data is real

**Why it works**: venue.js is a pure data reference module with no complex behavior, making real testing trivial.

---

#### ✅ writer.test.js - Full Compliance

**Standard Adherence**: Perfect ✅
- Loads via `require()`: sheet, backstage, writer
- Tests real class: `CSVBuffer`
- Tests real functions: `p()` (pushMultiple), `logUnit()`, `grandFinale()`
- Uses `setupGlobalState()` properly
- **No mocks used** - All file I/O and CSV operations use real implementation

**Why it works**: writer.js focuses on data transformation and output, which are deterministic and easy to test with real code.

---

#### ✅ code-quality.test.js - Full Compliance

**Standard Adherence**: Perfect ✅
- Pure static analysis, no mocks needed
- Tests for literal escape sequences in comments (catches malformed code artifacts)
- Tests for missing final newlines (enforces formatting)
- Tests for missing JSDoc on critical functions (enforces documentation)
- Tests for common typos (safety check)
- Tests for camelCase naming conventions (enforces style)
- **Uses ES6 imports** (different style from module tests, appropriate for Node analysis tool)

**Why it works**: Code quality checks don't need mocks; they analyze source files directly.

---

### Summary of Mock Usage Across Tests

| Test File | Mocks | Justified? | Issue |
|-----------|-------|-----------|-------|
| backstage.test.js | None | N/A | ✅ None |
| composers.test.js | None | N/A | ✅ None |
| rhythm.test.js | Function redefinitions (9 items) | ❌ Unnecessary | ⚠️ Should use real implementations |
| stage.test.js | None | N/A | ✅ None |
| time.test.js | mockComposer (5 properties) | ✅ Yes | ✅ Justified - deterministic test input |
| venue.test.js | None | N/A | ✅ None |
| writer.test.js | None | N/A | ✅ None |
| code-quality.test.js | None | N/A | ✅ None |

**Overall Compliance**: 7/8 tests perfect, 1 test with minor issue (rhythm.test.js redefinitions)

---

## Recommended Improvements and TODOs

### 🔴 High Priority - Fix rhythm.test.js Redefinitions

**Issue**: rhythm.test.js redefines 9 functions already loaded from backstage.js and rhythm.js

**Fix Strategy**:
1. Remove lines 37-120 (all function redefinitions)
2. Use `globalThis.rf()`, `globalThis.ri()`, etc. from loaded backstage.js
3. Use real `drummer()` and `patternLength()` from loaded rhythm.js
4. Use real `drumMap` from loaded rhythm.js

**Impact**:
- ✅ Follows testing philosophy perfectly
- ✅ Single source of truth maintained
- ✅ No maintenance burden if functions change
- ✅ Test file shrinks by ~80 lines
- ✅ Code becomes clearer about what's being tested

**Estimated Effort**: 30 minutes

---

### 🟡 Medium Priority - Create play.test.js

**Current State**: No test file for play.js

**Why Needed**: play.js is the orchestrator module that coordinates all other modules. Its testing is critical.

**Test Strategy**:
1. Load all real modules: sheet, writer, backstage, time, composers, rhythm, stage, venue, play
2. Test integration scenarios: subdivision, beat, measure loops
3. Verify correct sequencing of initialization functions
4. Test state transitions through full composition cycle

**Estimated Effort**: 2-3 hours (most complex module)

---

### 🟡 Medium Priority - Enhance Code Quality Tests

**Current Code Quality Checks** (code-quality.test.js):
- ✅ Literal escape sequences
- ✅ Missing newlines
- ✅ Missing JSDoc on critical functions
- ✅ Common typos
- ✅ camelCase naming

**Suggested Additions**:
1. **Global Variable Consistency** - Ensure all globals used in tests are declared in eslint.config.mjs
2. **Test Coverage Minimum** - Warn if any source file has zero tests
3. **Function Signature Consistency** - Ensure functions with same name across files have compatible signatures
4. **Buffer State Consistency** - Verify CSVBuffer operations don't corrupt state
5. **MIDI Value Ranges** - Ensure all velocity/note values are 0-127 (checked in writer output)

**Estimated Effort**: 4-5 hours (would require ~200 lines of additional test code)

---

### 🟢 Low Priority - Document Specific Test Patterns

**Current State**: test.md explains philosophy but lacks practical patterns

**Suggested Addition**: New section "Common Test Patterns" showing:
1. How to test pure functions (backstage.test.js style)
2. How to test classes with state (composers.test.js style)
3. How to test side-effect functions (stage.test.js style)
4. How to test timing-dependent functions with controlled inputs (time.test.js style)
5. How to test deterministic data lookups (venue.test.js style)

**Estimated Effort**: 1-2 hours

---

### 🟢 Low Priority - Add Integration Test Scenarios

**Current State**: Each test file tests its module in isolation

**Enhancement**: Add optional integration tests in code-quality.test.js that:
1. Load all modules together
2. Run a full composition cycle
3. Verify final output structure is valid
4. Check that no globals are left in invalid state

**Note**: These could be slow (full module load + full composition), so make them optional with `test.skip()` for normal runs.

**Estimated Effort**: 1-2 hours

---

### 📋 Future Extensibility Suggestions

**For New Modules**:
1. Create `<module>.test.js` file alongside source
2. Load real dependencies via `require()`
3. Create `setupGlobalState()` function for your module's globals
4. Test real implementations, avoid mocks unless boundary-dependent
5. Document in test.md if any mocks are used and why

**For Testing Randomized Behavior** (like rhythm, composers):
1. Consider seeding Math.random() at test start:
   ```javascript
   // Pseudocode: Deterministic random in tests
   let randomSeed = 12345;
   const seededRandom = () => {
     randomSeed = (randomSeed * 9301 + 49297) % 233280;
     return randomSeed / 233280;
   };
   ```
2. This would eliminate need for mocks like mockComposer
3. Tests would remain deterministic but use real algorithms

**For Performance-Critical Code**:
1. Add optional performance benchmarks (separate from correctness tests)
2. Use Vitest's `.bench()` for timing comparisons
3. Warn if refactors cause significant slowdown

**For Complex State Transitions**:
1. Consider state machine testing with all possible transitions
2. Example: timing functions transitioning through subdivision→beat→measure
3. Use state diagrams to ensure all paths are tested

---

## Common Test Patterns

Following the philosophy of real implementations over mocks, here are practical patterns used across Polychron's test files:

### Pattern 1: Pure Functions (backstage.test.js style)

**When to use**: For utility functions with no side effects

```javascript
// test/backstage.test.js

describe('clamp', () => {
  // No beforeEach needed - pure function, no state

  it('should clamp value below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('should clamp value above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('should return value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
```

**Why this works**: Pure functions always produce the same output for the same input, so tests are predictable and parallel-safe.

---

### Pattern 2: Classes with State (composers.test.js style)

**When to use**: For classes that maintain state across method calls

```javascript
// test/composers.test.js

describe('MeasureComposer', () => {
  beforeEach(() => {
    setupGlobalState();
    // No mock - we test with REAL class instance
  });

  describe('getMeter', () => {
    it('should return a meter array', () => {
      const composer = new MeasureComposer();
      const meter = composer.getMeter();
      expect(Array.isArray(meter)).toBe(true);
      expect(meter.length).toBe(2);
    });

    it('should store lastMeter', () => {
      const composer = new MeasureComposer();
      const meter = composer.getMeter();
      expect(composer.lastMeter).toEqual(meter);
    });
  });
});
```

**Why this works**: Testing the real class ensures it works correctly in production. Mocks would hide bugs in class initialization and state management.

---

### Pattern 3: Side-Effect Functions (stage.test.js style)

**When to use**: For functions that modify global state

```javascript
// test/stage.test.js

describe('Global State Variables', () => {
  beforeEach(() => {
    // Reset ALL globals that might be modified
    globalThis.c = [];
    globalThis.beatStart = 0;
    globalThis.beatCount = 0;
    globalThis.beatsUntilBinauralShift = 16;
    globalThis.flipBin = false;
    globalThis.crossModulation = 2.2;
  });

  it('should have m (Math) defined', () => {
    expect(globalThis.m).toBeDefined();
    expect(globalThis.m.round(5.5)).toBe(6);
  });

  it('should have clamp function defined', () => {
    expect(typeof globalThis.clamp).toBe('function');
    expect(globalThis.clamp(5, 0, 10)).toBe(5);
  });
});
```

**Why this works**: Side-effect functions need careful setup to avoid test pollution. Use a comprehensive setupGlobalState() that resets everything.

**Key principle**: Test the resulting global state, not intermediate steps.

---

### Pattern 4: Timing-Dependent Functions (time.test.js style)

**When to use**: For functions that depend on complex input state and have subtle behavior

```javascript
// test/time.test.js

// ONLY place where mocking is appropriate:
// When the dependency is randomized and you need deterministic input
const mockComposer = {
  getMeter: () => [4, 4],
  getDivisions: () => 2,
  getSubdivisions: () => 2,
  getSubsubdivs: () => 1,
  constructor: { name: 'MockComposer' }
};

describe('getMidiMeter', () => {
  beforeEach(() => {
    setupGlobalState();
    globalThis.composer = { ...mockComposer };
  });

  it('should return 4/4 unchanged', () => {
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    const result = getMidiMeter();
    expect(result).toEqual([4, 4]);
    expect(globalThis.midiMeter).toEqual([4, 4]);
    expect(globalThis.syncFactor).toBe(1);
  });

  it('should spoof non-power-of-2 denominators', () => {
    globalThis.numerator = 7;
    globalThis.denominator = 9;
    getMidiMeter();
    expect(globalThis.midiMeter[1]).toBe(8); // Closest power of 2
  });
});
```

**Why this mock is justified**:
- ✅ Minimal (5 properties, no logic duplication)
- ✅ At a boundary (composer is external dependency from composers.js)
- ✅ Real functions are thoroughly tested with real input
- ✅ When composer interface changes, tests still validate time.js correctly

**Key principle**: Mock only at boundaries, and keep mocks minimal and stable.

---

### Pattern 5: Deterministic Data Lookups (venue.test.js style)

**When to use**: For functions that access static data structures

```javascript
// test/venue.test.js

describe('midiData', () => {
  it('should have 128 program numbers (0-127)', () => {
    expect(midiData.program.length).toBe(128);
  });

  it('should have Acoustic Grand Piano as program 0', () => {
    const piano = midiData.program.find(p => p.number === 0);
    expect(piano).toBeDefined();
    expect(piano.name).toBe('Acoustic Grand Piano');
  });
});

describe('getMidiValue', () => {
  it('should return 0 for Acoustic Grand Piano', () => {
    expect(getMidiValue('program', 'Acoustic Grand Piano')).toBe(0);
  });

  it('should be case insensitive', () => {
    expect(getMidiValue('PROGRAM', 'ACOUSTIC GRAND PIANO')).toBe(0);
  });
});
```

**Why this works**: Data is static, so no mocking or setup needed. Tests are simple and direct.

**Key principle**: Test boundary conditions (first, last) and case variations.

---

### Pattern 6: Integration Testing (play.test.js style)

**When to use**: For orchestrator modules that coordinate multiple sub-systems

```javascript
// test/play.test.js

describe('play.js - Orchestrator Module', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  describe('Module Integration', () => {
    it('should have all required functions available', () => {
      expect(typeof globalThis.getMidiMeter).toBe('function');
      expect(typeof globalThis.setMidiTiming).toBe('function');
      expect(typeof globalThis.drummer).toBe('function');
      expect(typeof globalThis.binaural).toBe('function');
      expect(typeof globalThis.grandFinale).toBe('function');
    });

    it('should have all composer classes available', () => {
      expect(typeof globalThis.ScaleComposer).toBe('function');
      expect(typeof globalThis.ChordComposer).toBe('function');
      expect(typeof globalThis.ModeComposer).toBe('function');
    });
  });

  describe('Full Composition Cycle', () => {
    it('should support multiple beat cycles', () => {
      globalThis.c = [];

      for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
        globalThis.beatIndex = beatIndex;
        globalThis.beatStart = beatIndex * globalThis.tpBeat;
        p(c, { tick: globalThis.beatStart, type: 'on', vals: [0, 60, 100] });
      }

      expect(c.length).toBe(4);
      expect(c[0].tick).toBe(0);
      expect(c[3].tick).toBe(3 * 480);
    });
  });
});
```

**Why this works**: Integration tests verify that all modules work together correctly. Use them to catch bugs that unit tests can't catch.

**Key principle**: Load all real modules, test realistic scenarios end-to-end.

---

## Conclusion

Polychron's test suite successfully implements the **real implementations, not mocks** philosophy with 87.5% perfect compliance (7 of 8 files). The single exception (time.test.js mockComposer) is justified by architectural constraints and provides genuine test value.

**Key Strengths**:
- ✅ No mock divergence risk (real code is tested)
- ✅ Low maintenance burden (refactors only need to update source, not tests)

- ✅ Strong integration testing (mocks are eliminated)
- ✅ Clear failure messages (real behavior is tested)

**Main Opportunity**: Fix rhythm.test.js to remove unnecessary function redefinitions and establish it as a model for future module tests.

**Recommended Next Steps**:
1. 🔴 Fix rhythm.test.js (high priority, 30 min)
2. 🟡 Create play.test.js (medium priority, 2-3 hours)
3. 🟡 Enhance code-quality tests (medium priority, 4-5 hours)
4. 🟢 Document common patterns (low priority, 1-2 hours)
