let _cachedValidatedGlobals = null;

/**
 * Parse fullBootstrap.js to extract the VALIDATED_GLOBALS array at lint time.
 * We read the source file and extract quoted strings from the array literal,
 * avoiding a runtime require of the project code (which has side-effects).
 * @returns {Set<string>}
 */
function _loadValidatedGlobals() {
  const fs = require('fs');
  const path = require('path');
  // Use process.cwd() as project root
  const bootstrapPath = path.resolve(process.cwd(), 'src', 'play', 'fullBootstrap.js');
  let text;
  try {
    text = fs.readFileSync(bootstrapPath, 'utf8');
  } catch (_e) {
    // If file doesn't exist yet, return empty set (rule becomes no-op)
    return new Set();
  }
  const names = new Set();
  // Match all single-quoted string literals inside the VALIDATED_GLOBALS array
  const regex = /'([A-Za-z_$][\w$]*)'/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    names.add(match[1]);
  }
  return names;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow typeof probes on globals that are proven-defined by mainBootstrap.assertBootstrapGlobals()',
      recommended: false
    },
    schema: []
  },
  create(context) {
    const pathMod = require('path');
    const filename = context.getFilename();
    const basename = pathMod.basename(filename || '');

    // Exempt: mainBootstrap.js (where validation happens) and fullBootstrap.js (the list itself)
    if (basename === 'mainBootstrap.js' || basename === 'fullBootstrap.js') return {};

    // Load the validated globals set from fullBootstrap.js at lint time (parse the array literal)
    if (!_cachedValidatedGlobals) {
      _cachedValidatedGlobals = _loadValidatedGlobals();
    }
    const validated = _cachedValidatedGlobals;
    if (!validated || validated.size === 0) return {};

    return {
      UnaryExpression(node) {
        if (node.operator !== 'typeof') return;
        const arg = node.argument;
        if (!arg || arg.type !== 'Identifier') return;
        if (validated.has(arg.name)) {
          context.report({
            node,
            message: `Redundant typeof probe on '${arg.name}' — this global is validated at boot time by mainBootstrap.assertBootstrapGlobals(). Use the global directly or use validator for value checks.`
          });
        }
      }
    };
  }
};
