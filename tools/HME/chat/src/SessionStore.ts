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
  const data = readJson<{ messages: ChatMessage[]; ollamaHistory: OllamaMessage[] } | null>(
    sessionPath(projectRoot, id),
    null
  );
  if (!data) return null;
  return { entry, messages: data.messages ?? [], ollamaHistory: data.ollamaHistory ?? [] };
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
  ollamaHistory: OllamaMessage[]
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
  writeJson(sessionPath(projectRoot, entry.id), { messages, ollamaHistory });
}

export function deleteSession(projectRoot: string, id: string): void {
  const index = readJson<SessionEntry[]>(indexPath(projectRoot), []).filter((s) => s.id !== id);
  writeJson(indexPath(projectRoot), index);
  try { fs.unlinkSync(sessionPath(projectRoot, id)); } catch (e: any) { if (e?.code !== "ENOENT") console.error(`[SessionStore] Delete failed: ${e?.message ?? e}`); }
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
