import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { LlamacppMessage } from "../router";
import { ChatMessage } from "../types";

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
  llamacppHistory: LlamacppMessage[];
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
    // ENOENT (file doesn't exist yet) is legitimately "use the fallback."
    // Any other failure — JSON corruption, permission denied, disk error —
    // is a real problem: silently falling back to `[]` would wipe a user's
    // session list or message history. Throw so callers surface it and the
    // user can investigate before losing more data.
    if (e?.code === "ENOENT") return fallback;
    throw new Error(`SessionStore.readJson failed for ${filePath}: ${e?.message ?? e}`);
  }
}

function writeJson(filePath: string, data: unknown): void {
  // Callers do not wrap this in try/catch — disk full, permission denied,
  // or stale tmp file should propagate. Data-loss failures must be loud.
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

/** Typed handle for a single JSON file. Eliminates repeated path threading. */
class JsonStore<T> {
  constructor(private readonly filePath: string, private readonly fallback: T) {}
  read(): T { return readJson(this.filePath, this.fallback); }
  write(data: T): void { writeJson(this.filePath, data); }
}

function indexStore(projectRoot: string): JsonStore<SessionEntry[]> {
  return new JsonStore<SessionEntry[]>(indexPath(projectRoot), []);
}

export function listSessions(projectRoot: string): SessionEntry[] {
  return indexStore(projectRoot).read().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(projectRoot: string, id: string): PersistedSession | null {
  const entry = listSessions(projectRoot).find((s) => s.id === id);
  if (!entry) return null;
  const data = readJson<{ messages: ChatMessage[]; llamacppHistory: LlamacppMessage[]; contextTokens?: number; chainIndex?: number } | null>(
    sessionPath(projectRoot, id),
    null
  );
  if (!data) return null;
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

export function createSession(projectRoot: string, title: string): SessionEntry {
  const id = crypto.randomBytes(6).toString("hex");
  const now = Date.now();
  const entry: SessionEntry = { id, title, createdAt: now, updatedAt: now, claudeSessionId: null };

  const store = indexStore(projectRoot);
  const index = store.read();
  index.unshift(entry);
  store.write(index);
  writeJson(sessionPath(projectRoot, id), { messages: [], llamacppHistory: [] });

  return entry;
}

export function saveSession(
  projectRoot: string,
  entry: SessionEntry,
  messages: ChatMessage[],
  llamacppHistory: LlamacppMessage[],
  extra?: { contextTokens?: number; chainIndex?: number }
): void {
  const store = indexStore(projectRoot);
  const index = store.read();
  const idx = index.findIndex((s) => s.id === entry.id);
  if (idx >= 0) { index[idx] = entry; } else { index.unshift(entry); }
  store.write(index);
  writeJson(sessionPath(projectRoot, entry.id), {
    messages, llamacppHistory,
    ...(extra?.contextTokens != null ? { contextTokens: extra.contextTokens } : {}),
    ...(extra?.chainIndex != null ? { chainIndex: extra.chainIndex } : {}),
  });
}

export function deleteSession(projectRoot: string, id: string): void {
  // Delete file first — if it fails the index stays consistent; file-before-index prevents orphaned entries.
  // Any failure except "already gone" (ENOENT) propagates: leaving a file
  // behind while removing the index entry creates an orphan on disk that
  // nobody knows about.
  try {
    fs.unlinkSync(sessionPath(projectRoot, id));
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      throw new Error(`SessionStore.deleteSession: unlink ${sessionPath(projectRoot, id)} failed: ${e?.message ?? e}`);
    }
  }
  const store = indexStore(projectRoot);
  store.write(store.read().filter((s) => s.id !== id));
}

export function renameSession(projectRoot: string, id: string, title: string): void {
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
export function deriveTitle(firstMessage: string): string {
  return firstMessage.slice(0, 60).replace(/\n/g, " ").trim() || "New session";
}

//  Chain link storage

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
  } catch (e: any) {
    // No chain dir yet — legitimately empty. Any other readdir failure
    // (permission, I/O) is a real problem that would make ChainPerformer
    // think there are zero prior links and trigger a spurious rotation.
    if (e?.code === "ENOENT") return [];
    throw new Error(`SessionStore.listChainLinks failed for ${sessionId}: ${e?.message ?? e}`);
  }
}

export function loadChainSummaries(projectRoot: string, sessionId: string): string[] {
  return listChainLinks(projectRoot, sessionId).map((idx) => {
    const link = loadChainLink(projectRoot, sessionId, idx);
    return link?.summary ?? "";
  }).filter(Boolean);
}
