import * as fs from "fs";
import * as path from "path";
import { logShimError } from "../router";

/**
 * Routes chat-extension errors to BOTH surfaces that monitor project health:
 *   - log/hme-errors.log — scanned by userpromptsubmit.sh + stop.sh (LIFESAVER
 *     turn-level alerts; surfaces to the agent at the next turn boundary)
 *   - worker /error endpoint — feeds worker.recent_errors for sessionstart.sh
 *     (LIFESAVER session-level banner)
 *
 * Prior behavior wrote to the log ONLY on shim-failure. Chat errors landed
 * in worker.recent_errors but never reached LIFESAVER during a session, so
 * the user saw error bubbles in the chat UI while the agent remained blind
 * until session restart. Now BOTH paths fire on every error — the disk log
 * is authoritative, the worker ping is best-effort telemetry.
 */
export class ErrorSink {
  constructor(private readonly projectRoot: string) {}

  post(source: string, message: string): void {
    // Authoritative: disk log (always). LIFESAVER userpromptsubmit.sh scans
    // this file every turn, so per-turn alerts land here.
    const errLine = `[${new Date().toISOString()}] [${source}] ${message}\n`;
    try {
      fs.mkdirSync(path.join(this.projectRoot, "log"), { recursive: true });
      fs.appendFileSync(path.join(this.projectRoot, "log", "hme-errors.log"), errLine);
    } catch (fileErr: any) {
      console.error(`[HME FAILFAST] disk append failed for [${source}] ${message}: ${fileErr?.message ?? fileErr}`);
    }
    // Best-effort: worker telemetry. Failure is non-fatal since the disk log
    // already captured the error. Catches network/shim-down without masking
    // the real error message.
    logShimError(source, message).catch((e: any) => {
      console.error(`[HME] logShimError telemetry failed for [${source}]: ${e?.message ?? e}`);
    });
  }
}
