#!/usr/bin/env python3
"""HME architectural invariant prover.

Complements the 24 per-file ESLint rules and 8 pipeline validators by
answering global/dataflow questions across the whole codebase. Per-file
rules catch "this line is wrong." The prover answers "this property
holds / doesn't hold across all N files."

Canonical invariant types (v0):

  sole-writer  target=<SYMBOL> allowed=<GLOB>
    All assignments to SYMBOL (matches `SYMBOL=` or `SYMBOL \\s*=`) must
    live in files whose relative path matches GLOB. Example:
      sole-writer target=couplingMatrix allowed='src/conductor/**'

  no-import    from=<MODULE> in=<GLOB>
    None of the files matching GLOB may import MODULE. Detects both
    require() and ES6 import syntax. Example:
      no-import from=conductorIntelligence in='src/crossLayer/**'

  sole-caller  function=<NAME> allowed=<GLOB>
    All call sites of NAME() must live in files matching GLOB.
      sole-caller function=setBinaural allowed='src/play/grandFinale.js'

Output is PROVEN / VIOLATED JSON on stdout. On VIOLATED, `counterexamples`
lists the offending file:line:text. Exit code 0 if PROVEN, 1 if VIOLATED,
2 on usage error.
"""
import fnmatch
import json
import os
import re
import sys

SRC_EXTS = ('.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx')


def _die(msg, code=2):
    print(json.dumps({"error": msg}), file=sys.stderr)
    sys.exit(code)


def _parse_kv(argv):
    out = {}
    for arg in argv:
        if '=' not in arg:
            _die(f"expected key=value, got: {arg}")
        k, _, v = arg.partition('=')
        out[k] = v.strip("'\"")
    return out


def _walk(root, rel_glob=None):
    """Yield (abs_path, rel_path) for every source file under root.

    When rel_glob is given, only paths matching it are yielded.
    """
    for dirpath, _dirs, files in os.walk(root):
        # Skip vendored / generated roots.
        if '/node_modules' in dirpath or '/.git' in dirpath or '/output/' in dirpath:
            continue
        for name in files:
            if not name.endswith(SRC_EXTS):
                continue
            abs_p = os.path.join(dirpath, name)
            rel = os.path.relpath(abs_p, root)
            if rel_glob and not fnmatch.fnmatch(rel, rel_glob):
                pass  # still yield; the caller will filter
            yield abs_p, rel


def _match_glob(rel, glob):
    # Support recursive ** by converting to fnmatch double-star semantics.
    # fnmatch doesn't grok **; emulate by stripping the last `/**` and
    # matching prefix.
    if glob.endswith('/**'):
        prefix = glob[:-3]
        return rel.startswith(prefix.rstrip('/') + '/') or rel == prefix.rstrip('/')
    return fnmatch.fnmatch(rel, glob)


def _scan_hits(root, pattern, ignore_comments=True):
    """Return list of (rel_path, line_no, line_text) matching pattern.

    Line-by-line regex. When ignore_comments is True, skip obvious
    single-line comments (// or /* ... */ on one line).
    """
    rx = re.compile(pattern)
    hits = []
    for abs_p, rel in _walk(root):
        try:
            with open(abs_p, 'r', encoding='utf-8') as f:
                for ln, raw in enumerate(f, 1):
                    stripped = raw.strip()
                    if ignore_comments and (stripped.startswith('//') or stripped.startswith('*')):
                        continue
                    if rx.search(raw):
                        hits.append((rel, ln, raw.rstrip('\n')))
        except (OSError, UnicodeDecodeError) as err:
            # Fail loudly — the scan is the whole point; silent skips hide bugs.
            print(f"[prove] read failed {abs_p}: {err}", file=sys.stderr)
    return hits


def _invariant_sole_writer(root, args):
    target = args.get('target') or _die("sole-writer: missing target=")
    allowed = args.get('allowed') or _die("sole-writer: missing allowed=")
    # Match `target = ...` or `target.x = ...` at assignment position.
    # Exclude comparisons (==, ===, !=).
    pat = rf'(?<![=!<>])\b{re.escape(target)}\s*(?:\.\w+\s*)?=\s*(?!=)'
    hits = _scan_hits(root, pat)
    violations = [(rel, ln, txt) for rel, ln, txt in hits
                  if not _match_glob(rel, allowed)]
    return {
        'invariant': 'sole-writer',
        'target': target,
        'allowed': allowed,
        'total_writes': len(hits),
        'violations': len(violations),
        'proven': len(violations) == 0,
        'counterexamples': [{'file': r, 'line': l, 'text': t[:160]}
                            for r, l, t in violations[:20]],
    }


def _invariant_no_import(root, args):
    module = args.get('from') or _die("no-import: missing from=")
    scope = args.get('in') or _die("no-import: missing in=")
    # Match `require('module')` or `from 'module'` or `import 'module'`
    pat = (rf'require\s*\(\s*[\'"]{re.escape(module)}[\'"]\s*\)'
           rf'|from\s+[\'"]{re.escape(module)}[\'"]'
           rf'|import\s+[\'"]{re.escape(module)}[\'"]')
    all_hits = _scan_hits(root, pat)
    violations = [(r, l, t) for r, l, t in all_hits if _match_glob(r, scope)]
    return {
        'invariant': 'no-import',
        'from': module,
        'in': scope,
        'violations': len(violations),
        'proven': len(violations) == 0,
        'counterexamples': [{'file': r, 'line': l, 'text': t[:160]}
                            for r, l, t in violations[:20]],
    }


def _invariant_sole_caller(root, args):
    fn = args.get('function') or _die("sole-caller: missing function=")
    allowed = args.get('allowed') or _die("sole-caller: missing allowed=")
    # Match `NAME(` not preceded by a word char (to avoid `setNAME(`).
    pat = rf'(?<![\w.]){re.escape(fn)}\s*\('
    hits = _scan_hits(root, pat)
    # Also exclude the definition sites (function NAME( / const NAME = function()
    def_pat = re.compile(rf'\bfunction\s+{re.escape(fn)}\s*\(|\b{re.escape(fn)}\s*=\s*(?:async\s+)?(?:function|\()')
    hits = [(r, l, t) for r, l, t in hits if not def_pat.search(t)]
    violations = [(r, l, t) for r, l, t in hits if not _match_glob(r, allowed)]
    return {
        'invariant': 'sole-caller',
        'function': fn,
        'allowed': allowed,
        'total_calls': len(hits),
        'violations': len(violations),
        'proven': len(violations) == 0,
        'counterexamples': [{'file': r, 'line': l, 'text': t[:160]}
                            for r, l, t in violations[:20]],
    }


INVARIANTS = {
    'sole-writer': _invariant_sole_writer,
    'no-import': _invariant_no_import,
    'sole-caller': _invariant_sole_caller,
}


def main(argv):
    if len(argv) < 2:
        _die(f"usage: prove.py <invariant> <key=val>...  invariants: {sorted(INVARIANTS)}")
    kind = argv[1]
    if kind not in INVARIANTS:
        _die(f"unknown invariant '{kind}'. Known: {sorted(INVARIANTS)}")
    args = _parse_kv(argv[2:])
    root = os.environ.get('PROJECT_ROOT') or os.getcwd()
    src_root = os.path.join(root, 'src')
    if not os.path.isdir(src_root):
        _die(f"src/ not found under {root}")
    result = INVARIANTS[kind](src_root, args)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['proven'] else 1)


if __name__ == '__main__':
    main(sys.argv)
