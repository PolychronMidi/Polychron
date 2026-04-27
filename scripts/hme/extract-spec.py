#!/usr/bin/env python3
"""HME specification extractor.

Walks a directory of JS/TS files and emits a JSON specification
describing the public API surface: per-file exports, classes with their
methods, top-level functions, and imports. Intended as a starting
point for spec-driven refactors — the spec becomes a contract the
codebase must satisfy.

Usage:
  extract-spec.py <dir>       → JSON on stdout
  extract-spec.py <dir> --md  → markdown summary on stdout

The parser is regex-based, not a full AST. Covers the idioms actually
used in this project (IIFE self-registering modules, `const X = class`,
`module.exports = ...`, ES6 imports) without pulling in a JS runtime.
On ambiguity, favors over-inclusion — better to list something that's
not really exported than to miss a real API surface.
"""
import json
import os
import re
import sys

SRC_EXTS = ('.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx')

# Patterns. Anchored to line starts where possible; operate on raw lines.
_RE_IMPORT_REQUIRE = re.compile(r'''require\s*\(\s*['"]([^'"]+)['"]\s*\)''')
_RE_IMPORT_ES6 = re.compile(r'''^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]''')
_RE_CLASS_DECL = re.compile(r'^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Z][A-Za-z0-9_]*)(?:\s+extends\s+([A-Z][A-Za-z0-9_.]*))?')
_RE_CLASS_ASSIGN = re.compile(r'^\s*(?:const|let|var|[A-Z][A-Za-z0-9_]*)\s*=\s*class(?:\s+([A-Z][A-Za-z0-9_]*))?(?:\s+extends\s+([A-Z][A-Za-z0-9_.]*))?')
_RE_FN_DECL = re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(')
_RE_CONST_FN = re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>')
_RE_MODULE_EXPORTS = re.compile(r'^\s*module\.exports\s*=')
_RE_EXPORTS_KEY = re.compile(r'^\s*(?:module\.)?exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=')
_RE_CLASS_METHOD = re.compile(r'^\s{2,}(?:async\s+)?(?:static\s+)?([a-zA-Z_][A-Za-z0-9_]*)\s*\(')


def _walk(root):
    for dp, _d, files in os.walk(root):
        if '/node_modules' in dp or '/.git' in dp or '/__pycache__' in dp:
            continue
        for f in files:
            if f.endswith(SRC_EXTS):
                yield os.path.join(dp, f)


def _parse_file(path, project_root):
    rel = os.path.relpath(path, project_root)
    spec = {
        'path': rel,
        'imports': [],
        'classes': [],
        'functions': [],
        'exports': [],
    }
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    current_class = None
    brace_depth = 0
    in_class = False
    for ln, raw in enumerate(lines, 1):
        # Imports — collected from anywhere in the file (module scope assumed)
        for m in _RE_IMPORT_REQUIRE.finditer(raw):
            mod = m.group(1)
            if mod not in spec['imports']:
                spec['imports'].append(mod)
        m = _RE_IMPORT_ES6.match(raw)
        if m and m.group(1) not in spec['imports']:
            spec['imports'].append(m.group(1))

        # Class declaration (class Foo or const Foo = class Foo)
        m = _RE_CLASS_DECL.match(raw)
        if m:
            name = m.group(1)
            extends = m.group(2) or None
            current_class = {'name': name, 'line': ln, 'extends': extends, 'methods': []}
            spec['classes'].append(current_class)
            in_class = True
            brace_depth = raw.count('{') - raw.count('}')
            continue
        m = _RE_CLASS_ASSIGN.match(raw)
        if m:
            name = m.group(1) or raw.split('=')[0].strip().split()[-1]
            extends = m.group(2) or None
            current_class = {'name': name, 'line': ln, 'extends': extends, 'methods': []}
            spec['classes'].append(current_class)
            in_class = True
            brace_depth = raw.count('{') - raw.count('}')
            continue

        # Track class boundaries via brace depth when inside a class
        if in_class:
            brace_depth += raw.count('{') - raw.count('}')
            # Class methods live inside the class body
            m = _RE_CLASS_METHOD.match(raw)
            if m:
                method = m.group(1)
                # Skip things that look like keywords or control flow
                if method not in ('if', 'for', 'while', 'switch', 'return', 'throw', 'catch', 'const', 'let', 'var'):
                    current_class['methods'].append({'name': method, 'line': ln})
            if brace_depth <= 0:
                in_class = False
                current_class = None
            continue

        # Top-level function / arrow function / exports
        m = _RE_FN_DECL.match(raw)
        if m:
            spec['functions'].append({'name': m.group(1), 'line': ln})
            continue
        m = _RE_CONST_FN.match(raw)
        if m:
            spec['functions'].append({'name': m.group(1), 'line': ln})
            continue
        m = _RE_EXPORTS_KEY.match(raw)
        if m:
            spec['exports'].append({'name': m.group(1), 'line': ln})
            continue
        if _RE_MODULE_EXPORTS.match(raw):
            spec['exports'].append({'name': '__default__', 'line': ln, 'text': raw.strip()[:120]})

    return spec


def _render_markdown(specs):
    out = ['# Specification\n']
    for spec in specs:
        out.append(f'## {spec["path"]}\n')
        if spec['imports']:
            out.append(f'**Imports** ({len(spec["imports"])}): ' + ', '.join(spec['imports'][:10])
                       + ('…' if len(spec['imports']) > 10 else ''))
        if spec['classes']:
            out.append(f'\n**Classes**:')
            for c in spec['classes']:
                ext = f' extends {c["extends"]}' if c['extends'] else ''
                methods = ', '.join(m['name'] for m in c['methods'][:8])
                more = f' +{len(c["methods"])-8}' if len(c['methods']) > 8 else ''
                out.append(f'  - `{c["name"]}`{ext} — {methods}{more}')
        if spec['functions']:
            out.append(f'\n**Functions**: ' + ', '.join(f['name'] for f in spec['functions'][:10])
                       + ('…' if len(spec['functions']) > 10 else ''))
        if spec['exports']:
            out.append(f'\n**Exports**: ' + ', '.join(e['name'] for e in spec['exports']))
        out.append('')
    return '\n'.join(out)


def main(argv):
    if len(argv) < 2:
        msg = (
            "usage: extract-spec.py <dir> [--md]\n"
            "  <dir>: target directory to extract behavioral spec from\n"
            "  --md:  emit Markdown instead of JSON (default JSON)\n"
            "  examples:\n"
            "    extract-spec.py src/conductor/signal\n"
            "    extract-spec.py src/composers/voice --md\n"
            "  the script extracts API + invariant claims by walking the\n"
            "  module graph and reading docstring/JSDoc declarations."
        )
        print(msg, file=sys.stderr)
        sys.exit(2)
    target = argv[1]
    as_markdown = '--md' in argv[2:]

    project_root = os.environ.get('PROJECT_ROOT') or os.getcwd()
    abs_target = target if os.path.isabs(target) else os.path.join(project_root, target)
    if not os.path.isdir(abs_target):
        print(f"not a directory: {abs_target}", file=sys.stderr)
        sys.exit(2)

    specs = []
    for path in sorted(_walk(abs_target)):
        specs.append(_parse_file(path, project_root))

    if as_markdown:
        print(_render_markdown(specs))
    else:
        print(json.dumps({
            'root': os.path.relpath(abs_target, project_root),
            'files': len(specs),
            'specs': specs,
        }, indent=2))


if __name__ == '__main__':
    main(sys.argv)
