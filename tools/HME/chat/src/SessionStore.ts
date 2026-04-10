import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { OllamaMessage } from "./router";
import { ChatMessage } from "./types";

export interface SessionEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  claudeSessionId: string | null;
}

export interface PersistedSession {
  entry: SessionEntry;
  messages: ChatMessage[];
  ollamaHistory: OllamaMessage[];
  contextTokens?: number;
  chainIndex?: number;
}

export interface ChainLink {
  index: number;
  sessionId: string;
  messages: ChatMessage[];
  summary: string;
  todos: any[];
  contextTokens: number;
  claudeSessionId: string | null;
  createdAt: number;
}

const BASE_DIR = path.join(
  process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
  ".config",
  "hme-chat",
  "workspaces"
);

function workspaceDir(projectRoot: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(projectRoot.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, ""))
    .digest("hex")
    .slice(0, 16);
  return path.join(BASE_DIR, hash);
}

function indexPath(projectRoot: string): string {
  return path.join(workspaceDir(projectRoot), "index.json");
}

function sessionPath(projectRoot: string, id: string): string {
  return path.join(workspaceDir(projectRoot), "sessions", `${id}.json`);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (e: any) {
    if (e?.code !== "ENOENT") console.error(`[SessionStore] readJson failed for ${filePath}: ${e?.message ?? e}`);
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function listSessions(projectRoot: string): SessionEntry[] {
  return readJson<SessionEntry[]>(indexPath(projectRoot), [])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(projectRoot: string, id: string): PersistedSession | null {
  const entry = listSessions(projectRoot).find((s) => s.id === id);
  if (!entry) return null;
  const data = readJson<{ messages: ChatMessage[]; ollamaHistory: OllamaMessage[]; contextTokens?: number; chainIndex?: number } | null>(
    sessionPath(projectRoot, id),
    null
  );
  if (!data) return null;
  return {
    entry,
    messages: data.messages ?? [],
    ollamaHistory: data.ollamaHistory ?? [],
    contextTokens: data.contextTokens,
    chainIndex: data.chainIndex,
  };
}

export function createSession(projectRoot: string, title: string): SessionEntry {
  const id = crypto.randomBytes(6).toString("hex");
  const now = Date.now();
  const entry: SessionEntry = { id, title, createdAt: now, updatedAt: now, claudeSessionId: null };

  const index = readJson<SessionEntry[]>(indexPath(projectRoot), []);
  index.unshift(entry);
  writeJson(indexPath(projectRoot), index);
  writeJson(sessionPath(projectRoot, id), { messages: [], ollamaHistory: [] });

  return entry;
}

export function saveSession(
  projectRoot: string,
  entry: SessionEntry,
  messages: ChatMessage[],
  ollamaHistory: OllamaMessage[],
  extra?: { contextTokens?: number; chainIndex?: number }
): void {
  // Update index entry
  const index = readJson<SessionEntry[]>(indexPath(projectRoot), []);
  const idx = index.findIndex((s) => s.id === entry.id);
  if (idx >= 0) {
    index[idx] = entry;
  } else {
    index.unshift(entry);
  }
  writeJson(indexPath(projectRoot), index);
  writeJson(sessionPath(projectRoot, entry.id), {
    messages, ollamaHistory,
    ...(extra?.contextTokens != null ? { contextTokens: extra.contextTokens } : {}),
    ...(extra?.chainIndex != null ? { chainIndex: extra.chainIndex } : {}),
  });
}

export function deleteSession(projectRoot: string, id: string): void {
  // Delete file first — if it fails the index stays consistent; file-before-index prevents orphaned entries
  try { fs.unlinkSync(sessionPath(projectRoot, id)); } catch (e: any) { if (e?.code !== "ENOENT") console.error(`[SessionStore] Delete failed: ${e?.message ?? e}`); }
  const index = readJson<SessionEntry[]>(indexPath(projectRoot), []).filter((s) => s.id !== id);
  writeJson(indexPath(projectRoot), index);
}

export function renameSession(projectRoot: string, id: string, title: string): void {
  const index = readJson<SessionEntry[]>(indexPath(projectRoot), []);
  const entry = index.find((s) => s.id === id);
  if (entry) {
    entry.title = title;
    entry.updatedAt = Date.now();
    writeJson(indexPath(projectRoot), index);
  }
}

/** Derive a session title from the first user message (first 60 chars). */
export function deriveTitle(firstMessage: string): string {
  return firstMessage.slice(0, 60).replace(/\n/g, " ").trim() || "New session";
}

// ── Chain link storage ────────────────────────────────────────────────────

function chainDir(projectRoot: string, sessionId: string): string {
  return path.join(workspaceDir(projectRoot), "chains", sessionId);
}

function chainPath(projectRoot: string, sessionId: string, index: number): string {
  return path.join(chainDir(projectRoot, sessionId), `link-${String(index).padStart(3, "0")}.json`);
}

export function saveChainLink(projectRoot: string, link: ChainLink): void {
  writeJson(chainPath(projectRoot, link.sessionId, link.index), link);
}

export function loadChainLink(projectRoot: string, sessionId: string, index: number): ChainLink | null {
  return readJson<ChainLink | null>(chainPath(projectRoot, sessionId, index), null);
}

export function listChainLinks(projectRoot: string, sessionId: string): number[] {
  const dir = chainDir(projectRoot, sessionId);
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith("link-") && f.endsWith(".json"))
      .map((f) => parseInt(f.slice(5, 8), 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function loadChainSummaries(projectRoot: string, sessionId: string): string[] {
  return listChainLinks(projectRoot, sessionId).map((idx) => {
    const link = loadChainLink(projectRoot, sessionId, idx);
    return link?.summary ?? "";
  }).filter(Boolean);
}
