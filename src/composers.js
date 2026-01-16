"use strict";
// composers.ts - Stub that re-exports from composers/index.js
// Full TypeScript migration of composers is deferred due to file size (1321 lines)
// This stub allows downstream modules like play.ts and stage.ts to import from .ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.Composer = exports.ComposerFactory = exports.PentatonicComposer = exports.ModeComposer = exports.ChordComposer = exports.ScaleComposer = exports.MeasureComposer = void 0;
// Import the JavaScript module from composers directory
require("./composers/index.js");
// Re-export all composers classes and functions from global scope
exports.MeasureComposer = globalThis.MeasureComposer;
exports.ScaleComposer = globalThis.ScaleComposer;
exports.ChordComposer = globalThis.ChordComposer;
exports.ModeComposer = globalThis.ModeComposer;
exports.PentatonicComposer = globalThis.PentatonicComposer;
exports.ComposerFactory = globalThis.ComposerFactory;
exports.Composer = globalThis.Composer;
//# sourceMappingURL=composers.js.map