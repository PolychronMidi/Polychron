"use strict";
// Router barrel — types and re-exports from split modules.
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamHybrid = exports.logShimError = exports.isHmeShimReady = exports.postNarrative = exports.reindexFiles = exports.postTranscript = exports.auditChanges = exports.validateMessage = exports.enrichPrompt = exports.fetchHmeContext = exports.GPU_NUM_CTX = exports.streamOllamaAgentic = exports.streamOllama = exports.streamClaudePty = exports.streamClaude = void 0;
// Re-export all functions from split modules so existing imports from "./router" keep working.
var routerClaude_1 = require("./routerClaude");
Object.defineProperty(exports, "streamClaude", { enumerable: true, get: function () { return routerClaude_1.streamClaude; } });
Object.defineProperty(exports, "streamClaudePty", { enumerable: true, get: function () { return routerClaude_1.streamClaudePty; } });
var routerOllama_1 = require("./routerOllama");
Object.defineProperty(exports, "streamOllama", { enumerable: true, get: function () { return routerOllama_1.streamOllama; } });
Object.defineProperty(exports, "streamOllamaAgentic", { enumerable: true, get: function () { return routerOllama_1.streamOllamaAgentic; } });
Object.defineProperty(exports, "GPU_NUM_CTX", { enumerable: true, get: function () { return routerOllama_1.GPU_NUM_CTX; } });
var routerHme_1 = require("./routerHme");
Object.defineProperty(exports, "fetchHmeContext", { enumerable: true, get: function () { return routerHme_1.fetchHmeContext; } });
Object.defineProperty(exports, "enrichPrompt", { enumerable: true, get: function () { return routerHme_1.enrichPrompt; } });
Object.defineProperty(exports, "validateMessage", { enumerable: true, get: function () { return routerHme_1.validateMessage; } });
Object.defineProperty(exports, "auditChanges", { enumerable: true, get: function () { return routerHme_1.auditChanges; } });
Object.defineProperty(exports, "postTranscript", { enumerable: true, get: function () { return routerHme_1.postTranscript; } });
Object.defineProperty(exports, "reindexFiles", { enumerable: true, get: function () { return routerHme_1.reindexFiles; } });
Object.defineProperty(exports, "postNarrative", { enumerable: true, get: function () { return routerHme_1.postNarrative; } });
Object.defineProperty(exports, "isHmeShimReady", { enumerable: true, get: function () { return routerHme_1.isHmeShimReady; } });
Object.defineProperty(exports, "logShimError", { enumerable: true, get: function () { return routerHme_1.logShimError; } });
Object.defineProperty(exports, "streamHybrid", { enumerable: true, get: function () { return routerHme_1.streamHybrid; } });
