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
        // ENOENT (file doesn't exist yet) is legitimately "use the fallback."
        // Any other failure — JSON corruption, permission denied, disk error —
        // is a real problem: silently falling back to `[]` would wipe a user's
        // session list or message history. Throw so callers surface it and the
        // user can investigate before losing more data.
        if (e?.code === "ENOENT")
            return fallback;
        throw new Error(`SessionStore.readJson failed for ${filePath}: ${e?.message ?? e}`);
    }
}
function writeJson(filePath, data) {
    // Callers do not wrap this in try/catch — disk full, permission denied,
    // or stale tmp file should propagate. Data-loss failures must be loud.
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
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
    // Session files are written atomically (tmp + rename) — a loaded object
    // that's missing `messages` or `llamacppHistory` means the schema drifted
    // or the file was hand-edited. Fail loud so the user sees the mismatch
    // instead of opening a session that silently dropped their conversation.
    if (!Array.isArray(data.messages)) {
        throw new Error(`SessionStore.loadSession: session ${id} missing messages array — file may be corrupt`);
    }
    if (!Array.isArray(data.llamacppHistory)) {
        throw new Error(`SessionStore.loadSession: session ${id} missing llamacppHistory array — file may be corrupt`);
    }
    return {
        entry,
        messages: data.messages,
        llamacppHistory: data.llamacppHistory,
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
    // Delete file first — if it fails the index stays consistent; file-before-index prevents orphaned entries.
    // Any failure except "already gone" (ENOENT) propagates: leaving a file
    // behind while removing the index entry creates an orphan on disk that
    // nobody knows about.
    try {
        fs.unlinkSync(sessionPath(projectRoot, id));
    }
    catch (e) {
        if (e?.code !== "ENOENT") {
            throw new Error(`SessionStore.deleteSession: unlink ${sessionPath(projectRoot, id)} failed: ${e?.message ?? e}`);
        }
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
//  Chain link storage
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
        // No chain dir yet — legitimately empty. Any other readdir failure
        // (permission, I/O) is a real problem that would make ChainPerformer
        // think there are zero prior links and trigger a spurious rotation.
        if (e?.code === "ENOENT")
            return [];
        throw new Error(`SessionStore.listChainLinks failed for ${sessionId}: ${e?.message ?? e}`);
    }
}
function loadChainSummaries(projectRoot, sessionId) {
    return listChainLinks(projectRoot, sessionId).map((idx) => {
        const link = loadChainLink(projectRoot, sessionId, idx);
        return link?.summary ?? "";
    }).filter(Boolean);
}
