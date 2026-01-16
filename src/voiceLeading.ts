// voiceLeading.ts - Voice leading optimization and scoring

// Import the VoiceLeadingScore implementation
import './voiceLeading/VoiceLeadingScore.js';

// Re-export VoiceLeadingScore class from global scope
export const VoiceLeadingScore = (globalThis as any).VoiceLeadingScore;
export default VoiceLeadingScore;
