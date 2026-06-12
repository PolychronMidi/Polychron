'use strict';
// Pure restart-coordination state machine -- NO I/O, NO timers, NO spawn.
// The file-watcher feeds it events; it returns the actions to take. Keeping

function createRestartCoordinator() {
  const state = {
    pendingPath: null,     // newest changed path awaiting a restart
    inFlight: false,       // a restart is currently running
    scheduled: false,      // a debounce timer is pending -> a restart will fire
    nextSlot: 'a',
  };

  // A change arrived. Returns { schedule: bool } -- caller (re)arms the timer.
  function onChange(filePath) {
    state.pendingPath = filePath;
    if (state.inFlight) return { schedule: false };  // will re-fire on restart-done
    state.scheduled = true;
    return { schedule: true };
  }

  // The debounce timer elapsed. Returns the restart to run, or null if a
  // restart is already in flight (the pending change rides the in-flight one).
  function onDebounceElapsed() {
    state.scheduled = false;
    if (state.inFlight) return null;
    if (state.pendingPath == null) return null;
    const slot = state.nextSlot;
    state.nextSlot = slot === 'a' ? 'b' : 'a';
    state.inFlight = true;
    const path = state.pendingPath;
    state.pendingPath = null;
    return { slot, path };
  }

  // A restart finished. If a change landed during it, return the next restart
  // to run immediately (the OTHER slot); else null. A failed restart may clear
  // pending work instead of chaining, preserving the last-viable fallback slot.
  function onRestartDone(opts = {}) {
    state.inFlight = false;
    if (opts.clearPending) state.pendingPath = null;
    if (state.pendingPath == null) return null;
    const slot = state.nextSlot;
    state.nextSlot = slot === 'a' ? 'b' : 'a';
    state.inFlight = true;
    const path = state.pendingPath;
    state.pendingPath = null;
    return { slot, path };
  }

  // True when there is nothing pending and nothing in progress -> fully caught up.
  function isSettled() {
    return state.pendingPath == null && !state.inFlight && !state.scheduled;
  }

  // True when a change is pending but nothing will act on it -> THE BUG. Must
  // never be true after a well-formed event sequence.
  function isStranded() {
    return state.pendingPath != null && !state.inFlight && !state.scheduled;
  }

  return { onChange, onDebounceElapsed, onRestartDone, isSettled, isStranded, _state: state };
}

module.exports = { createRestartCoordinator };
