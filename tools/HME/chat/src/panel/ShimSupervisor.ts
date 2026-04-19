import * as path from "path";
import { isHmeShimReady } from "../router";
import { PanelHost } from "./PanelHost";

const MAX_POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;

/**
 * Polls the HME worker health endpoint and reports status to the webview.
 *
 * The worker is managed by the proxy supervisor (worker.py on port 9098) —
 * this class no longer spawns anything. It only polls isHmeShimReady() and
 * posts hmeShimStatus messages so the UI can reflect worker availability.
 */
export class ShimSupervisor {
  private _failed = false;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

  constructor(
    private readonly projectRoot: string,
    private readonly host: PanelHost,
  ) {}

  get failed(): boolean {
    return this._failed;
  }

  get isRunning(): boolean {
    return false; // no process owned here — proxy manages the worker
  }

  start(): void {
    if (this._disposed) return;
    this._failed = false;
    let attempts = 0;
    const poll = () => {
      if (this._disposed) return;
      attempts++;
      isHmeShimReady().then(({ ready }) => {
        if (this._disposed) return;
        if (ready) {
          this._pollTimer = null;
          this.host.post({ type: "hmeShimStatus", ready: true });
          return;
        }
        if (attempts < MAX_POLL_ATTEMPTS) {
          this.host.post({ type: "hmeShimStatus", ready: false, failed: false });
          this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          this._pollTimer = null;
          this._failed = true;
          this.host.post({ type: "hmeShimStatus", ready: false, failed: true });
          // Don't postError — proxy supervisor manages restarts; a transient
          // not-ready at chat startup is noise, not a LIFESAVER-worthy fault.
        }
      });
    };
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  dispose(): void {
    this._disposed = true;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }
}
