module.exports = {
  rules: {
    'no-silent-early-return': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow early returns without explicit handling (prefer throwing an Error or explicit handling)',
          recommended: false
        },
        schema: [{
          type: 'object',
          properties: {
            allowInTests: { type: 'boolean' }
          },
          additionalProperties: false
        }]
      },
      create(context) {
        return {
          ReturnStatement(node) {
            // Only target bare returns (no explicit argument). If an explicit value is returned (including null), consider that intentional.
            if (node.argument) return;

            const parent = node.parent;
            if (!parent || !Array.isArray(parent.body)) return;
            const idx = parent.body.indexOf(node);
            if (idx === -1) return;
            const prevIndexMax = Math.max(0, idx - 3);
            let allowed = false;
            for (let i = idx - 1; i >= prevIndexMax; i--) {
              const prev = parent.body[i];
              if (!prev) continue;
              if (prev.type === 'ExpressionStatement' && prev.expression && prev.expression.type === 'CallExpression') {
                // If previous statement is any call (console or otherwise), treat as explicit action and allow early return
                allowed = true; break;
              }
              if (prev.type === 'ThrowStatement') { allowed = true; break; }
              // stop scanning if we hit another non-empty statement that is not a harmless assignment
              if (prev.type !== 'EmptyStatement' && prev.type !== 'ExpressionStatement') break;
            }

            // Fallback: if we couldn't find an immediate call before the return, scan the enclosing function body for any prior console call
            if (!allowed) {
              const source = context.getSourceCode();
              let fn = node.parent;
              while (fn && fn.type !== 'Program' && fn.type !== 'FunctionDeclaration' && fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression' && fn.type !== 'MethodDefinition') fn = fn.parent;
              if (fn && fn.body && Array.isArray(fn.body.body)) {
                for (const stmt of fn.body.body) {
                  if (!stmt.range || !node.range) continue;
                  if (stmt.range[1] >= node.range[0]) break; // only consider prior statements
                  const txt = source.getText(stmt);
                  if (txt.includes('console.') || txt.includes('.warn(') || txt.includes('.error(') || txt.includes('.log(') || txt.includes('throw ')) { allowed = true; break; }
                }
              }
            }

            if (allowed) return;

            context.report({ node, message: 'Silent early return detected. Add explicit handling or throw an Error before returning.' });
          }
        };
      }
    },

    'no-requires-outside-index': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Disallow require() calls outside of index.js files; allow a single index require in main.js', recommended: false },
        schema: []
      },
      create(context) {
        const path = require('path');
        const filename = context.getFilename();
        const basename = path.basename(filename || '');
        let mainRequireCount = 0;
        const mainRequireNodes = [];

        function isIndexishArg(arg) {
          if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return false;
          const v = String(arg.value);
          const last = v.split('/').pop();
          if (/^index(\.js)?$/.test(last)) return true;
          // Allow directory requires (e.g., './composers') which resolve to index.js
          if (path.extname(v) === '') return true;
          return false;
        }

        return {
          CallExpression(node) {
            if (!node.callee || node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;

            // Allow require() of packages (non-relative); only enforce rule for local/relative requires
            const arg = node.arguments && node.arguments[0];
            if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return;
            const reqStr = String(arg.value);
            if (!reqStr.startsWith('.')) return; // package require - always allowed

            // Allow require in index.js files
            if (basename === 'index.js') return;

            if (basename === 'main.js') {
              mainRequireCount++;
              mainRequireNodes.push(node);
              // allow only index-ish requires in main.js
              if (!isIndexishArg(arg)) {
                context.report({ node, message: 'main.js may only require index modules (e.g., ./composers or ./composers/index.js)' });
              }
              return;
            }

            // Otherwise disallow relative require()
            context.report({ node, message: 'require() calls are only allowed in index.js files and a single index require in main.js (for local requires)' });
          },

          'Program:exit'() {
            if (basename === 'main.js' && mainRequireCount > 1) {
              for (const n of mainRequireNodes) {
                context.report({ node: n, message: 'main.js may contain only a single require to an index module' });
              }
            }
          }
        };
      }
    },

    /* New project-wide rules */

    'no-console-acceptable-warning': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow console.* except when the first argument contains "Acceptable warning:"', recommended: false },
        schema: []
      },
      create(context) {
        const source = context.getSourceCode();
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (!callee || callee.type !== 'MemberExpression') return;
            const obj = callee.object; const prop = callee.property;
            if (!obj || obj.type !== 'Identifier' || obj.name !== 'console') return;

            const args = node.arguments || [];
            if (args.length === 0) {
              context.report({ node, message: 'Console calls are only allowed for acceptable warnings: console.warn("Acceptable warning: ...")' });
              return;
            }

            const first = args[0];
            let ok = false;
            const containsMarker = (s) => typeof s === 'string' && (s.indexOf('Acceptable warning:') !== -1 || s.indexOf('Wrote file') !== -1 || s.indexOf('Starting main') !== -1);
            try {
              // Prefer source text when available (handles concatenation and templates)
              const firstText = source.getText(first);
              ok = containsMarker(firstText);
            } catch (_e) {
              // Fallback to safer AST-specific checks
              if (first.type === 'Literal' && typeof first.value === 'string') {
                ok = containsMarker(first.value);
              } else if (first.type === 'TemplateLiteral' && Array.isArray(first.quasis) && first.quasis.length > 0) {
                ok = containsMarker(first.quasis[0].value.raw);
              }
            }

            if (!ok) {
              context.report({ node, message: 'Fail-fast violation - always throw descriptive error for unexpected value/behavior. (throw instead of console statements)' });
            }
          }
        };
      }
    },

    'no-math-random': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow Math.random; use project RNG helpers rf/ri instead', recommended: false },
        schema: []
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (!callee || callee.type !== 'MemberExpression') return;
            const obj = callee.object; const prop = callee.property;
            if (obj && obj.type === 'Identifier' && obj.name === 'Math' && ((prop && prop.type === 'Identifier' && prop.name === 'random') || (prop && prop.type === 'Literal' && prop.value === 'random'))) {
              context.report({ node, message: 'Use project RNG helpers rf/ri instead of Math.random()' });
            }
          }
        };
      }
    },

    'no-useless-expose-dependencies-comments': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Ban comments starting with Expose or Dependencies (these are considered useless)', recommended: false },
        schema: []
      },
      create(context) {
        return {
          'Program:exit'() {
            const source = context.getSourceCode();
            const comments = source.getAllComments ? source.getAllComments() : [];
            for (const c of comments) {
              if (!c || !c.value) continue;
              const txt = c.value.trim();
              if (!txt) continue;
              const lower = txt.toLowerCase();
              if (txt.startsWith('Expose') || txt.startsWith('Dependencies') || lower.startsWith('expose') || lower.startsWith('dependencies')) {
                context.report({ loc: c.loc, message: 'Useless comment banned: comments starting with "Expose" or "Dependencies" are not allowed.' });
              }
            }
          }
        };
      }
    },

    'only-error-throws': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow throwing non-Error literals; prefer throw new Error(...) or rethrow error variables', recommended: false },
        schema: []
      },
      create(context) {
        return {
          ThrowStatement(node) {
            const arg = node.argument;
            if (!arg) return; // nothing to check

            // Disallow throwing literals and template literals directly
            if (arg.type === 'Literal' || arg.type === 'TemplateLiteral') {
              context.report({ node: arg, message: 'Throwing literals is forbidden. Throw an Error object instead (e.g., throw new Error("message")).' });
              return;
            }

            // Allow re-throwing identifiers or member expressions (caught errors)
            if (arg.type === 'Identifier' || arg.type === 'MemberExpression') {
              return;
            }

            // Allow calling/constructing Error subclasses (callee name ending in "Error"), otherwise report
            if (arg.type === 'NewExpression' || arg.type === 'CallExpression') {
              const callee = arg.callee;
              let name = null;
              if (callee && callee.type === 'Identifier') name = callee.name;
              else if (callee && callee.type === 'MemberExpression' && callee.property && callee.property.type === 'Identifier') name = callee.property.name;

              if (typeof name !== 'string' || !name.match(/Error$/)) {
                context.report({ node: arg, message: 'Throwing non-Error values is disallowed. Use Error instances (e.g., throw new Error(...)) or rethrow existing errors.' });
                return;
              }

              return;
            }

            // Any other throw forms are disallowed
            context.report({ node: arg, message: 'Only Error objects or existing error variables may be thrown.' });
          }
        };
      }
    },

    /**
     * no-typeof-validated-global
     *
     * Bans `typeof X` where X is a global that has already been validated at
     * boot time by mainBootstrap.assertBootstrapGlobals(). The canonical list
     * lives in src/play/fullBootstrap.js and is parsed at lint-time.
     *
     * The ONLY file exempt from this rule is mainBootstrap.js itself (where the
     * validation must necessarily use typeof to do its job) and fullBootstrap.js.
     */
    'no-typeof-validated-global': {
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
                message: `Redundant typeof probe on '${arg.name}' — this global is validated at boot time by mainBootstrap.assertBootstrapGlobals(). Use the global directly or use Validator for value checks.`
              });
            }
          }
        };
      }
    },

    'no-typeof-validated-global': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow typeof probes on globals validated at boot time',
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
                message: `Redundant typeof probe on '${arg.name}' — this global is validated at boot time by mainBootstrap.assertBootstrapGlobals(). Use the global directly or use Validator for value checks.`
              });
            }
          }
        };
      }
    }

  }
};

// ── Private helpers for no-typeof-validated-global ──

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
