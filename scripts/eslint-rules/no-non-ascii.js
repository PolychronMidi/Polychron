module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow characters not on a standard US keyboard (non-ASCII)', recommended: false },
    schema: []
  },
  create(context) {
    return {
      Program(node) {
        const source = context.getSourceCode();
        const text = source.getText();

        // Catch sentinel left by fix-non-ascii.js for unmapped characters.
        const sentinelRe = /\?unknown-ascii-character\?/g;
        let sm;
        while ((sm = sentinelRe.exec(text)) !== null) {
          context.report({
            node,
            loc: source.getLocFromIndex(sm.index),
            message: 'Unknown non-ASCII character was replaced by sentinel. Add a mapping for it in scripts/pipeline/fix-non-ascii.js REPLACEMENTS.'
          });
        }

        // Match any character outside printable ASCII (0x20-0x7E) and standard
        // whitespace (tab 0x09, newline 0x0A, carriage return 0x0D).
        const nonAscii = /[^\x09\x0A\x0D\x20-\x7E]/g;
        let match;
        while ((match = nonAscii.exec(text)) !== null) {
          const idx = match.index;
          const loc = source.getLocFromIndex(idx);
          const char = match[0];
          const hex = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
          context.report({
            node,
            loc,
            message: 'Non-ASCII character U+{{ hex }} ({{ char }}) is not on a standard US keyboard. Use ASCII equivalents (e.g. -> instead of arrows).',
            data: { hex, char }
          });
        }
      }
    };
  }
};
