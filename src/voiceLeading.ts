// voiceLeading.ts - Voice leading optimization and scoring

// Import and re-export the VoiceLeadingScore implementation
export { VoiceLeadingScore, default } from './voiceLeading/VoiceLeadingScore.js';

// Export to globalThis for backward compatibility
import { VoiceLeadingScore } from './voiceLeading/VoiceLeadingScore.js';
(globalThis as any).VoiceLeadingScore = VoiceLeadingScore;
