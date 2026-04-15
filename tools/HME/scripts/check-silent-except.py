#!/usr/bin/env python3
"""Silent-except detector used by the hme-py-no-silent-catchall invariant.

Matches both forms:
    except Exception: pass           (same-line)
    except Exception:
        pass                         (next-line)

Prints one offense per line in `path:line: context` format; empty output means
no offenses. Accepts optional path arguments; defaults to tools/HME/mcp.
"""
import pathlib
import re
import sys

SAME_LINE = re.compile(r"^\s*except\s+Exception:\s*pass\s*(#.*)?$")
BARE_LINE = re.compile(r"^\s*except\s+Exception:\s*(#.*)?$")
PASS_LINE = re.compile(r"^\s*pass\s*(#.*)?$")


def scan(root: pathlib.Path) -> list[str]:
    hits: list[str] = []
    for f in root.rglob("*.py"):
        try:
            src = f.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for i, line in enumerate(src):
            if SAME_LINE.match(line):
                hits.append(f"{f}:{i+1}: {line.strip()}")
            elif BARE_LINE.match(line) and i + 1 < len(src) and PASS_LINE.match(src[i + 1]):
                hits.append(f"{f}:{i+1}-{i+2}: except Exception: / pass")
    return hits


def main() -> int:
    paths = sys.argv[1:] or ["tools/HME/mcp"]
    all_hits: list[str] = []
    for p in paths:
        all_hits.extend(scan(pathlib.Path(p)))
    if all_hits:
        print("\n".join(all_hits))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
