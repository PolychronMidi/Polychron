// voiceLeading.ts - Voice leading optimization and scoring

// Import and re-export the VoiceLeadingScore implementation
export { VoiceLeadingScore, default } from './voiceLeading/VoiceLeadingScore.js';
import { VoiceLeadingScore } from './voiceLeading/VoiceLeadingScore.js';

// Expose to globalThis for backward compatibility
(globalThis as any).VoiceLeadingScore = VoiceLeadingScore;
