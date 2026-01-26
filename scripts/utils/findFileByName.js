/**
 * Search for a file with a given name under a root directory with limited recursion depth.
 * @param {string} root - Root directory to search.
 * @param {string} name - File name to find.
 * @param {number} [maxDepth=3] - Max recursion depth.
 * @returns {string|null} Absolute path if found, otherwise null.
 */
const fs = require('fs');
const path = require('path');
module.exports = function findFileByName(root, name, maxDepth = 3) {
  const seen = new Set();
  function search(dir, depth) {
    if (depth > maxDepth) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.name === name) return full;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const full = path.join(dir, ent.name);
        if (!seen.has(full)) { seen.add(full); const res = search(full, depth + 1); if (res) return res; }
      }
    }
    return null;
  }
  return search(root, 0);
};
