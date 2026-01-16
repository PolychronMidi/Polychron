// voiceLeading.ts - Stub that re-exports from voiceLeading.js
// Full TypeScript migration of voiceLeading.js is deferred
// This stub allows downstream modules to import from .ts

// Import the JavaScript module
import './voiceLeading.js';

// Re-export VoiceLeadingScore class and utilities from global scope
export const VoiceLeadingScore = (globalThis as any).VoiceLeadingScore;
export default VoiceLeadingScore;
