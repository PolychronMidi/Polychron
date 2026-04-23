"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorSink = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const router_1 = require("../router");
/**
 * Routes chat-extension errors to BOTH surfaces that monitor project health:
 *   - log/hme-errors.log — scanned by userpromptsubmit.sh + stop.sh (LIFESAVER
 *     turn-level alerts; surfaces to the agent at the next turn boundary)
 *   - worker /error endpoint — feeds worker.recent_errors for sessionstart.sh
 *     (LIFESAVER session-level banner)
 *
 * Prior behavior wrote to the log ONLY on shim-failure. Chat errors landed
 * in worker.recent_errors but never reached LIFESAVER during a session, so
 * the user saw error bubbles in the chat UI while the agent remained blind
 * until session restart. Now BOTH paths fire on every error — the disk log
 * is authoritative, the worker ping is best-effort telemetry.
 */
class ErrorSink {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    post(source, message) {
        // Authoritative: disk log (always). LIFESAVER userpromptsubmit.sh scans
        // this file every turn, so per-turn alerts land here.
        const errLine = `[${new Date().toISOString()}] [${source}] ${message}\n`;
        try {
            fs.mkdirSync(path.join(this.projectRoot, "log"), { recursive: true });
            fs.appendFileSync(path.join(this.projectRoot, "log", "hme-errors.log"), errLine);
        }
        catch (fileErr) {
            console.error(`[HME FAILFAST] disk append failed for [${source}] ${message}: ${fileErr?.message ?? fileErr}`);
        }
        // Best-effort: worker telemetry. Failure is non-fatal since the disk log
        // already captured the error. Catches network/shim-down without masking
        // the real error message.
        (0, router_1.logShimError)(source, message).catch((e) => {
            console.error(`[HME] logShimError telemetry failed for [${source}]: ${e?.message ?? e}`);
        });
    }
}
exports.ErrorSink = ErrorSink;
