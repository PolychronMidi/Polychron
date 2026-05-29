'use strict';
// Self-reload for long-lived shuffler procs. Each proc polls its own source
// file (and any extra deps) for mtime changes and re-execs itself when they
// change, so edits to the shuffler take effect WITHOUT a manual restart --
// the gap that left slot_watchdog/file_watcher running stale code for hours.

const fs = require('fs');
const { spawn } = require('child_process');

function watchSelfAndReexec(entryFile, extraFiles = [], pollMs = 3000) {
  const files = [entryFile, ...extraFiles];
  const mtimes = new Map();
  for (const f of files) {
    try { mtimes.set(f, fs.statSync(f).mtimeMs); } catch (_) { mtimes.set(f, 0); }
  }
  const timer = setInterval(() => {
    for (const f of files) {
      let cur = 0;
      try { cur = fs.statSync(f).mtimeMs; } catch (_) { continue; }
      if (mtimes.get(f) && cur !== mtimes.get(f)) {
        console.error(`[self-reexec] ${f} changed; re-executing ${entryFile}`);
        const child = spawn(process.execPath, [entryFile, ...process.argv.slice(2)], {
          cwd: process.cwd(),
          env: { ...process.env },
          stdio: 'inherit',
          detached: true,
        });
        child.unref();
        clearInterval(timer);
        process.exit(0);
      }
    }
  }, pollMs);
  timer.unref();
}

module.exports = { watchSelfAndReexec };
