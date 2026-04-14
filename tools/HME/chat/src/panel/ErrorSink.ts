import * as fs from "fs";
import * as path from "path";
import { logShimError } from "../router";

/**
 * Routes errors to hme-errors.log via the shim, with a disk-fallback cascade
 * if the shim is down. Never surfaces errors to the user UI — they are
 * Claude-facing (read by Lifesaver), not user-facing.
 *
 * Three levels of defense:
 *   1. logShimError (POST to shim /error endpoint)
 *   2. Direct disk append to log/hme-errors.log
 *   3. console.error (stderr of the ext host)
 */
export class ErrorSink {
  constructor(private readonly projectRoot: string) {}

  post(source: string, message: string): void {
    logShimError(source, message).catch((e: any) => {
      console.error(`[HME FAILFAST] logShimError failed for [${source}] ${message}: ${e?.message ?? e}`);
      const errLine = `[${new Date().toISOString()}] [${source}] ${message}\n`;
      try {
        fs.mkdirSync(path.join(this.projectRoot, "log"), { recursive: true });
        fs.appendFileSync(path.join(this.projectRoot, "log", "hme-errors.log"), errLine);
      } catch (fileErr: any) {
        console.error(`[HME FAILFAST] Disk fallback also failed for [${source}] ${message}: ${fileErr?.message ?? fileErr}`);
      }
    });
  }
}
