// traceDrain.js - Visual Diagnostic Mode.
// Captures per-beat conductor and cross-layer state continuously if --trace is passed.

traceDrain = (() => {

  let isTracing = false;
  let fd = null;

  function init() {
    if (!process.argv.includes('--trace')) return;
    isTracing = true;

    const outDir = path.resolve(process.cwd(), 'output');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const filepath = path.join(outDir, 'trace.jsonl');

    // Clear out the old trace file to avoid runaway file sizes across multiple dev runs
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch {
      // Non-fatal
    }

    fd = fs.openSync(filepath, 'a');

    // We should safely close when main loop completes. But since fs.writeSync is blocking
    // and process finishes, it will close naturally, or we provide a close method.
  }

  /**
   * Record one trace beat entry.
   * @param {string} layer
   * @param {{ beatKey: string, timeMs: number, conductorSnap: any, negotiation: any, trustScores: any, regime: any, couplingMatrix: any }} data
   */
  function record(layer, data) {
    if (!isTracing || fd === null) return;
    const payload = {
      layer,
      beatKey: data.beatKey,
      timeMs: data.timeMs,
      snap: data.conductorSnap,
      negotiation: data.negotiation,
      trust: data.trustScores,
      regime: data.regime,
      coupling: data.couplingMatrix
    };

    fs.writeSync(fd, JSON.stringify(payload) + '\n');
  }

  function shutdown() {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Non-fatal
      }
      fd = null;
    }
  }

  return { init, record, shutdown };
})();
