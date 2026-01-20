/**
 * Format current date as MM/DD/YY string.
 * @returns {string} Date in MM/DD/YY format.
 */
export default function formatDateMMDDYY() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}
