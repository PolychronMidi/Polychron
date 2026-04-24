/**
 * claudeProcessPool — long-lived `claude` processes, one per chat session.
 *
 * Replaces the former per-message `claude -p --resume <id>` spawn pattern that
 * paid cold-start latency + full-transcript rehydration on every turn. Each
 * pool entry keeps a single `claude` process alive across many turns via
 * `--input-format stream-json` + `--output-format stream-json`:
 *
 *   - Turn 1 hydrates the conversation once (cache_creation tokens).
 *   - Turn 2+ hits prompt cache (cache_read tokens) — the actual fix for the
 *     10x-context / 10x-latency regression observed against the VS Code path.
 *   - Subscription billing is preserved because we still drive the `claude`
 *     CLI (which uses the user's OAuth), not the Agent SDK (which would
 *     require ANTHROPIC_API_KEY → API-credit billing).
 *
 * Process lifecycle:
 *   - Spawned on first turn for a chat session (or after config change).
 *   - Reused for subsequent turns on the same session (one turn at a time).
 *   - Killed on session delete, BrowserPanel dispose, model/effort/thinking
 *     change, user cancel, or idle-reaper sweep.
 *   - Respawned with `--resume <claudeSessionId>` on next turn after death —
 *     session state persists on disk via Claude Code's native session store.
 */

import { spawn, ChildProcess } from "child_process";
import { ClaudeOptions, ChunkCallback, TokenUsage } from "../router";
import {
  buildClaudeArgs, buildClaudeEnv, computeTurnUsage,
} from "./routerClaude";
import { logShimError } from "./routerHme";

export interface TurnCallbacks {
  onChunk: ChunkCallback;
  onSessionId: (id: string) => void;
  onDone: (cost?: number, usage?: TokenUsage) => void;
  onError: (msg: string) => void;
}

/** Hashes options for cache-keying — two processes match only when every
 * CLI-affecting option (model/effort/thinking/permissionMode) is identical.
 * Changes invalidate the cached process and force a respawn on next turn. */
function _optsKey(o: ClaudeOptions): string {
  return `${o.model}|${o.effort}|${o.thinking ? 1 : 0}|${o.permissionMode ?? ""}`;
}

// Per-turn safety timers. These are the pool's equivalent of the
// per-message watchdogs the former streamClaude had — a long-lived process
// needs them MORE than the old per-spawn path, because a stuck turn holds
// the whole session hostage (no next-turn can start). Numbers mirror the
// prior behavior so we don't silently weaken the existing guarantees.
// 30s was too aggressive: legitimate slow-thinking API responses and large
// tool_use blocks can easily pause streaming for 30–60s, firing the kill
// watchdog falsely. 90s is long enough to cover real inference pauses while
// still catching genuine hangs (a Claude CLI that truly hangs is dead for
// minutes, not seconds). Observed April 2026: false-fires logged after a
// worker respawn caused HME-shim-dependent calls to retry; chat panel's
// claude CLI sat idle during retry and falsely tripped the 30s gate.
const TURN_INACTIVITY_MS = 90_000;   // no stdout for 90s → kill + retry next turn
const TURN_DEADLINE_MS   = 300_000;  // hard wall-clock cap per turn
// Productivity watchdog: resets only on useful output (assistant/thinking/
// tool chunks pushed to onChunk). The byte-level TURN_INACTIVITY_MS watchdog
// above resets on ANY stdout — including hook_started / rate_limit_event /
// partial-frame lifecycle noise that the CLI emits continuously. Without this
// second timer, a session that's streaming only noise-events for minutes
// would never trip the inactivity guard, leaving the user with a spinner and
// no response. 120s is generous enough for slow thinking blocks (which DO
// call onChunk with thinking type) but catches "streaming noise, no content".
const TURN_NO_CONTENT_MS = 120_000;

class ClaudeProcess {
  private proc: ChildProcess;
  private _stdoutBuf = "";
  private _stderrTail = "";
  private _sessionId: string | null = null;
  private _currentTurn: TurnCallbacks | null = null;
  private _dead = false;
  private _lastActivity = Date.now();
  private readonly _optsKey: string;
  private _turnDeadline: NodeJS.Timeout | null = null;
  private _turnInactivity: NodeJS.Timeout | null = null;
  private _turnNoContent: NodeJS.Timeout | null = null;

  constructor(
    readonly chatSessionId: string,
    resumeSessionId: string | null,
    readonly opts: ClaudeOptions,
    readonly workingDir: string,
  ) {
    this._optsKey = _optsKey(opts);
    const args = buildClaudeArgs(opts, resumeSessionId, [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
    ]);
    this.proc = spawn("claude", args, {
      cwd: workingDir,
      env: buildClaudeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout!.on("data", (d: Buffer) => this._onStdout(d));
    this.proc.stderr!.on("data", (d: Buffer) => this._onStderr(d));
    this.proc.on("exit", (code) => this._onExit(code, null));
    this.proc.on("error", (err) => this._onExit(null, err));
  }

  get sessionId(): string | null { return this._sessionId; }
  get dead(): boolean { return this._dead; }
  get busy(): boolean { return this._currentTurn !== null; }
  get lastActivity(): number { return this._lastActivity; }
  get optsKey(): string { return this._optsKey; }

  optsMatch(o: ClaudeOptions): boolean {
    return _optsKey(o) === this._optsKey;
  }

  /** Send a user message turn. Returns a cancel fn — calling it kills the
   * process (stream-json has no mid-turn cancel primitive); the next turn
   * will respawn via --resume to preserve in-memory state up to the kill. */
  startTurn(message: string, callbacks: TurnCallbacks): () => void {
    if (this._dead) {
      callbacks.onError("claude process is dead");
      return () => {};
    }
    if (this._currentTurn) {
      callbacks.onError("concurrent turn on same claude process — caller should have serialized");
      return () => {};
    }
    this._currentTurn = callbacks;
    // Re-emit cached session_id for callers that attach per-turn. The init
    // event itself only fires once — on process spawn.
    if (this._sessionId) callbacks.onSessionId(this._sessionId);
    const event = JSON.stringify({
      type: "user",
      message: { role: "user", content: message },
    }) + "\n";
    try {
      this.proc.stdin!.write(event);
      this._lastActivity = Date.now();
      this._armTurnWatchdogs();
    } catch (e: any) {
      const turn = this._currentTurn;
      this._currentTurn = null;
      this._clearTurnWatchdogs();
      turn.onError(`claude stdin write failed: ${e?.message ?? e}`);
    }
    return () => this._cancelCurrent();
  }

  private _armTurnWatchdogs(): void {
    this._clearTurnWatchdogs();
    this._turnDeadline = setTimeout(() => this._failTurn(
      `turn exceeded wall-clock deadline (${TURN_DEADLINE_MS / 1000}s) — killing process`,
    ), TURN_DEADLINE_MS);
    this._turnInactivity = setTimeout(() => this._failTurn(
      `no stdout for ${TURN_INACTIVITY_MS / 1000}s — API may be down or CLI hung`,
    ), TURN_INACTIVITY_MS);
    this._turnNoContent = setTimeout(() => this._failTurn(
      `no content chunks for ${TURN_NO_CONTENT_MS / 1000}s — CLI streaming lifecycle noise but no assistant output (likely upstream stall or stream-json event-shape drift)`,
    ), TURN_NO_CONTENT_MS);
  }

  private _clearTurnWatchdogs(): void {
    if (this._turnDeadline)   { clearTimeout(this._turnDeadline);   this._turnDeadline   = null; }
    if (this._turnInactivity) { clearTimeout(this._turnInactivity); this._turnInactivity = null; }
    if (this._turnNoContent)  { clearTimeout(this._turnNoContent);  this._turnNoContent  = null; }
  }

  /** Kill + surface the error on the current turn. Respawn happens lazily
   * on the NEXT turn via --resume, so the session state is preserved. */
  private _failTurn(reason: string): void {
    if (!this._currentTurn) return;
    const turn = this._currentTurn;
    this._currentTurn = null;
    this._clearTurnWatchdogs();
    turn.onError(`CRITICAL: ${reason}`);
    this.kill();
  }

  private _cancelCurrent(): void {
    if (!this._currentTurn) return;
    const turn = this._currentTurn;
    this._currentTurn = null;
    this._clearTurnWatchdogs();
    turn.onError("cancelled");
    // Kill so the next turn starts clean. --resume on respawn picks up the
    // session from disk; we lose only the incomplete mid-turn output.
    this.kill();
  }

  kill(): void {
    if (this._dead) return;
    this._dead = true;
    try { this.proc.kill(); } catch { /* silent-ok: may already be dead */ }
  }

  private _onStdout(data: Buffer): void {
    this._lastActivity = Date.now();
    // Reset the inactivity watchdog on any byte from the CLI — thinking
    // blocks, tool calls, and partial assistant frames all count as liveness.
    if (this._turnInactivity && this._currentTurn) {
      clearTimeout(this._turnInactivity);
      this._turnInactivity = setTimeout(() => this._failTurn(
        `no stdout for ${TURN_INACTIVITY_MS / 1000}s — API may be down or CLI hung`,
      ), TURN_INACTIVITY_MS);
    }
    this._stdoutBuf += data.toString("utf8");
    const lines = this._stdoutBuf.split("\n");
    this._stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt: any;
      try { evt = JSON.parse(trimmed); }
      catch (e) {
        // Parse failure = upstream CLI emitted malformed stream-json (or a
        // partial flush mid-chunk that we didn't buffer correctly). Route to
        // LIFESAVER so the agent sees the drift next turn — console.error
        // alone disappears into the extension-host log nobody reads.
        console.error(`[HME] claude stream-json parse failed: ${trimmed.slice(0, 120)}`);
        logShimError(
          "claude",
          `stream-json parse failed — upstream CLI may have shipped a schema change`,
          trimmed.slice(0, 400),
        ).catch(() => { /* ErrorSink has its own fallback */ });
        continue;
      }
      this._handleEvent(evt);
    }
  }

  private _onStderr(data: Buffer): void {
    const text = data.toString("utf8");
    if (!text) return;
    // Keep only the tail — stderr can be noisy (Node warnings, etc.) and we
    // surface it only on death for post-mortem context.
    this._stderrTail = (this._stderrTail + text).slice(-2048);
  }

  private _handleEvent(evt: any): void {
    // system/init fires once per process, carrying session_id. Other system
    // subtypes (hook_started, hook_response, etc.) are lifecycle noise.
    if (evt.type === "system" && evt.subtype === "init" && evt.session_id) {
      this._sessionId = evt.session_id;
      this._currentTurn?.onSessionId(evt.session_id);
      return;
    }
    if (evt.type === "assistant" && evt.message?.content) {
      const turn = this._currentTurn;
      if (!turn) return;
      let emittedAny = false;
      for (const block of evt.message.content) {
        if (block.type === "thinking" && block.thinking) {
          turn.onChunk(block.thinking, "thinking");
          emittedAny = true;
        } else if (block.type === "text" && block.text) {
          turn.onChunk(block.text, "text");
          emittedAny = true;
        } else if (block.type === "tool_use") {
          turn.onChunk(`[${block.name}] ${JSON.stringify(block.input ?? {}, null, 2)}`, "tool");
          emittedAny = true;
        }
      }
      // Reset the productivity watchdog only when something actually reached
      // the user — the byte-level inactivity timer already resets on any
      // stdout, including noise events.
      if (emittedAny && this._turnNoContent) {
        clearTimeout(this._turnNoContent);
        this._turnNoContent = setTimeout(() => this._failTurn(
          `no content chunks for ${TURN_NO_CONTENT_MS / 1000}s — CLI streaming lifecycle noise but no assistant output (likely upstream stall or stream-json event-shape drift)`,
        ), TURN_NO_CONTENT_MS);
      }
      return;
    }
    if (evt.type === "result") {
      const turn = this._currentTurn;
      this._currentTurn = null;
      this._clearTurnWatchdogs();
      if (!turn) return;
      const inputTokens: number | undefined = evt.usage?.input_tokens;
      const outputTokens: number | undefined = evt.usage?.output_tokens;
      const usage = computeTurnUsage(evt, this.opts.model, inputTokens, outputTokens);
      const cost = evt.total_cost_usd ?? evt.cost_usd ?? undefined;
      turn.onDone(cost, usage);
      return;
    }
    // Previously silent-ignored: rate_limit_event, hook_started, hook_response,
    // partial assistant frames. These ARE routine and shouldn't spam stderr,
    // but a persistent unknown event type is a real signal — log unrecognised
    // top-level types to the extension-host console so drift is at least
    // traceable. Known-benign types are allow-listed.
    const KNOWN_BENIGN = new Set([
      "system", "rate_limit_event", "hook_started", "hook_response",
      "partial_assistant", "user", "tool_result",
    ]);
    if (evt.type && !KNOWN_BENIGN.has(evt.type)) {
      console.error(`[HME] claude stream-json: unhandled event type '${evt.type}' — this may indicate CLI schema drift. Keys: ${Object.keys(evt).join(",")}`);
    }
  }

  private _onExit(code: number | null, err: Error | null): void {
    if (this._dead) return;
    this._dead = true;
    this._clearTurnWatchdogs();
    const reason = err?.message ?? (code === 0 ? "exited normally" : `exit code=${code}`);
    // If we never got a system/init event, the spawn itself failed — most
    // likely cause: --resume referenced a session the CLI can't find.
    // Mark the chat session so the next respawn skips --resume and starts
    // a fresh Claude Code session instead of looping on the same failure.
    if (!this._sessionId) {
      noteResumeFailure(this.chatSessionId);
    }
    if (this._currentTurn) {
      const turn = this._currentTurn;
      this._currentTurn = null;
      const tail = this._stderrTail.trim();
      turn.onError(`claude process died mid-turn: ${reason}${tail ? `\nstderr tail: ${tail.slice(-400)}` : ""}`);
    }
  }
}

//  Pool

const _pool = new Map<string, ClaudeProcess>();

/**
 * Get the live process for the chat session, or spawn a fresh one. On config
 * change (different opts) the old process is killed and a new one spawned
 * with --resume to inherit conversation state.
 *
 * The pool is keyed on chatSessionId, NOT claudeSessionId. The same chat
 * session may cycle through multiple claudeSessionIds if the process dies
 * and respawns — we track the latest in the cached ClaudeProcess.
 *
 * If --resume fails (e.g. the on-disk session file was deleted), the
 * spawned process will exit quickly with a nonzero code. Callers detect
 * this via onError + dead=true; the next turn through `getOrSpawnProcess`
 * will respawn without --resume (we null out the resume id after a resume
 * failure) so the chat keeps working with a fresh session.
 */
export function getOrSpawnProcess(
  chatSessionId: string,
  claudeSessionId: string | null,
  opts: ClaudeOptions,
  workingDir: string,
): ClaudeProcess {
  const existing = _pool.get(chatSessionId);
  if (existing && !existing.dead && existing.optsMatch(opts)) return existing;
  if (existing) {
    // Config change or death — retire the old process. Its in-memory state is
    // lost but the on-disk session survives; --resume picks it up below.
    existing.kill();
    _pool.delete(chatSessionId);
  }
  // Prefer the previously-captured claudeSessionId from the old process over
  // whatever BrowserPanel had stored — the old process may have advanced the
  // session during a turn we're not persisting yet. BUT if that process died
  // from a resume-failure (tracked via _resumeBlocklist), drop the resume id
  // for this spawn so the next attempt starts a fresh Claude Code session.
  const blocklisted = _resumeBlocklist.get(chatSessionId);
  const resumeId = blocklisted
    ? null
    : (existing?.sessionId ?? claudeSessionId);
  if (blocklisted) _resumeBlocklist.delete(chatSessionId);
  const proc = new ClaudeProcess(chatSessionId, resumeId, opts, workingDir);
  _pool.set(chatSessionId, proc);
  return proc;
}

// chat sessions whose most recent spawn died before emitting system/init —
// the next getOrSpawnProcess call drops --resume for them. Cleared after use.
const _resumeBlocklist = new Map<string, true>();

/** Called by ClaudeProcess when it dies without emitting system/init —
 * strong signal that --resume failed (bad session id, missing state file).
 * Schedules the next respawn to skip --resume. */
export function noteResumeFailure(chatSessionId: string): void {
  _resumeBlocklist.set(chatSessionId, true);
}

/** Kill the process for a specific chat session (on session delete or
 *  explicit user action). Idempotent. */
export function killClaudeProcess(chatSessionId: string): void {
  const p = _pool.get(chatSessionId);
  if (!p) return;
  p.kill();
  _pool.delete(chatSessionId);
}

/** Kill every live process (on server dispose). */
export function killAllClaudeProcesses(): void {
  for (const p of _pool.values()) p.kill();
  _pool.clear();
}

/** Reap processes that have been idle beyond the threshold. A long-lived
 *  process hoards RSS + file descriptors; typical chat sessions sit idle
 *  for hours between bursts of activity. Returns the count reaped. */
export function reapIdleClaudeProcesses(idleMs: number = 30 * 60_000): number {
  const now = Date.now();
  let reaped = 0;
  for (const [id, proc] of _pool.entries()) {
    if (proc.busy) continue;
    if (now - proc.lastActivity > idleMs) {
      proc.kill();
      _pool.delete(id);
      reaped++;
    }
  }
  return reaped;
}

/** Diagnostic accessor — returns the set of chat session ids currently
 *  backed by a live process. Useful for selftest / debug endpoints. */
export function listActiveChatSessions(): string[] {
  return [...Array.from(_pool.entries())]
    .filter(([, p]) => !p.dead)
    .map(([id]) => id);
}
