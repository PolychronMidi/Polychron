'use strict';
// Transitional shell wrapper. evolver parses .claude/hme-evolver.local.md
// frontmatter and drives an iteration loop; wrap for now.
const { shellPolicy } = require('../shell_policy');
module.exports = shellPolicy('evolver');
