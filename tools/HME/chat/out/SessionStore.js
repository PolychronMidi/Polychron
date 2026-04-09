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
function listSessions(projectRoot) {
    return readJson(indexPath(projectRoot), [])
        .sort((a, b) => b.updatedAt - a.updatedAt);
}
function loadSession(projectRoot, id) {
    const entry = listSessions(projectRoot).find((s) => s.id === id);
    if (!entry)
        return null;
    const data = readJson(sessionPath(projectRoot, id), null);
    if (!data)
        return null;
    return { entry, messages: data.messages ?? [], ollamaHistory: data.ollamaHistory ?? [] };
}
function createSession(projectRoot, title) {
    const id = crypto.randomBytes(6).toString("hex");
    const now = Date.now();
    const entry = { id, title, createdAt: now, updatedAt: now, claudeSessionId: null };
    const index = readJson(indexPath(projectRoot), []);
    index.unshift(entry);
    writeJson(indexPath(projectRoot), index);
    writeJson(sessionPath(projectRoot, id), { messages: [], ollamaHistory: [] });
    return entry;
}
function saveSession(projectRoot, entry, messages, ollamaHistory) {
    // Update index entry
    const index = readJson(indexPath(projectRoot), []);
    const idx = index.findIndex((s) => s.id === entry.id);
    if (idx >= 0) {
        index[idx] = entry;
    }
    else {
        index.unshift(entry);
    }
    writeJson(indexPath(projectRoot), index);
    writeJson(sessionPath(projectRoot, entry.id), { messages, ollamaHistory });
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
    const index = readJson(indexPath(projectRoot), []).filter((s) => s.id !== id);
    writeJson(indexPath(projectRoot), index);
}
function renameSession(projectRoot, id, title) {
    const index = readJson(indexPath(projectRoot), []);
    const entry = index.find((s) => s.id === id);
    if (entry) {
        entry.title = title;
        entry.updatedAt = Date.now();
        writeJson(indexPath(projectRoot), index);
    }
}
/** Derive a session title from the first user message (first 60 chars). */
function deriveTitle(firstMessage) {
    return firstMessage.slice(0, 60).replace(/\n/g, " ").trim() || "New session";
}
