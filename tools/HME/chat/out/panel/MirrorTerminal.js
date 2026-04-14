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
exports.MirrorTerminal = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages an optional side-by-side VS Code terminal running `claude` directly.
 * The hidden node-pty session handles chat rendering independently — this is
 * purely a user-visible companion view, not part of the stream pipeline.
 */
class MirrorTerminal {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this._enabled = false;
    }
    get enabled() {
        return this._enabled;
    }
    setEnabled(enabled, model, effort) {
        this._enabled = enabled;
        if (enabled)
            this._ensure(model, effort);
    }
    _ensure(model, effort) {
        if (this._terminal && !this._terminal.exitStatus) {
            this._terminal.show(true);
            return;
        }
        const args = ["--model", model, "--effort", effort, "--permission-mode", "bypassPermissions"];
        this._terminal = vscode.window.createTerminal({
            name: "HME Claude",
            shellPath: "claude",
            shellArgs: args,
            cwd: this.projectRoot,
        });
        this._terminal.show(true);
    }
}
exports.MirrorTerminal = MirrorTerminal;
