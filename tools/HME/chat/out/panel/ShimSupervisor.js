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
exports.ShimSupervisor = void 0;
const path = __importStar(require("path"));
const router_1 = require("../router");
const MAX_POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;
const MAX_RESTARTS = 4;
/**
 * Spawns and supervises the HME HTTP shim (mcp/hme_http.py).
 *
 * Lifecycle:
 *   start() — spawn python3, poll /health until ready or MAX_POLL_ATTEMPTS
 *   on("exit") — if it was previously ready, restart after RESTART_DELAY_MS
 *                (unless disposed); if never ready, surface error and stop
 *
 * `failed` flag latches true when a startup poll sequence exhausts without
 * ever seeing /health ready. UI uses this to decide when to stop retrying.
 */
class ShimSupervisor {
    constructor(projectRoot, host) {
        this.projectRoot = projectRoot;
        this.host = host;
        this._proc = null;
        this._failed = false;
        this._pollTimer = null;
        this._disposed = false;
        this._restartCount = 0;
    }
    get failed() {
        return this._failed;
    }
    get isRunning() {
        return this._proc !== null && !this._proc.killed;
    }
    start() {
        if (this.isRunning)
            return;
        if (this._disposed)
            return;
        if (this._restartCount >= MAX_RESTARTS) {
            this.host.post({ type: "hmeShimStatus", ready: false, failed: true });
            this.host.postError("shim", `HME shim restart limit (${MAX_RESTARTS}) reached — restart VS Code to retry`);
            return;
        }
        this._failed = false;
        const shimPath = path.join(__dirname, "..", "..", "..", "mcp", "hme_http.py");
        const env = { ...process.env };
        if (!env["PATH"]?.includes(".local/bin")) {
            env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
        }
        try {
            this._proc = require("child_process").spawn("python3", [shimPath], {
                cwd: this.projectRoot, env, detached: false, stdio: "ignore",
            });
            let started = false;
            this._proc.on("error", (e) => {
                this._proc = null;
                this.host.post({ type: "hmeShimStatus", ready: false });
                this.host.postError("shim", `HME shim failed to start: ${e.message}`);
            });
            this._proc.on("exit", (code) => {
                const wasStarted = started;
                this._proc = null;
                this.host.post({ type: "hmeShimStatus", ready: false });
                if (!wasStarted) {
                    this.host.postError("shim", `HME shim exited before becoming ready (code ${code ?? "?"})`);
                }
                else if (!this._disposed) {
                    this._restartCount++;
                    const delay = Math.min(3000 * Math.pow(2, this._restartCount - 1), 30000);
                    setTimeout(() => { if (!this._disposed)
                        this.start(); }, delay);
                }
            });
            let attempts = 0;
            const poll = () => {
                attempts++;
                (0, router_1.isHmeShimReady)().then(({ ready }) => {
                    if (ready) {
                        started = true;
                        this._restartCount = 0;
                        this._pollTimer = null;
                        this.host.post({ type: "hmeShimStatus", ready: true });
                        return;
                    }
                    if (attempts < MAX_POLL_ATTEMPTS && this._proc) {
                        this.host.post({ type: "hmeShimStatus", ready: false, failed: false });
                        this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
                    }
                    else {
                        this._pollTimer = null;
                        this._failed = true;
                        this.host.post({ type: "hmeShimStatus", ready: false, failed: true });
                        this.host.postError("shim", `HME shim started but /health not ready after ${attempts * (POLL_INTERVAL_MS / 1000)}s` +
                            " — check log/hme-errors.log or run mcp/hme_http.py manually");
                    }
                });
            };
            if (this._pollTimer)
                clearTimeout(this._pollTimer);
            this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        }
        catch (e) {
            this.host.postError("shim", `HME shim spawn error: ${e?.message ?? e}`);
        }
    }
    dispose() {
        this._disposed = true;
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        try {
            this._proc?.kill();
        }
        catch (e) {
            console.error(`[HME] shimProc kill failed: ${e?.message ?? e}`);
        }
        this._proc = null;
    }
}
exports.ShimSupervisor = ShimSupervisor;
