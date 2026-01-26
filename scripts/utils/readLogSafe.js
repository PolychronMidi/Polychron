/**
 * Safely read a log file from the project's log directory.
 * @param {string} projectRoot - The root path of the project (defaults to process.cwd()).
 * @param {string} fileName - The filename inside the log directory.
 * @returns {string} File contents or empty string if missing.
 */
const fs = require('fs');
const path = require('path');
module.exports = function readLogSafe(projectRoot = process.cwd(), fileName) {
  const logPath = path.join(projectRoot, 'log', fileName);
  if (!fs.existsSync(logPath)) return '';
  return fs.readFileSync(logPath, 'utf-8');
};
