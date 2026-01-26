/**
 * Split text by Markdown code fences into parts of type 'text' or 'code'.
 * @param {string} content - Markdown content to split.
 * @returns {{type: string, text: string}[]} Array of parts.
 */
module.exports = function splitByCodeFences(content) {
  const parts = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let buffer = [];
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      buffer.push(line);
      if (inFence) {
        parts.push({ type: 'code', text: buffer.join('\n') });
        buffer = [];
        inFence = false;
      } else {
        parts.push({ type: 'text', text: buffer.slice(0, -1).join('\n') });
        buffer = [line];
        inFence = true;
      }
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length) {
    parts.push({ type: inFence ? 'code' : 'text', text: buffer.join('\n') });
  }
  return parts;
};
