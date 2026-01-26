/**
 * Utilities around the canonical TODO template used in TODO files.
 */
const HEADER_MARKER = '### TODO TEMPLATE (Leave this template at top of file as format reminder)';

/**
 * Generate the canonical TODO template with the given date string inserted.
 * @param {string} dateStr
 * @returns {string}
 */
function makeTemplate(dateStr) {
  return `### TODO TEMPLATE (Leave this template at top of file as format reminder)
### REVIEW \`RULES.md\` RELIGIOUSLY, ESPECIALLY BEFORE COMMUNICATING OUTSIDE OF THIS CHANNEL - THIS FILE IS THE MAIN PROJECT COORDINATION CHANNEL

*** [${dateStr}] Example (newest) TODO Title - One sentence summary.
- [${dateStr}] Timestamped note of latest development or roadblock for this TODO
- [${dateStr}] Older timestamped notes for this TODO
*** [${dateStr}] Example Todo #2 (older) , start actual TODO list below like in formart shown here.
- [${dateStr}] Remember to revisit the TODO often, always adding/updating timestamps at line starts.
---\n`;
}

module.exports = makeTemplate;
module.exports.HEADER_MARKER = HEADER_MARKER;
