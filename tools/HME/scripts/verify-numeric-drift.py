#!/usr/bin/env python3
"""Numeric-claim drift verifier.

Scans markdown docs for counted architectural claims (e.g. "18 hypermeta
controllers", "12 CIM dials") and validates them against the live codebase
count. Reports every doc whose stated number no longer matches reality.

The claims to check live in CLAIMS below. Each claim supplies:
  - a name (identifier for reporting)
  - a counter() that returns the current ground-truth integer
  - a regex pattern with one capture group yielding the claimed number
    (digits or English number words 1-99)

Keep patterns tight. A loose pattern matches unrelated prose and produces
false positives the agent will have to manually triage.

Exit codes:
    0 - all claims match (or no claims found — trivially clean)
    1 - drift detected (report printed)
    2 - unexpected error

Usage:
    python3 tools/HME/scripts/verify-numeric-drift.py
    python3 tools/HME/scripts/verify-numeric-drift.py --json
"""
import json
import os
import re
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)

# Docs to scan. Walk everything under doc/ plus root-level Markdown;
# skip the auto-generated metrics output tree and any node_modules.
_DOC_ROOTS = [
    os.path.join(_PROJECT, "doc"),
]
_DOC_FILES_EXTRA = [
    os.path.join(_PROJECT, "README.md"),
    os.path.join(_PROJECT, "CLAUDE.md"),
]
_SKIP_DIRS = {"node_modules", ".git", "metrics", "output"}


# ── English number-word map (1-99). Keeps scanning cheap; anything larger
# in the docs is rare enough to write as digits.
_WORD_UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
}
_WORD_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}


def _parse_count(raw: str):
    """Return the integer value of a digit string or English word 1-99,
    or None if the token isn't a recognized count."""
    raw = raw.strip().lower().replace("_", "")
    if raw.isdigit():
        return int(raw)
    if raw in _WORD_UNITS:
        return _WORD_UNITS[raw]
    if raw in _WORD_TENS:
        return _WORD_TENS[raw]
    if "-" in raw:
        a, b = raw.split("-", 1)
        if a in _WORD_TENS and b in _WORD_UNITS and _WORD_UNITS[b] > 0:
            return _WORD_TENS[a] + _WORD_UNITS[b]
    return None


# Alternation fragment matching either a digit string or an English number
# word. Unnamed group; callers read match.group(1). Each pattern below is
# expected to use this exactly once, so the number lives at group 1.
# Longer compound words precede shorter ones so the alternation greedy-matches
# "twenty-eight" rather than just "twenty".
#
# The lookbehind excludes matches immediately preceded by `.`, `-`, or a
# digit — so "weight-5.0 verifier" does not match as "0 verifier" and
# "v3.14 dials" does not match as "14 dials". The leading \b still requires
# a word boundary, but \b alone permits matches after `.` or `-` because
# those are non-word characters.
_NUM = (
    r"(?<![.\-\d])(\d+|"
    r"twenty-one|twenty-two|twenty-three|twenty-four|twenty-five|twenty-six|"
    r"twenty-seven|twenty-eight|twenty-nine|"
    r"thirty-one|thirty-two|thirty-three|thirty-four|thirty-five|thirty-six|"
    r"thirty-seven|thirty-eight|thirty-nine|"
    r"forty-one|forty-two|forty-three|forty-four|forty-five|forty-six|"
    r"forty-seven|forty-eight|forty-nine|"
    r"fifty-six|sixty-four|sixty-five|"
    r"zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|"
    r"twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)"
)


# ── Ground-truth counters. Each returns an int or raises.

def count_hypermeta_controllers():
    path = os.path.join(
        _PROJECT, "src", "conductor", "signal", "meta", "metaControllerRegistry.js"
    )
    with open(path) as f:
        return sum(1 for line in f if re.match(r"\s*id:\s*\d+,", line))


def count_hci_verifiers():
    pkg_dir = os.path.join(
        _PROJECT, "tools", "HME", "scripts", "verify_coherence"
    )
    pat = re.compile(r"^class\s+\w+Verifier\(Verifier\):", re.MULTILINE)
    total = 0
    for root, dirs, files in os.walk(pkg_dir):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for f in files:
            if not f.endswith(".py"):
                continue
            with open(os.path.join(root, f)) as fp:
                total += len(pat.findall(fp.read()))
    return total


def count_cim_dials():
    path = os.path.join(
        _PROJECT, "src", "crossLayer", "coordinationIndependenceManager.js"
    )
    with open(path) as f:
        src = f.read()
    m = re.search(r"const\s+MODULE_PAIRS\s*=\s*\[(.*?)\];", src, re.DOTALL)
    if not m:
        raise RuntimeError("MODULE_PAIRS not found in coordinationIndependenceManager.js")
    return len(re.findall(r"'[^']+-[^']+'", m.group(1)))


def count_feedback_controllers():
    # grep-equivalent: count feedbackRegistry.registerLoop( calls across src/
    src_dir = os.path.join(_PROJECT, "src")
    total = 0
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for f in files:
            if not f.endswith(".js"):
                continue
            with open(os.path.join(root, f)) as fp:
                total += fp.read().count("feedbackRegistry.registerLoop(")
    return total


def count_crosslayer_js_files():
    cl_dir = os.path.join(_PROJECT, "src", "crossLayer")
    total = 0
    for root, dirs, files in os.walk(cl_dir):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        total += sum(1 for f in files if f.endswith(".js"))
    return total


def count_eslint_rules():
    d = os.path.join(_PROJECT, "scripts", "eslint-rules")
    return sum(
        1 for f in os.listdir(d)
        if f.endswith(".js") and f != "index.js"
    )


# ── Claims manifest. Each entry:
#   name     — identifier for reports.
#   counter  — callable returning the current integer value.
#   patterns — list of compiled regexes. Each must contain _NUM exactly once
#              so match.group(1) yields the stated number.
#   context  — human-readable description of what the regexes match.

CLAIMS = [
    {
        "name": "hypermeta-controllers",
        "counter": count_hypermeta_controllers,
        "patterns": [re.compile(
            rf"\b{_NUM}\s+hypermeta(?:\s+self-calibrating)?\s+controllers?\b",
            re.IGNORECASE,
        )],
        "context": "N hypermeta controllers",
    },
    {
        "name": "hci-verifiers",
        "counter": count_hci_verifiers,
        "patterns": [re.compile(
            rf"\b{_NUM}\s+(?:weighted\s+)?verifiers?\b",
            re.IGNORECASE,
        )],
        "context": "N verifiers / N weighted verifiers",
    },
    {
        "name": "cim-dials",
        "counter": count_cim_dials,
        "patterns": [re.compile(
            rf"\b{_NUM}\s+(?:CIM\s+)?(?:module-pair\s+|coordination\s+)?dials?\b",
            re.IGNORECASE,
        )],
        "context": "N CIM dials / module-pair dials",
    },
    {
        "name": "feedback-controllers",
        "counter": count_feedback_controllers,
        "patterns": [re.compile(
            rf"\b{_NUM}\s+(?:registered\s+)?(?:closed-loop\s+)?feedback\s+(?:controllers?|loops?)\b",
            re.IGNORECASE,
        )],
        "context": "N feedback controllers / feedback loops",
    },
    {
        "name": "eslint-rules",
        "counter": count_eslint_rules,
        "patterns": [
            re.compile(rf"\bESLint\s+rules?\s*\({_NUM}\)", re.IGNORECASE),
            re.compile(rf"\b{_NUM}\s+ESLint\s+rules?\b", re.IGNORECASE),
        ],
        "context": "N ESLint rules / ESLint rules (N)",
    },
]


def _iter_docs():
    for root in _DOC_ROOTS:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
            for f in files:
                if f.endswith(".md"):
                    yield os.path.join(dirpath, f)
    for path in _DOC_FILES_EXTRA:
        if os.path.isfile(path):
            yield path


def _rel(path):
    return os.path.relpath(path, _PROJECT)


def _plausible_drift(stated, actual):
    """Return True if `stated` is close enough to `actual` to plausibly be a
    stale claim about the same thing. Skip small-actual cases entirely (any
    drift is plausible when the true count is tiny) and flag only same-
    order-of-magnitude disagreements otherwise.

    The motivation is to filter prose uses like "one verifier added" or
    "two dials turned" where the number word is a cardinal modifying the
    noun but is not a claim about the registry total. Real drift sits
    within one order of magnitude of the actual count; implausibly far
    numbers are noise."""
    if actual < 5:
        return True
    return actual * 0.3 <= stated <= actual * 3


def scan():
    """Return (drifts, scanned_count, truth). `drifts` is a list of dicts
    with keys: claim, file, line, stated, actual, quote. `filtered` is a
    parallel list of implausible matches rejected by _plausible_drift."""
    drifts = []
    filtered = []
    truth = {}
    for claim in CLAIMS:
        try:
            truth[claim["name"]] = claim["counter"]()
        except Exception as e:
            raise RuntimeError(f"counter for {claim['name']!r} failed: {e}") from e

    scanned = 0
    for path in _iter_docs():
        scanned += 1
        with open(path) as f:
            text = f.read()
        for line_no, line in enumerate(text.splitlines(), start=1):
            # Line-level exemption. An author can mark a specific line as
            # deliberately-imprecise by appending the HTML-comment marker
            # `<!-- drift-exempt -->`. The whole line is then skipped.
            # Useful in literary essays where a specific count is the
            # current-snapshot anchor of an argument and the author
            # accepts that it will drift. The marker is visible in the
            # rendered output only to HTML readers; markdown renderers
            # typically hide it.
            if "<!-- drift-exempt -->" in line:
                continue
            for claim in CLAIMS:
                for pattern in claim["patterns"]:
                    for m in pattern.finditer(line):
                        raw = m.group(1)
                        stated = _parse_count(raw)
                        if stated is None:
                            continue
                        actual = truth[claim["name"]]
                        if stated == actual:
                            continue
                        entry = {
                            "claim": claim["name"],
                            "file": _rel(path),
                            "line": line_no,
                            "stated": stated,
                            "actual": actual,
                            "quote": line.strip(),
                        }
                        if _plausible_drift(stated, actual):
                            drifts.append(entry)
                        else:
                            filtered.append(entry)
    return drifts, filtered, scanned, truth


def _print_report(drifts, filtered, scanned, truth, show_filtered):
    print(f"Scanned {scanned} markdown file(s).")
    print("Ground-truth counts:")
    for name, n in truth.items():
        print(f"  {name:26s} {n}")
    print()
    if not drifts:
        print("PASS: no numeric drift detected.")
    else:
        by_claim = {}
        for d in drifts:
            by_claim.setdefault(d["claim"], []).append(d)
        print(f"FAIL: {len(drifts)} numeric drift(s) across {len(by_claim)} claim(s).")
        for claim, items in by_claim.items():
            actual = items[0]["actual"]
            stated_vals = sorted({d["stated"] for d in items})
            print(f"\n  {claim}: code has {actual}; docs claim {stated_vals}")
            for d in items:
                print(f"    {d['file']}:{d['line']}  stated={d['stated']}")
                print(f"      > {d['quote'][:140]}")
    if show_filtered and filtered:
        print(f"\n{len(filtered)} implausible match(es) filtered (--noisy to inspect):")
        if show_filtered == "verbose":
            for d in filtered:
                print(f"  {d['file']}:{d['line']}  claim={d['claim']}  "
                      f"stated={d['stated']} actual={d['actual']}")


def main():
    args = sys.argv[1:]
    try:
        drifts, filtered, scanned, truth = scan()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    if "--json" in args:
        payload = {
            "drift_count": len(drifts),
            "filtered_count": len(filtered),
            "scanned": scanned,
            "truth": truth,
            "drifts": drifts,
            "filtered": filtered,
        }
        print(json.dumps(payload, indent=2))
    else:
        show = "verbose" if "--noisy" in args else "summary"
        _print_report(drifts, filtered, scanned, truth, show)
    return 0 if not drifts else 1


if __name__ == "__main__":
    sys.exit(main())
