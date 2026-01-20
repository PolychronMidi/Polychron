/**
 * Normalize source code for comparison by collapsing whitespace and trimming lines.
 * @param {string} code - The code snippet to normalize.
 * @returns {string} Normalized code string.
 */
export default function normalizeCodeForComparison(code) {
  return code.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').trim();
}
