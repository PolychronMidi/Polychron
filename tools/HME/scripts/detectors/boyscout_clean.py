#!/usr/bin/env python3
# Boyscout clean-room: every file Edited/Written must pass all applicable audits.
# Verdicts: ok | comment_bloat | char_spam | loc_bloat

from __future__ import annotations
import os, sys, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import _parse_all, event_content, is_assistant

LOC_LIMIT = 350
SPAM_RE = re.compile(r'([^\w\s()\[\]{}])\1{3,}')
SPAM_ALLOW = 'spam-ok'
import json as _json
_SPAM_SKIP = set()
try:
    _skip_cfg = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'config', 'verifier-skip.json')
    with open(_skip_cfg) as _sf:
        _SPAM_SKIP = set(_json.load(_sf).get('skip_files', []))
except Exception:  # silent-ok: config optional, hardcoded defaults in verifier
    pass
_ANNOTATIONS = ('# silent-ok:', '# FIXME:',
                 '# noqa', '# pylint:', '# pyright:', '# type:',
                 '// silent-ok:', '// FIXME:',
                 '// eslint-', '// noqa')
_CWARN = int(os.environ.get('COMMENT_BLOAT_WARN', '3'))


def _last_user_idx(events):
    for i, ev in reversed(list(enumerate(events))):
        if ev.get("type") == "user":
            msg = ev.get("message")
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                return i
    return -1


def _edited_files(events, start):
    out = []
    for ev in events[start:]:
        if not is_assistant(ev): continue
        for b in event_content(ev):
            if not isinstance(b, dict) or b.get("type") != "tool_use": continue
            if b.get("name") in ("Edit", "Write"):
                fp = (b.get("input") or {}).get("file_path")
                if fp: out.append(fp)
    return out


def _prefix(fp):
    lo = fp.lower()
    if lo.endswith(('.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs')): return '//'
    if lo.endswith(('.py', '.sh', '.bash', '.yaml', '.yml', '.toml')): return '#'
    return None


def _is_annotation(s):
    return any(s.lstrip().startswith(a) for a in _ANNOTATIONS)


def _check_bloat(fp):
    p = _prefix(fp)
    if not p: return None
    try:
        with open(fp, encoding='utf-8') as f: lines = f.readlines()
    except OSError: return None
    run, seen_first, seen_code = 0, False, False
    for raw in lines:
        s = raw.strip()
        if s.startswith(p) and not s.startswith('#!') and not _is_annotation(s):
            run += 1
        else:
            if s and not s.startswith(p): seen_code = True
            if run >= _CWARN:
                if seen_first or seen_code: return True
                seen_first = True
            run = 0
    if run >= _CWARN and (seen_first or seen_code): return True
    return None


def _check_spam(fp, proot):
    rel = os.path.relpath(fp, proot) if fp.startswith(proot) else fp
    if rel in _SPAM_SKIP: return None
    try:
        with open(fp, encoding='utf-8') as f:
            for line in f:
                if SPAM_ALLOW in line: continue
                if SPAM_RE.search(line): return True
    except (UnicodeDecodeError, OSError): pass
    return None


def main():
    if len(sys.argv) < 2:
        print("ok"); return 0
    proot = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
    if not proot:
        print("ok"); return 0
    events = _parse_all(sys.argv[1])
    start = _last_user_idx(events)
    if start < 0:
        print("ok"); return 0
    files = _edited_files(events, start)
    if not files:
        print("ok"); return 0
    sys.path.insert(0, os.path.join(proot, "scripts"))
    import loc_ignore, loc_count
    patterns = loc_ignore.load_patterns()
    for fp in files:
        full = fp if os.path.isabs(fp) else os.path.join(proot, fp)
        if not os.path.isfile(full): continue
        if _check_bloat(full):
            print("comment_bloat"); return 0
        if _check_spam(full, proot):
            print("char_spam"); return 0
        rel = os.path.relpath(full, proot) if full.startswith(proot) else fp
        if not loc_ignore.is_exempt(rel, patterns):
            if loc_count.cloc(full) > LOC_LIMIT:
                print("loc_bloat"); return 0
    print("ok"); return 0


if __name__ == "__main__":
    sys.exit(main())
