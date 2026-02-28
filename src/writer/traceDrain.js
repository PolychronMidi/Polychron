// traceDrain.js - Visual Diagnostic Mode.
// Captures per-beat conductor and cross-layer state continuously if --trace is passed.

traceDrain = (() => {

  let isTracing = false;
  let fd = null;
  const _buffer = [];
  const FLUSH_INTERVAL = 50; // flush every N records to reduce sync I/O calls

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
  }

  /** Flush buffered records to disk in a single write. */
  function _flush() {
    if (_buffer.length === 0 || fd === null) return;
    fs.writeSync(fd, _buffer.join(''));
    _buffer.length = 0;
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

    _buffer.push(JSON.stringify(payload) + '\n');
    if (_buffer.length >= FLUSH_INTERVAL) _flush();
  }

  function shutdown() {
    _flush();
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
