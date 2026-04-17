import * as path from "path";
import { isHmeShimReady } from "../router";
import { PanelHost } from "./PanelHost";

const MAX_POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;
const MAX_RESTARTS = 4;

/**
 * Spawns and supervises the HME HTTP shim (mcp/hme_http.py).
 *
 * Lifecycle:
 *   start() — spawn python3, poll /health until ready or MAX_POLL_ATTEMPTS
 *   on("exit") — if it was previously ready, restart after RESTART_DELAY_MS
 *                (unless disposed); if never ready, surface error and stop
 *
 * `failed` flag latches true when a startup poll sequence exhausts without
 * ever seeing /health ready. UI uses this to decide when to stop retrying.
 */
export class ShimSupervisor {
  private _proc: import("child_process").ChildProcess | null = null;
  private _failed = false;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;
  private _restartCount = 0;

  constructor(
    private readonly projectRoot: string,
    private readonly host: PanelHost,
  ) {}

  get failed(): boolean {
    return this._failed;
  }

  get isRunning(): boolean {
    return this._proc !== null && !this._proc.killed;
  }

  start(): void {
    if (this.isRunning) return;
    if (this._disposed) return;
    if (this._restartCount >= MAX_RESTARTS) {
      this.host.post({ type: "hmeShimStatus", ready: false, failed: true });
      this.host.postError("shim", `HME shim restart limit (${MAX_RESTARTS}) reached — restart VS Code to retry`);
      return;
    }
    this._failed = false;
    const shimPath = path.join(__dirname, "..", "..", "..", "mcp", "hme_http.py");
    const env = { ...process.env };
    if (!env["PATH"]?.includes(".local/bin")) {
      env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
    }
    try {
      this._proc = require("child_process").spawn("python3", [shimPath], {
        cwd: this.projectRoot, env, detached: false, stdio: "ignore",
      });
      let started = false;
      this._proc!.on("error", (e: Error) => {
        this._proc = null;
        this.host.post({ type: "hmeShimStatus", ready: false });
        this.host.postError("shim", `HME shim failed to start: ${e.message}`);
      });
      this._proc!.on("exit", (code: number | null) => {
        const wasStarted = started;
        this._proc = null;
        this.host.post({ type: "hmeShimStatus", ready: false });
        if (!wasStarted) {
          this.host.postError("shim", `HME shim exited before becoming ready (code ${code ?? "?"})`);
        } else if (!this._disposed) {
          this._restartCount++;
          const delay = Math.min(3000 * Math.pow(2, this._restartCount - 1), 30000);
          setTimeout(() => { if (!this._disposed) this.start(); }, delay);
        }
      });
      let attempts = 0;
      const poll = () => {
        attempts++;
        isHmeShimReady().then(({ ready }) => {
          if (ready) {
            started = true;
            this._restartCount = 0;
            this._pollTimer = null;
            this.host.post({ type: "hmeShimStatus", ready: true });
            return;
          }
          if (attempts < MAX_POLL_ATTEMPTS && this._proc) {
            this.host.post({ type: "hmeShimStatus", ready: false, failed: false });
            this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
          } else {
            this._pollTimer = null;
            this._failed = true;
            this.host.post({ type: "hmeShimStatus", ready: false, failed: true });
            this.host.postError(
              "shim",
              `HME shim started but /health not ready after ${attempts * (POLL_INTERVAL_MS / 1000)}s` +
              " — check log/hme-errors.log or run mcp/hme_http.py manually",
            );
          }
        });
      };
      if (this._pollTimer) clearTimeout(this._pollTimer);
      this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (e: any) {
      this.host.postError("shim", `HME shim spawn error: ${e?.message ?? e}`);
    }
  }

  dispose(): void {
    this._disposed = true;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    try {
      this._proc?.kill();
    } catch (e: any) {
      console.error(`[HME] shimProc kill failed: ${e?.message ?? e}`);
    }
    this._proc = null;
  }
}
