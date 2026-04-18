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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const BrowserPanel_1 = require("./BrowserPanel");
const PORT = Number(process.env["HME_CHAT_PORT"] ?? 3131);
const projectRoot = process.env["HME_PROJECT_ROOT"] ?? process.cwd();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "4mb" }));
// ── Static HTML ──────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
    const htmlPath = path.join(__dirname, "..", "webview", "browser.html");
    res.sendFile(htmlPath);
});
// ── SSE event stream ─────────────────────────────────────────────────────────
app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const panel = BrowserPanel_1.BrowserPanel.createOrShow(projectRoot);
    panel.registerSseClient(res);
    // Send initial session list so the UI boots immediately
    panel.handleMessage({ type: "listSessions" });
    req.on("close", () => {
        panel.unregisterSseClient(res);
    });
});
// ── Message dispatch ─────────────────────────────────────────────────────────
app.post("/api/message", (req, res) => {
    const panel = BrowserPanel_1.BrowserPanel.createOrShow(projectRoot);
    try {
        panel.handleMessage(req.body);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`HME Chat listening on http://localhost:${PORT}`);
});
// Graceful shutdown
async function shutdown() {
    console.log("\n[HME] shutting down…");
    if (BrowserPanel_1.BrowserPanel.current) {
        await BrowserPanel_1.BrowserPanel.current.dispose();
    }
    server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
