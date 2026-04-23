"use strict";
// Router barrel — types and re-exports from split modules.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAdapter = exports.getAdapterForRoute = exports.hybridAdapter = exports.llamacppAdapter = exports.claudePtyAdapter = exports.claudeAdapter = exports.makeResult = exports.wrapLegacyStream = exports.streamHybrid = exports.logShimError = exports.isHmeShimReady = exports.postNarrative = exports.reindexFiles = exports.postTranscript = exports.auditChanges = exports.validateMessage = exports.enrichPrompt = exports.fetchHmeContext = exports.GPU_NUM_CTX = exports.streamLlamacppAgentic = exports.streamLlamacpp = exports.streamClaudePty = exports.streamClaude = void 0;
// Re-export all functions from split modules so existing imports from "./router" keep working.
var routerClaude_1 = require("./routers/routerClaude");
Object.defineProperty(exports, "streamClaude", { enumerable: true, get: function () { return routerClaude_1.streamClaude; } });
Object.defineProperty(exports, "streamClaudePty", { enumerable: true, get: function () { return routerClaude_1.streamClaudePty; } });
var routerLlamacpp_1 = require("./routers/routerLlamacpp");
Object.defineProperty(exports, "streamLlamacpp", { enumerable: true, get: function () { return routerLlamacpp_1.streamLlamacpp; } });
Object.defineProperty(exports, "streamLlamacppAgentic", { enumerable: true, get: function () { return routerLlamacpp_1.streamLlamacppAgentic; } });
Object.defineProperty(exports, "GPU_NUM_CTX", { enumerable: true, get: function () { return routerLlamacpp_1.GPU_NUM_CTX; } });
var routerHme_1 = require("./routers/routerHme");
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
var RouterInterface_1 = require("./routers/RouterInterface");
Object.defineProperty(exports, "wrapLegacyStream", { enumerable: true, get: function () { return RouterInterface_1.wrapLegacyStream; } });
Object.defineProperty(exports, "makeResult", { enumerable: true, get: function () { return RouterInterface_1.makeResult; } });
// Concrete adapters — one per backend, all normalized through the
// RouterAdapter interface. Use getAdapterForRoute() + runAdapter().
var adapters_1 = require("./routers/adapters");
Object.defineProperty(exports, "claudeAdapter", { enumerable: true, get: function () { return adapters_1.claudeAdapter; } });
Object.defineProperty(exports, "claudePtyAdapter", { enumerable: true, get: function () { return adapters_1.claudePtyAdapter; } });
Object.defineProperty(exports, "llamacppAdapter", { enumerable: true, get: function () { return adapters_1.llamacppAdapter; } });
Object.defineProperty(exports, "hybridAdapter", { enumerable: true, get: function () { return adapters_1.hybridAdapter; } });
Object.defineProperty(exports, "getAdapterForRoute", { enumerable: true, get: function () { return adapters_1.getAdapterForRoute; } });
Object.defineProperty(exports, "runAdapter", { enumerable: true, get: function () { return adapters_1.runAdapter; } });
