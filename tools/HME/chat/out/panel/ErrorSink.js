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
 * Routes errors to hme-errors.log via the shim, with a disk-fallback cascade
 * if the shim is down. Never surfaces errors to the user UI — they are
 * Claude-facing (read by Lifesaver), not user-facing.
 *
 * Three levels of defense:
 *   1. logShimError (POST to shim /error endpoint)
 *   2. Direct disk append to log/hme-errors.log
 *   3. console.error (stderr of the ext host)
 */
class ErrorSink {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    post(source, message) {
        (0, router_1.logShimError)(source, message).catch((e) => {
            console.error(`[HME FAILFAST] logShimError failed for [${source}] ${message}: ${e?.message ?? e}`);
            const errLine = `[${new Date().toISOString()}] [${source}] ${message}\n`;
            try {
                fs.mkdirSync(path.join(this.projectRoot, "log"), { recursive: true });
                fs.appendFileSync(path.join(this.projectRoot, "log", "hme-errors.log"), errLine);
            }
            catch (fileErr) {
                console.error(`[HME FAILFAST] Disk fallback also failed for [${source}] ${message}: ${fileErr?.message ?? fileErr}`);
            }
        });
    }
}
exports.ErrorSink = ErrorSink;
