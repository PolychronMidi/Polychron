#!/usr/bin/env python3
"""Detect unnamed `except Exception:` handlers that do something non-trivial.

Complements hme-py-no-silent-catchall (which forbids `except Exception: pass`).
This rule catches the form:
    except Exception:
        <some non-pass block>
where the exception is not bound to a name, making it impossible to log the
type/message. Best practice:
    except Exception as _err:
        logger.debug(f"...: {type(_err).__name__}: {_err}")

Bare `except Exception:` with a trivial re-raise or explicit return-without-
logging is also flagged. The goal is: if you catch it, name it and log it.

Exit 0 with empty stdout = clean. Any offense = one line per hit.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

# Matches `except Exception:` (no `as NAME`) followed by `:` end-of-line
UNNAMED = re.compile(r"^(?P<indent>\s*)except\s+Exception:\s*(#.*)?$")
# pass is already handled by the other invariant — ignore here
PASS_ONLY = re.compile(r"^\s*pass\s*(#.*)?$")


def scan(root: pathlib.Path) -> list[str]:
    hits: list[str] = []
    for f in sorted(root.rglob("*.py")):
        try:
            src = f.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for i, line in enumerate(src):
            m = UNNAMED.match(line)
            if not m:
                continue
            # Look ahead to the body — skip if it's just `pass` (handled elsewhere)
            if i + 1 < len(src) and PASS_ONLY.match(src[i + 1]):
                continue
            # Otherwise this is an unnamed non-pass handler — flag it
            hits.append(f"{f}:{i+1}: {line.strip()}")
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default="tools/HME/service/server")
    args = ap.parse_args()
    hits = scan(pathlib.Path(args.root))
    if hits:
        print("\n".join(hits))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
