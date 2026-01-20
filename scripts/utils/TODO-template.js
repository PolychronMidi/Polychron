/**
 * Utilities around the canonical TODO template used in TODO files.
 */
export const HEADER_MARKER = '### TODO TEMPLATE (Leave this template at top of file as format reminder)';

/**
 * Generate the canonical TODO template with the given date string inserted.
 * @param {string} dateStr
 * @returns {string}
 */
export default function makeTemplate(dateStr) {
  return `### TODO TEMPLATE (Leave this template at top of file as format reminder)

*** [${dateStr}] Example (newest) TODO Title - One sentence summary.
- [${dateStr}] Timestamped note of latest development or roadblock for this TODO
- [${dateStr}] Older timestamped notes for this TODO
*** [${dateStr}] Example Todo #2 (older) , start actual TODO list below like in formart shown here.
- [${dateStr}] Remember to revisit the TODO often, always adding/updating timestamps at line starts.
---\n`;
}

/**
 * Return the commented placeholder template used by `clear-todos` when inserting a template into docs.
 * The placeholder keeps `MM/DD HH:MM` to indicate the expected format.
 */
export function placeholderTemplate() {
  return `<!--
### TODO TEMPLATE (Leave this template at top of file as format reminder)

*** [MM/DD HH:MM] Example (newest) TODO Title - One sentence summary.
- [MM/DD HH:MM] Timestamped note of latest development or roadblock for this TODO
- [MM/DD HH:MM] Older timestamped notes for this TODO

*** [MM/DD HH:MM] Example Todo #2 (older) , start actual TODO list below like in formart shown here.
- [MM/DD HH:MM] Remember to revisit the TODO often, always adding/updating timestamps at line starts.
---

-->\n`;
}
