/**
 * Format current date as M/D H:MM:SS string.
 * @returns {string} Date in M/D H:MM:SS format.
 */
export default function formatDate() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const h = now.getHours();
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  return `${m}/${d} ${h}:${min}:${sec}`;
}
