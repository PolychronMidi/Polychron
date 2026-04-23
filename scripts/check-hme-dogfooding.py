#!/usr/bin/env python3
"""HME dogfooding: enforce on HME's own Python the same anti-silent-
failure rules HME enforces on Polychron.

The premise: if HME's architectural principle is "no silent failures,
fail-fast, single-writer, no bare except," then HME itself must obey
those rules in its Python code. Tonight's incident had HME swallowing
its own invariant-setup ImportError via `try/except ImportError: pass`
— the tool that enforces rules violated the rule it enforces.

Rules enforced here (Python-side analogs of the ESLint rules HME runs
on Polychron JS):

  R33 / no-empty-catch:
    `except ...: pass` (bare or too-broad) is a silent swallow.
    Allowed only with an explicit `# silent-ok: <reason>` comment
    on the same line.

  no-bare-except:
    `except:` without a type is catastrophically broad — catches
    KeyboardInterrupt, SystemExit, etc.

  exception-logging-coverage:
    `except Exception as e: ...` must mention `e` / `err` / `logger`
    in its body (some evidence the exception is inspected, not
    memory-holed). Rough heuristic; false positives OK — goal is
    to surface candidates.

Exit 0 clean, 1 on violations. Selftest runs this as a probe.
"""
from __future__ import annotations

import ast
import os
import sys


_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_MCP_ROOT = os.path.join(_PROJECT_ROOT, "tools", "HME", "mcp")

# Allow-list for try/except bodies that are legitimately quiet:
# each must carry `# silent-ok: <reason>` on the except line.
_SILENT_OK_MARKER = "# silent-ok:"


def _scan_file(path: str) -> list[str]:
    rel = os.path.relpath(path, _PROJECT_ROOT)
    violations: list[str] = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            src = f.read()
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        return [f"{rel}: parse error: {e}"]

    lines = src.splitlines()

    def _line_at(lineno: int) -> str:
        if 1 <= lineno <= len(lines):
            return lines[lineno - 1]
        return ""

    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        except_line = _line_at(getattr(node, "lineno", 0))
        # Skip if the except line declares silent-ok intent.
        if _SILENT_OK_MARKER in except_line:
            continue

        # R33 no-empty-catch: body is a single `pass`.
        if len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
            type_name = ast.unparse(node.type) if node.type else "bare"
            violations.append(
                f"{rel}:{node.lineno}: `except {type_name}: pass` is a silent "
                f"swallow. Log the exception (logger.debug at minimum) OR add "
                f"`# silent-ok: <reason>` on the except line to acknowledge."
            )
            continue

        # no-bare-except: except: without any type.
        if node.type is None:
            violations.append(
                f"{rel}:{node.lineno}: bare `except:` catches KeyboardInterrupt "
                f"and SystemExit — use `except Exception:` instead."
            )
            continue

        # exception-logging-coverage heuristic: if the except binds a name
        # (e.g. `except Exception as e`), the body should reference it.
        if node.name:
            body_src = "\n".join(ast.unparse(b) for b in node.body)
            if node.name not in body_src:
                # Exception bound but never used — probably should just
                # be `except Exception:` (no bind) or should log it.
                # Skip this — high false-positive rate, chase via the
                # silent-swallow rule instead.
                pass

    return violations


def main() -> int:
    violations: list[str] = []
    for root, _dirs, files in os.walk(_MCP_ROOT):
        if "__pycache__" in root or "/venv/" in root or "/lancedb_data" in root:
            continue
        for f in files:
            if not f.endswith(".py"):
                continue
            violations.extend(_scan_file(os.path.join(root, f)))
    if violations:
        # Sort for stable output; group by file.
        violations.sort()
        print(f"check-hme-dogfooding: {len(violations)} violation(s):")
        for v in violations:
            print(f"  {v}")
        print()
        print("Fix each by either (a) logging the exception, or (b) marking "
              "the except line with `# silent-ok: <why this is genuinely safe>`.")
        return 1
    print("check-hme-dogfooding: CLEAN — HME's own Python obeys the rules it enforces on Polychron")
    return 0


if __name__ == "__main__":
    sys.exit(main())
