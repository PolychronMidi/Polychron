#!/usr/bin/env python3
"""Unit test for server.lifecycle_writers.

Without this test, a silent ImportError in the consumer code (every
assert_writer call is wrapped in try/except ImportError: pass) would
disable every invariant without a single log line. That would reproduce
the exact failure mode this module was built to prevent: the system
claims invariants hold, reality doesn't.

Run directly:   python3 scripts/test/test-lifecycle-writers.py
Exit 0 on pass, 1 on any failure.
"""
from __future__ import annotations

import os
import sys
import traceback


def _add_path() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    mcp_root = os.path.abspath(os.path.join(here, "..", "..", "tools", "HME", "mcp"))
    if mcp_root not in sys.path:
        sys.path.insert(0, mcp_root)


def main() -> int:
    _add_path()
    failed: list[str] = []

    # --- Test 1: module imports without side effects ---
    try:
        from server import lifecycle_writers as lw
    except Exception as e:
        print(f"FAIL: import lifecycle_writers raised {type(e).__name__}: {e}")
        traceback.print_exc()
        return 1
    print(f"PASS: imported lifecycle_writers ({lw.__file__})")

    # --- Test 2: registry has non-empty expected domain set ---
    domains = lw.all_domains()
    expected = {
        "llama-server", "embedders", "kb", "hme-todo-store",
        "lifesaver-registry", "onboarding-state",
    }
    missing = expected - domains.keys()
    extras = domains.keys() - expected
    if missing:
        failed.append(f"domain registry missing: {sorted(missing)}")
    if extras:
        print(f"INFO: extra domains registered beyond expected: {sorted(extras)}")
    if not missing:
        print(f"PASS: all {len(expected)} expected domains registered")

    # --- Test 3: correct-caller does NOT raise ---
    correct_pairs = [
        ("llama-server",        "/path/to/tools/HME/mcp/llamacpp_daemon.py"),
        ("embedders",           "/path/to/tools/HME/mcp/rag_engines.py"),
        ("kb",                  "/path/to/server/tools_knowledge.py"),
        ("hme-todo-store",      "/path/to/server/tools_analysis/todo.py"),
        ("lifesaver-registry",  "/path/to/server/failure_genealogy.py"),
        ("onboarding-state",    "/path/to/server/onboarding_chain.py"),
    ]
    for domain, caller in correct_pairs:
        try:
            lw.assert_writer(domain, caller)
        except RuntimeError as e:
            failed.append(f"assert_writer({domain!r}, {caller!r}) raised on legitimate caller: {e}")
        except Exception as e:
            failed.append(f"assert_writer({domain!r}, {caller!r}) raised unexpected {type(e).__name__}: {e}")
    print(f"PASS: {len(correct_pairs)} legitimate (domain, caller) pairs all accepted")

    # --- Test 4: wrong-caller DOES raise with clear message ---
    violations = [
        ("llama-server", "worker.py"),
        ("embedders", "llamacpp_daemon.py"),
        ("kb", "some_random_module.py"),
    ]
    for domain, caller in violations:
        try:
            lw.assert_writer(domain, caller)
        except RuntimeError as e:
            msg = str(e)
            # Message must mention both the domain and the expected owner.
            owner = lw.owner_of(domain)
            if domain in msg and owner and owner in msg:
                continue
            failed.append(
                f"assert_writer({domain!r}, {caller!r}) raised but message "
                f"missing domain or owner: {msg[:120]}"
            )
        except Exception as e:
            failed.append(
                f"assert_writer({domain!r}, {caller!r}) raised wrong type "
                f"{type(e).__name__} (expected RuntimeError): {e}"
            )
        else:
            failed.append(f"assert_writer({domain!r}, {caller!r}) did NOT raise on violator")
    print(f"PASS: {len(violations)} violating (domain, caller) pairs all rejected with clear message")

    # --- Test 5: unknown-domain raises with remediation hint ---
    try:
        lw.assert_writer("not-a-registered-domain", "/any/path.py")
    except RuntimeError as e:
        msg = str(e)
        if "_OWNERS" in msg and "Known domains" in msg:
            print("PASS: unknown domain raises with remediation hint")
        else:
            failed.append(f"unknown domain error message lacks remediation hint: {msg[:120]}")
    except Exception as e:
        failed.append(f"unknown domain raised {type(e).__name__}, expected RuntimeError: {e}")
    else:
        failed.append("unknown domain did NOT raise")

    # --- Test 6: register_owner rejects silent overrides ---
    try:
        lw.register_owner("llama-server", "impostor_module")
    except RuntimeError as e:
        if "already owned by" in str(e):
            print("PASS: register_owner rejects silent override of existing domain")
        else:
            failed.append(f"register_owner error message unexpected: {str(e)[:120]}")
    except Exception as e:
        failed.append(f"register_owner raised {type(e).__name__}, expected RuntimeError: {e}")
    else:
        failed.append("register_owner did NOT raise on conflicting re-register")

    # --- Test 7: idempotent re-register (same owner) is OK ---
    try:
        current = lw.owner_of("llama-server")
        lw.register_owner("llama-server", current)
        print("PASS: register_owner is idempotent for identical owner")
    except Exception as e:
        failed.append(f"idempotent register_owner raised {type(e).__name__}: {e}")

    # --- Summary ---
    if failed:
        print()
        print(f"FAIL: {len(failed)} assertion(s):")
        for f in failed:
            print(f"  - {f}")
        return 1
    print()
    print("=== ALL LIFECYCLE-WRITERS TESTS PASSED ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
