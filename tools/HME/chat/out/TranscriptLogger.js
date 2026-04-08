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
exports.TranscriptLogger = void 0;
/**
 * TranscriptLogger — append-only JSONL session transcript.
 *
 * Every exchange (user message, assistant response, tool calls, route switches,
 * validation/audit events) gets logged to `log/session-transcript.jsonl`.
 * This transcript:
 *   - Survives context compaction in Claude sessions
 *   - Gets injected into pre-send enrichment so every message has session awareness
 *   - Gets served via HME HTTP /transcript endpoint for external consumers
 *   - Gets summarized into rolling narrative digests every N turns
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MAX_ENTRIES_IN_MEMORY = 500;
const NARRATIVE_INTERVAL = 3; // Synthesize narrative every N turns
class TranscriptLogger {
    constructor(projectRoot) {
        this._entries = [];
        this._turnCount = 0;
        this._sessionId = "";
        const logDir = path.join(projectRoot, "log");
        fs.mkdirSync(logDir, { recursive: true });
        this._logPath = path.join(logDir, "session-transcript.jsonl");
        // Load existing entries from file (tail — last MAX_ENTRIES_IN_MEMORY lines)
        this._loadExisting();
    }
    _loadExisting() {
        try {
            if (!fs.existsSync(this._logPath))
                return;
            const content = fs.readFileSync(this._logPath, "utf8");
            const lines = content.trim().split("\n").filter((l) => l.trim());
            // Only keep last MAX_ENTRIES_IN_MEMORY
            const recent = lines.slice(-MAX_ENTRIES_IN_MEMORY);
            for (const line of recent) {
                try {
                    this._entries.push(JSON.parse(line));
                }
                catch { }
            }
        }
        catch { }
    }
    /** Set the active session ID — stamped on all subsequent entries. */
    setSessionId(id) {
        this._sessionId = id;
    }
    /** Append an entry to both memory and disk. */
    log(entry) {
        const e = this._sessionId ? { session_id: this._sessionId, ...entry } : entry;
        this._entries.push(e);
        // Trim memory if over limit
        if (this._entries.length > MAX_ENTRIES_IN_MEMORY) {
            this._entries = this._entries.slice(-MAX_ENTRIES_IN_MEMORY);
        }
        // Append to JSONL file
        try {
            fs.appendFileSync(this._logPath, JSON.stringify(e) + "\n", "utf8");
        }
        catch { }
    }
    /** Log a user message. */
    logUser(message, route, model) {
        this._turnCount++;
        this.log({
            ts: Date.now(),
            type: "user",
            route,
            model,
            content: message,
            summary: `User [${route}]: ${message.slice(0, 100)}`,
        });
    }
    /** Log an assistant response. */
    logAssistant(response, route, model, toolCalls) {
        this._turnCount++;
        this.log({
            ts: Date.now(),
            type: "assistant",
            route,
            model,
            content: response.slice(0, 2000),
            summary: `Assistant [${route}]: ${response.slice(0, 100)}`,
            meta: toolCalls?.length ? { tools: toolCalls } : undefined,
        });
        // Check if narrative synthesis is due
        if (this._turnCount % NARRATIVE_INTERVAL === 0) {
            this._synthesizeNarrative();
        }
    }
    /** Log a tool call (from stream-json or PTY output). */
    logToolCall(tool, input, route) {
        this.log({
            ts: Date.now(),
            type: "tool_call",
            route,
            content: `${tool}: ${input.slice(0, 300)}`,
            summary: `Tool: ${tool}`,
        });
    }
    /** Log a route switch. */
    logRouteSwitch(from, to) {
        this.log({
            ts: Date.now(),
            type: "route_switch",
            content: `${from} → ${to}`,
            summary: `Route: ${from} → ${to}`,
        });
    }
    /** Log a validation event (pre-send check). */
    logValidation(query, warnings, blocks) {
        this.log({
            ts: Date.now(),
            type: "validation",
            content: `Pre-send: ${warnings} warnings, ${blocks} blocks for: ${query.slice(0, 100)}`,
            summary: blocks > 0 ? `⛔ ${blocks} anti-patterns detected` : warnings > 0 ? `⚠ ${warnings} constraints` : "✓ clean",
        });
    }
    /** Log an audit event (post-response check). */
    logAudit(filesChanged, violations) {
        this.log({
            ts: Date.now(),
            type: "audit",
            content: `Post-audit: ${filesChanged} files, ${violations} violations`,
            summary: violations > 0 ? `⛔ ${violations} violations in ${filesChanged} files` : `✓ ${filesChanged} files clean`,
        });
    }
    /** Log a session start/resume. */
    logSessionStart(sessionId, title, resumed) {
        this.log({
            ts: Date.now(),
            type: resumed ? "session_resume" : "session_start",
            content: `Session ${resumed ? "resumed" : "started"}: ${title} (${sessionId})`,
            summary: `${resumed ? "↩" : "🆕"} ${title}`,
        });
    }
    /**
     * Get recent transcript as a context string for injection.
     * @param maxEntries Max entries to include (default 30)
     * @param maxChars Max total characters (default 4000)
     */
    getRecentContext(maxEntries = 30, maxChars = 4000) {
        const recent = this._entries.slice(-maxEntries);
        if (recent.length === 0)
            return "";
        const lines = ["[Session Transcript — recent activity]"];
        let chars = lines[0].length;
        // Include any narrative summaries first
        const narratives = recent.filter((e) => e.type === "narrative");
        if (narratives.length > 0) {
            const latest = narratives[narratives.length - 1];
            lines.push(`[Narrative digest] ${latest.content}`);
            chars += lines[lines.length - 1].length;
        }
        // Then recent summaries
        for (const entry of recent) {
            if (entry.type === "narrative")
                continue;
            const line = `[${new Date(entry.ts).toISOString().slice(11, 19)}] ${entry.summary || entry.content.slice(0, 120)}`;
            if (chars + line.length > maxChars)
                break;
            lines.push(line);
            chars += line.length;
        }
        return lines.join("\n");
    }
    /**
     * Get all entries from the last N minutes.
     * @param minutes Window in minutes (default 30)
     */
    getWindow(minutes = 30) {
        const cutoff = Date.now() - minutes * 60000;
        return this._entries.filter((e) => e.ts >= cutoff);
    }
    /** Get all entries as raw array. */
    getAll() {
        return [...this._entries];
    }
    /** Get entry count. */
    get count() {
        return this._entries.length;
    }
    /** Register a callback for narrative synthesis (called with recent entries). */
    setNarrativeCallback(cb) {
        this._narrativeCallback = cb;
    }
    /** Force narrative synthesis immediately (e.g. on session end/panel close). */
    forceNarrative() {
        if (this._entries.length >= 2)
            this._synthesizeNarrative();
    }
    async _synthesizeNarrative() {
        if (!this._narrativeCallback)
            return;
        const window = this._entries.slice(-NARRATIVE_INTERVAL * 2);
        try {
            const narrative = await this._narrativeCallback(window);
            if (narrative) {
                this.log({
                    ts: Date.now(),
                    type: "narrative",
                    content: narrative,
                    summary: `📋 ${narrative.slice(0, 100)}`,
                });
            }
        }
        catch { }
    }
    /** Rotate the log file if it exceeds maxSize bytes. Keeps tail. */
    rotate(maxSize = 2 * 1024 * 1024) {
        try {
            const stat = fs.statSync(this._logPath);
            if (stat.size < maxSize)
                return;
            // Keep last half
            const content = fs.readFileSync(this._logPath, "utf8");
            const lines = content.trim().split("\n");
            const keepLines = lines.slice(Math.floor(lines.length / 2));
            fs.writeFileSync(this._logPath, keepLines.join("\n") + "\n", "utf8");
        }
        catch { }
    }
}
exports.TranscriptLogger = TranscriptLogger;
