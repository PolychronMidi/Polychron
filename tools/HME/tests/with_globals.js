'use strict';
// Hermetic globals helper: applies `overrides`, runs `body()`, restores
// prior values (or deletes if absent before). Prevents cross-spec pollution.

function withGlobals(overrides, body) {
  const prior = {};
  const had = {};
  for (const [k, v] of Object.entries(overrides)) {
    had[k] = Object.prototype.hasOwnProperty.call(global, k);
    if (had[k]) prior[k] = global[k];
    global[k] = v;
  }
  try {
    return body();
  } finally {
    for (const k of Object.keys(overrides)) {
      if (had[k]) {
        global[k] = prior[k];
      } else {
        delete global[k];
      }
    }
  }
}

module.exports = { withGlobals };
