"use strict";
// voiceLeading.js - Voice leading optimization and scoring
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceLeadingScore = void 0;

// Import the VoiceLeadingScore implementation
require("./voiceLeading/VoiceLeadingScore.js");

// Re-export VoiceLeadingScore class from global scope
exports.VoiceLeadingScore = globalThis.VoiceLeadingScore;
exports.default = exports.VoiceLeadingScore;
