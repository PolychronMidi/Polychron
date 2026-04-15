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
exports.listSessions = listSessions;
exports.loadSession = loadSession;
exports.createSession = createSession;
exports.saveSession = saveSession;
exports.deleteSession = deleteSession;
exports.renameSession = renameSession;
exports.deriveTitle = deriveTitle;
exports.saveChainLink = saveChainLink;
exports.loadChainLink = loadChainLink;
exports.listChainLinks = listChainLinks;
exports.loadChainSummaries = loadChainSummaries;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const BASE_DIR = path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~", ".config", "hme-chat", "workspaces");
function workspaceDir(projectRoot) {
    const hash = crypto
        .createHash("sha256")
        .update(projectRoot.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, ""))
        .digest("hex")
        .slice(0, 16);
    return path.join(BASE_DIR, hash);
}
function indexPath(projectRoot) {
    return path.join(workspaceDir(projectRoot), "index.json");
}
function sessionPath(projectRoot, id) {
    return path.join(workspaceDir(projectRoot), "sessions", `${id}.json`);
}
function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch (e) {
        if (e?.code !== "ENOENT")
            console.error(`[SessionStore] readJson failed for ${filePath}: ${e?.message ?? e}`);
        return fallback;
    }
}
function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
/** Typed handle for a single JSON file. Eliminates repeated path threading. */
class JsonStore {
    constructor(filePath, fallback) {
        this.filePath = filePath;
        this.fallback = fallback;
    }
    read() { return readJson(this.filePath, this.fallback); }
    write(data) { writeJson(this.filePath, data); }
}
function indexStore(projectRoot) {
    return new JsonStore(indexPath(projectRoot), []);
}
function listSessions(projectRoot) {
    return indexStore(projectRoot).read().sort((a, b) => b.updatedAt - a.updatedAt);
}
function loadSession(projectRoot, id) {
    const entry = listSessions(projectRoot).find((s) => s.id === id);
    if (!entry)
        return null;
    const data = readJson(sessionPath(projectRoot, id), null);
    if (!data)
        return null;
    return {
        entry,
        messages: data.messages ?? [],
        llamacppHistory: data.llamacppHistory ?? [],
        contextTokens: data.contextTokens,
        chainIndex: data.chainIndex,
    };
}
function createSession(projectRoot, title) {
    const id = crypto.randomBytes(6).toString("hex");
    const now = Date.now();
    const entry = { id, title, createdAt: now, updatedAt: now, claudeSessionId: null };
    const store = indexStore(projectRoot);
    const index = store.read();
    index.unshift(entry);
    store.write(index);
    writeJson(sessionPath(projectRoot, id), { messages: [], llamacppHistory: [] });
    return entry;
}
function saveSession(projectRoot, entry, messages, llamacppHistory, extra) {
    const store = indexStore(projectRoot);
    const index = store.read();
    const idx = index.findIndex((s) => s.id === entry.id);
    if (idx >= 0) {
        index[idx] = entry;
    }
    else {
        index.unshift(entry);
    }
    store.write(index);
    writeJson(sessionPath(projectRoot, entry.id), {
        messages, llamacppHistory,
        ...(extra?.contextTokens != null ? { contextTokens: extra.contextTokens } : {}),
        ...(extra?.chainIndex != null ? { chainIndex: extra.chainIndex } : {}),
    });
}
function deleteSession(projectRoot, id) {
    // Delete file first — if it fails the index stays consistent; file-before-index prevents orphaned entries
    try {
        fs.unlinkSync(sessionPath(projectRoot, id));
    }
    catch (e) {
        if (e?.code !== "ENOENT")
            console.error(`[SessionStore] Delete failed: ${e?.message ?? e}`);
    }
    const store = indexStore(projectRoot);
    store.write(store.read().filter((s) => s.id !== id));
}
function renameSession(projectRoot, id, title) {
    const store = indexStore(projectRoot);
    const index = store.read();
    const entry = index.find((s) => s.id === id);
    if (entry) {
        entry.title = title;
        entry.updatedAt = Date.now();
        store.write(index);
    }
}
/** Derive a session title from the first user message (first 60 chars). */
function deriveTitle(firstMessage) {
    return firstMessage.slice(0, 60).replace(/\n/g, " ").trim() || "New session";
}
// ── Chain link storage ────────────────────────────────────────────────────
function chainDir(projectRoot, sessionId) {
    return path.join(workspaceDir(projectRoot), "chains", sessionId);
}
function chainPath(projectRoot, sessionId, index) {
    return path.join(chainDir(projectRoot, sessionId), `link-${String(index).padStart(3, "0")}.json`);
}
function saveChainLink(projectRoot, link) {
    writeJson(chainPath(projectRoot, link.sessionId, link.index), link);
}
function loadChainLink(projectRoot, sessionId, index) {
    return readJson(chainPath(projectRoot, sessionId, index), null);
}
function listChainLinks(projectRoot, sessionId) {
    const dir = chainDir(projectRoot, sessionId);
    try {
        return fs.readdirSync(dir)
            .filter((f) => f.startsWith("link-") && f.endsWith(".json"))
            .map((f) => parseInt(f.slice(5, 8), 10))
            .filter((n) => !isNaN(n))
            .sort((a, b) => a - b);
    }
    catch (e) {
        if (e?.code !== "ENOENT")
            console.error(`[SessionStore] listChainLinks failed for ${sessionId}: ${e?.message ?? e}`);
        return [];
    }
}
function loadChainSummaries(projectRoot, sessionId) {
    return listChainLinks(projectRoot, sessionId).map((idx) => {
        const link = loadChainLink(projectRoot, sessionId, idx);
        return link?.summary ?? "";
    }).filter(Boolean);
}
