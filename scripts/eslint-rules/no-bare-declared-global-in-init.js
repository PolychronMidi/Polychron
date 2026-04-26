// Inside a moduleLifecycle.declare({ ..., init: (deps) => { BODY } }) body,
// references to OTHER declared modules must flow through the deps argument
// (or be aliased from deps at the top of init). Bare global references like
// `metaProfiles.foo()` work today via the namespace, but they bypass the
// dependency contract -- the module's deps array doesn't reflect what it
// actually uses, and changing the registry's resolution path won't be
// type-safe.
//
// This rule warns (not errors) so existing modules can be migrated
// incrementally. After the sweep, promote to error to lock in semantic DI.
//
// Allow-listed: globals that are intentionally legacy (validator,
// controllerConfig, etc. are commonly aliased from deps via `const X = deps.X`
// at init top -- the rule detects that alias and stops flagging).

'use strict';

const fs = require('fs');
const path = require('path');

// Cached on first lint invocation; rebuilt per-run is fine since the rule
// fires per-file and ESLint instances are short-lived.
let _declaredCache = null;
function getDeclaredNames() {
  if (_declaredCache) return _declaredCache;
  const SRC = path.join(__dirname, '..', '..', 'src');
  const out = new Set();
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        const re = /moduleLifecycle\.declare\(\{[^]*?provides:\s*\[([^\]]+)\][^]*?\}\);/g;
        let m;
        while ((m = re.exec(src)) !== null) {
          for (const n of m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)) {
            out.add(n);
          }
        }
      }
    }
  }
  walk(SRC);
  _declaredCache = out;
  return out;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Inside an init: (deps) => {} body, declared-module references must flow through deps (or be aliased: const X = deps.X).',
    },
    schema: [],
  },
  create(context) {
    const declared = getDeclaredNames();
    if (declared.size === 0) return {};

    // Track aliases: `const NAME = deps.NAME;` makes NAME safe to use bare.
    const aliasedFromDeps = new Set();
    // Track lazyDeps: declared in the manifest's lazyDeps array.
    const lazyDeps = new Set();
    // Track manifest's own provides -- self-references (the module accessing
    // its own globally-bound API from inside init body callbacks) are not
    // a DI violation; you can't add a module to its own deps. Skip these.
    const ownProvides = new Set();
    // Track init function nesting depth.
    let inInitDepth = 0;
    let initFnNode = null;

    function isInitArrow(node) {
      // Looking for: { key: 'init', value: ArrowFunctionExpression(deps => ...) }
      // inside an ObjectExpression that's the argument of moduleLifecycle.declare(...)
      const parent = node.parent;
      if (!parent || parent.type !== 'Property' || parent.key.name !== 'init') return false;
      const obj = parent.parent;
      if (!obj || obj.type !== 'ObjectExpression') return false;
      const call = obj.parent;
      if (!call || call.type !== 'CallExpression') return false;
      const callee = call.callee;
      if (!callee || callee.type !== 'MemberExpression') return false;
      return callee.object && callee.object.name === 'moduleLifecycle'
          && callee.property && callee.property.name === 'declare';
    }

    return {
      ArrowFunctionExpression(node) {
        if (isInitArrow(node)) {
          inInitDepth++;
          initFnNode = node;
          // Walk the manifest object for lazyDeps and the consumer's own
          // name/provides. Both populate the silenced set for this scope.
          const initProperty = node.parent;
          const manifestObj = initProperty && initProperty.parent;
          if (manifestObj && manifestObj.type === 'ObjectExpression') {
            for (const prop of manifestObj.properties) {
              if (prop.type !== 'Property' || !prop.key) continue;
              const key = prop.key.name || prop.key.value;
              if (key === 'lazyDeps') {
                if (prop.value && prop.value.type === 'ArrayExpression') {
                  for (const el of prop.value.elements) {
                    if (el && el.type === 'Literal' && typeof el.value === 'string') {
                      lazyDeps.add(el.value);
                    }
                  }
                }
              } else if (key === 'name') {
                if (prop.value && prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
                  ownProvides.add(prop.value.value);
                }
              } else if (key === 'provides') {
                if (prop.value && prop.value.type === 'ArrayExpression') {
                  for (const el of prop.value.elements) {
                    if (el && el.type === 'Literal' && typeof el.value === 'string') {
                      ownProvides.add(el.value);
                    }
                  }
                }
              }
            }
          }
        }
      },
      'ArrowFunctionExpression:exit'(node) {
        if (node === initFnNode) {
          inInitDepth--;
          if (inInitDepth === 0) {
            initFnNode = null;
            aliasedFromDeps.clear();
            lazyDeps.clear();
            ownProvides.clear();
          }
        }
      },
      VariableDeclarator(node) {
        if (inInitDepth === 0) return;
        // Match: `const X = deps.X` or `const X = deps['X']`
        if (node.id && node.id.type === 'Identifier' && node.init
            && node.init.type === 'MemberExpression'
            && node.init.object && node.init.object.type === 'Identifier'
            && node.init.object.name === 'deps') {
          aliasedFromDeps.add(node.id.name);
        }
      },
      Identifier(node) {
        if (inInitDepth === 0) return;
        const name = node.name;
        if (!declared.has(name)) return;
        if (aliasedFromDeps.has(name)) return;
        if (lazyDeps.has(name)) return;
        if (ownProvides.has(name)) return;
        // Skip property accesses like `obj.metaProfiles` (we only care about
        // bare-identifier references to declared modules).
        const parent = node.parent;
        if (parent && parent.type === 'MemberExpression' && parent.property === node) return;
        // Skip property keys like `{ metaProfiles: ... }` and ObjectPatterns.
        if (parent && parent.type === 'Property' && parent.key === node) return;
        // Skip the manifest's own `name`/`provides` strings (literal-typed) -- those are not Identifier nodes anyway.
        // Skip references inside the manifest object itself (deps array, provides array, etc.).
        // The init-arrow gate handles this -- only fire inside init body.
        // Skip references in argument positions that might pass through to deps.
        context.report({
          node,
          message: `Bare reference to declared module "${name}" inside init() body. Use deps.${name} or alias via "const ${name} = deps.${name};" at init top.`,
        });
      },
    };
  },
};
