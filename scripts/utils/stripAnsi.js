/**
 * Remove ANSI escape sequences from a string.
 * @param {string} input - The input string that may contain ANSI codes.
 * @returns {string} Cleaned string without ANSI escape sequences.
 */
export default function stripAnsi(input) {
  return String(input || '').replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}
