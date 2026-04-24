"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrSpawnProcess = getOrSpawnProcess;
exports.noteResumeFailure = noteResumeFailure;
exports.killClaudeProcess = killClaudeProcess;
exports.killAllClaudeProcesses = killAllClaudeProcesses;
exports.reapIdleClaudeProcesses = reapIdleClaudeProcesses;
exports.listActiveChatSessions = listActiveChatSessions;
const child_process_1 = require("child_process");
const routerClaude_1 = require("./routerClaude");
/** Hashes options for cache-keying — two processes match only when every
 * CLI-affecting option (model/effort/thinking/permissionMode) is identical.
 * Changes invalidate the cached process and force a respawn on next turn. */
function _optsKey(o) {
    return `${o.model}|${o.effort}|${o.thinking ? 1 : 0}|${o.permissionMode ?? ""}`;
}
// Per-turn safety timers. These are the pool's equivalent of the
// per-message watchdogs the former streamClaude had — a long-lived process
// needs them MORE than the old per-spawn path, because a stuck turn holds
// the whole session hostage (no next-turn can start). Numbers mirror the
// prior behavior so we don't silently weaken the existing guarantees.
const TURN_INACTIVITY_MS = 30000; // no stdout for 30s → kill + retry next turn
const TURN_DEADLINE_MS = 300000; // hard wall-clock cap per turn
class ClaudeProcess {
    constructor(chatSessionId, resumeSessionId, opts, workingDir) {
        this.chatSessionId = chatSessionId;
        this.opts = opts;
        this.workingDir = workingDir;
        this._stdoutBuf = "";
        this._stderrTail = "";
        this._sessionId = null;
        this._currentTurn = null;
        this._dead = false;
        this._lastActivity = Date.now();
        this._turnDeadline = null;
        this._turnInactivity = null;
        this._optsKey = _optsKey(opts);
        const args = (0, routerClaude_1.buildClaudeArgs)(opts, resumeSessionId, [
            "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]);
        this.proc = (0, child_process_1.spawn)("claude", args, {
            cwd: workingDir,
            env: (0, routerClaude_1.buildClaudeEnv)(),
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.proc.stdout.on("data", (d) => this._onStdout(d));
        this.proc.stderr.on("data", (d) => this._onStderr(d));
        this.proc.on("exit", (code) => this._onExit(code, null));
        this.proc.on("error", (err) => this._onExit(null, err));
    }
    get sessionId() { return this._sessionId; }
    get dead() { return this._dead; }
    get busy() { return this._currentTurn !== null; }
    get lastActivity() { return this._lastActivity; }
    get optsKey() { return this._optsKey; }
    optsMatch(o) {
        return _optsKey(o) === this._optsKey;
    }
    /** Send a user message turn. Returns a cancel fn — calling it kills the
     * process (stream-json has no mid-turn cancel primitive); the next turn
     * will respawn via --resume to preserve in-memory state up to the kill. */
    startTurn(message, callbacks) {
        if (this._dead) {
            callbacks.onError("claude process is dead");
            return () => { };
        }
        if (this._currentTurn) {
            callbacks.onError("concurrent turn on same claude process — caller should have serialized");
            return () => { };
        }
        this._currentTurn = callbacks;
        // Re-emit cached session_id for callers that attach per-turn. The init
        // event itself only fires once — on process spawn.
        if (this._sessionId)
            callbacks.onSessionId(this._sessionId);
        const event = JSON.stringify({
            type: "user",
            message: { role: "user", content: message },
        }) + "\n";
        try {
            this.proc.stdin.write(event);
            this._lastActivity = Date.now();
            this._armTurnWatchdogs();
        }
        catch (e) {
            const turn = this._currentTurn;
            this._currentTurn = null;
            this._clearTurnWatchdogs();
            turn.onError(`claude stdin write failed: ${e?.message ?? e}`);
        }
        return () => this._cancelCurrent();
    }
    _armTurnWatchdogs() {
        this._clearTurnWatchdogs();
        this._turnDeadline = setTimeout(() => this._failTurn(`turn exceeded wall-clock deadline (${TURN_DEADLINE_MS / 1000}s) — killing process`), TURN_DEADLINE_MS);
        this._turnInactivity = setTimeout(() => this._failTurn(`no stdout for ${TURN_INACTIVITY_MS / 1000}s — API may be down or CLI hung`), TURN_INACTIVITY_MS);
    }
    _clearTurnWatchdogs() {
        if (this._turnDeadline) {
            clearTimeout(this._turnDeadline);
            this._turnDeadline = null;
        }
        if (this._turnInactivity) {
            clearTimeout(this._turnInactivity);
            this._turnInactivity = null;
        }
    }
    /** Kill + surface the error on the current turn. Respawn happens lazily
     * on the NEXT turn via --resume, so the session state is preserved. */
    _failTurn(reason) {
        if (!this._currentTurn)
            return;
        const turn = this._currentTurn;
        this._currentTurn = null;
        this._clearTurnWatchdogs();
        turn.onError(`CRITICAL: ${reason}`);
        this.kill();
    }
    _cancelCurrent() {
        if (!this._currentTurn)
            return;
        const turn = this._currentTurn;
        this._currentTurn = null;
        this._clearTurnWatchdogs();
        turn.onError("cancelled");
        // Kill so the next turn starts clean. --resume on respawn picks up the
        // session from disk; we lose only the incomplete mid-turn output.
        this.kill();
    }
    kill() {
        if (this._dead)
            return;
        this._dead = true;
        try {
            this.proc.kill();
        }
        catch { /* silent-ok: may already be dead */ }
    }
    _onStdout(data) {
        this._lastActivity = Date.now();
        // Reset the inactivity watchdog on any byte from the CLI — thinking
        // blocks, tool calls, and partial assistant frames all count as liveness.
        if (this._turnInactivity && this._currentTurn) {
            clearTimeout(this._turnInactivity);
            this._turnInactivity = setTimeout(() => this._failTurn(`no stdout for ${TURN_INACTIVITY_MS / 1000}s — API may be down or CLI hung`), TURN_INACTIVITY_MS);
        }
        this._stdoutBuf += data.toString("utf8");
        const lines = this._stdoutBuf.split("\n");
        this._stdoutBuf = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            let evt;
            try {
                evt = JSON.parse(trimmed);
            }
            catch (e) {
                console.error(`[HME] claude stream-json parse failed: ${trimmed.slice(0, 120)}`);
                continue;
            }
            this._handleEvent(evt);
        }
    }
    _onStderr(data) {
        const text = data.toString("utf8");
        if (!text)
            return;
        // Keep only the tail — stderr can be noisy (Node warnings, etc.) and we
        // surface it only on death for post-mortem context.
        this._stderrTail = (this._stderrTail + text).slice(-2048);
    }
    _handleEvent(evt) {
        // system/init fires once per process, carrying session_id. Other system
        // subtypes (hook_started, hook_response, etc.) are lifecycle noise.
        if (evt.type === "system" && evt.subtype === "init" && evt.session_id) {
            this._sessionId = evt.session_id;
            this._currentTurn?.onSessionId(evt.session_id);
            return;
        }
        if (evt.type === "assistant" && evt.message?.content) {
            const turn = this._currentTurn;
            if (!turn)
                return;
            for (const block of evt.message.content) {
                if (block.type === "thinking" && block.thinking) {
                    turn.onChunk(block.thinking, "thinking");
                }
                else if (block.type === "text" && block.text) {
                    turn.onChunk(block.text, "text");
                }
                else if (block.type === "tool_use") {
                    turn.onChunk(`[${block.name}] ${JSON.stringify(block.input ?? {}, null, 2)}`, "tool");
                }
            }
            return;
        }
        if (evt.type === "result") {
            const turn = this._currentTurn;
            this._currentTurn = null;
            this._clearTurnWatchdogs();
            if (!turn)
                return;
            const inputTokens = evt.usage?.input_tokens;
            const outputTokens = evt.usage?.output_tokens;
            const usage = (0, routerClaude_1.computeTurnUsage)(evt, this.opts.model, inputTokens, outputTokens);
            const cost = evt.total_cost_usd ?? evt.cost_usd ?? undefined;
            turn.onDone(cost, usage);
            return;
        }
        // Silently ignore: rate_limit_event, hook_started, hook_response, partial
        // assistant frames (we already consume full assistant frames above), etc.
    }
    _onExit(code, err) {
        if (this._dead)
            return;
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
const _pool = new Map();
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
function getOrSpawnProcess(chatSessionId, claudeSessionId, opts, workingDir) {
    const existing = _pool.get(chatSessionId);
    if (existing && !existing.dead && existing.optsMatch(opts))
        return existing;
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
    if (blocklisted)
        _resumeBlocklist.delete(chatSessionId);
    const proc = new ClaudeProcess(chatSessionId, resumeId, opts, workingDir);
    _pool.set(chatSessionId, proc);
    return proc;
}
// chat sessions whose most recent spawn died before emitting system/init —
// the next getOrSpawnProcess call drops --resume for them. Cleared after use.
const _resumeBlocklist = new Map();
/** Called by ClaudeProcess when it dies without emitting system/init —
 * strong signal that --resume failed (bad session id, missing state file).
 * Schedules the next respawn to skip --resume. */
function noteResumeFailure(chatSessionId) {
    _resumeBlocklist.set(chatSessionId, true);
}
/** Kill the process for a specific chat session (on session delete or
 *  explicit user action). Idempotent. */
function killClaudeProcess(chatSessionId) {
    const p = _pool.get(chatSessionId);
    if (!p)
        return;
    p.kill();
    _pool.delete(chatSessionId);
}
/** Kill every live process (on server dispose). */
function killAllClaudeProcesses() {
    for (const p of _pool.values())
        p.kill();
    _pool.clear();
}
/** Reap processes that have been idle beyond the threshold. A long-lived
 *  process hoards RSS + file descriptors; typical chat sessions sit idle
 *  for hours between bursts of activity. Returns the count reaped. */
function reapIdleClaudeProcesses(idleMs = 30 * 60000) {
    const now = Date.now();
    let reaped = 0;
    for (const [id, proc] of _pool.entries()) {
        if (proc.busy)
            continue;
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
function listActiveChatSessions() {
    return [...Array.from(_pool.entries())]
        .filter(([, p]) => !p.dead)
        .map(([id]) => id);
}
