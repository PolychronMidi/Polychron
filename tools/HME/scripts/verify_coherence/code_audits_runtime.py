"""Code-audit verifiers — extracted cluster. Imports re-export back to
the parent code_audits.py for stable __init__.py imports."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


# Runtime + test + syntax verifiers.

class SilentFailureClassVerifier(Verifier):
    """Delegates to scripts/audit-silent-failure-class.py, which surfaces
    broad-except / catch-and-swallow sites that lack a `silent-ok:`
    annotation. Pattern B from the architectural review: telemetry-class
    catches are correct but safety-belt catches must surface. The audit
    can't tell which is which automatically — it asks for a written
    justification (silent-ok: <reason>) on each intentional silence.

    Weight is ADVISORY (0.5) not gating: the codebase has many unannotated
    sites today; a PASS here is aspirational. The purpose is keeping
    the count visible over time so NEW silent-catches land annotated.
    """
    name = "silent-failure-class"
    category = "code"
    subtag = "regression-prevention"
    weight = 0.5  # advisory — annotate over time, don't block merges yet

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-silent-failure-class.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script])
        # Parse the "N unmarked silent-catch sites across K files" header
        import re as _re_sf
        m = _re_sf.search(r"(\d+) unmarked silent-catch sites across (\d+) files", out)
        if m:
            count = int(m.group(1))
            files = int(m.group(2))
            # Logarithmic scaling — expected count is in the hundreds today;
            # goal is monotonic improvement, not zero. A 10% reduction = +1
            # to the score. Below 50 sites = fully passing.
            if count <= 50:
                return _result(PASS, 1.0,
                               f"only {count} unmarked silent-catch sites (≤50 threshold)")
            score = max(0.0, 1.0 - (count - 50) / 1000.0)
            detail_lines = [l for l in out.splitlines() if ":" in l and "audit-silent-failure-class" not in l][:15]
            return _result(WARN, score,
                           f"{count} unmarked silent-catch sites across {files} files — annotate with `silent-ok:` over time",
                           detail_lines)
        return _result(SKIP, 1.0, "could not parse audit output", [out[:200], err[:200]])




class TestIsolationVerifier(Verifier):
    """Tests that exercise `runStopChain`, `dispatchEvent`, or `shellPolicy`
    spawn bash hooks that write to log/hme-errors.log via fail-loud
    helpers. Without sandboxing PROJECT_ROOT to a tmp dir AND busting
    require.cache for proxy/+policies/, those writes pollute the real log
    and trip the next Stop hook's LIFESAVER as 'UNADDRESSED ERRORS FROM
    PREVIOUS TURN'.

    Detects: any test file under tools/HME/tests/ that imports/calls one
    of those three symbols MUST also reference a sandbox helper or
    pattern that overrides PROJECT_ROOT to a tmp path."""
    name = "test-isolation-stop-chain"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    _RISKY_RE = re.compile(r"\b(runStopChain|dispatchEvent|shellPolicy)\b")
    _SANDBOX_RE = re.compile(
        r"_withChainSandbox|_withSandbox|"
        r"PROJECT_ROOT\s*=\s*(?:os\.path\.join\([^)]*tmp|fs\.mkdtempSync|tmp_)"
    )

    def run(self) -> VerdictResult:
        tests_dir = os.path.join(_PROJECT, "tools", "HME", "tests")
        if not os.path.isdir(tests_dir):
            return _result(SKIP, 1.0, "tests dir not present")
        violations = []
        scanned = 0
        for r, _d, files in os.walk(tests_dir):
            for f in files:
                if not f.endswith((".js", ".mjs", ".cjs", ".ts")):
                    continue
                scanned += 1
                p = os.path.join(r, f)
                try:
                    with open(p, encoding="utf-8") as fp:
                        src = fp.read()
                except OSError:
                    continue
                if not self._RISKY_RE.search(src):
                    continue
                if self._SANDBOX_RE.search(src):
                    continue
                # Find first risky line for the report
                line_no = "?"
                for i, line in enumerate(src.splitlines(), start=1):
                    if self._RISKY_RE.search(line):
                        line_no = str(i)
                        break
                violations.append(
                    f"{os.path.relpath(p, _PROJECT)}:{line_no}: "
                    f"references runStopChain/dispatchEvent/shellPolicy without "
                    f"_withChainSandbox / _withSandbox / tmp PROJECT_ROOT"
                )
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} test file(s) scanned; all stop-chain tests sandbox PROJECT_ROOT")
        score = max(0.0, 1.0 - len(violations) * 0.25)
        return _result(FAIL, score,
                       f"{len(violations)} unsandboxed stop-chain test(s)",
                       violations[:10])




class TestEnvUndefinedVerifier(Verifier):
    """In Node test files, `process.env.X = undefined` does NOT delete the
    var — it sets the literal string 'undefined' (truthy). Later tests
    inherit it and break || fallback patterns. The correct pattern when
    restoring an originally-unset env var is `delete process.env.X`.

    This verifier scans tools/HME/tests/ for the antipattern."""
    name = "test-env-undefined-antipattern"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    _RE = re.compile(r"process\.env\.[A-Z][A-Z0-9_]*\s*=\s*undefined\b")

    def run(self) -> VerdictResult:
        tests_dir = os.path.join(_PROJECT, "tools", "HME", "tests")
        if not os.path.isdir(tests_dir):
            return _result(SKIP, 1.0, "tests dir not present")
        violations = []
        scanned = 0
        for r, _d, files in os.walk(tests_dir):
            for f in files:
                if not f.endswith((".js", ".mjs", ".cjs", ".ts")):
                    continue
                scanned += 1
                p = os.path.join(r, f)
                try:
                    with open(p, encoding="utf-8") as fp:
                        for i, line in enumerate(fp, start=1):
                            stripped = line.lstrip()
                            # Skip JS line comments and block-comment continuations
                            if stripped.startswith("//") or stripped.startswith("*"):
                                continue
                            if self._RE.search(line):
                                violations.append(
                                    f"{os.path.relpath(p, _PROJECT)}:{i}: "
                                    f"process.env.X = undefined (use `delete process.env.X`)"
                                )
                except OSError:
                    continue
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} test file(s) scanned; no env-undefined antipattern")
        score = max(0.0, 1.0 - len(violations) * 0.1)
        return _result(FAIL, score,
                       f"{len(violations)} env-undefined antipattern(s)",
                       violations[:10])




def _count_legendary_streak(project_root: str) -> int:
    """Count consecutive 'legendary' ground-truth verdicts ending at the
    most recent verdict. Used by ConjugateChannelVerifier's license-to-
    explore branch to scale band-widening proportionally to recent
    productive-territory evidence (V × VIII × IX compounding)."""
    gt_path = os.path.join(project_root, "output", "metrics",
                           "hme-ground-truth.jsonl")
    if not os.path.isfile(gt_path):
        return 0
    try:
        with open(gt_path) as f:
            rows = [json.loads(ln) for ln in f if ln.strip()]
    except (OSError, ValueError):
        return 0
    streak = 0
    for r in reversed(rows):
        if r.get("sentiment") == "legendary":
            streak += 1
        else:
            break
    return streak


class ConjugateChannelVerifier(Verifier):
    """Horizon V expansion — composition⇔HME conjugate-channel feedback.

    Couples HCI to perceptual coherence by reading the latest
    musical-correlation row and FAILing when the system is in the
    'lost' quadrant (low HCI AND low perceptual). PASS when in any
    other quadrant. The `perceptual_complexity_avg` and `hme_coherence`
    fields exist in `output/metrics/hme-musical-correlation.json`.

    This is the FIRST verifier whose status depends on the composition
    signal — the conjugate channel previously was a passive view
    (`i/status mode=conjugate`) but didn't feed back into HCI. With
    this verifier the two coherences become a coupled system: a
    sustained 'lost' state degrades HCI, which signals the agent to
    investigate.

    Threshold: 'lost' = HCI < median AND perceptual < median (data-driven)."""
    name = "conjugate-channel"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.5

    def run(self) -> VerdictResult:
        path = os.path.join(_PROJECT, "output", "metrics",
                            "hme-musical-correlation.json")
        if not os.path.isfile(path):
            return _result(SKIP, 1.0,
                           "no musical-correlation file yet; pipeline hasn't produced one")
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError) as e:
            return _result(ERROR, 0.0, f"could not read: {e}")
        latest = d.get("latest") or {}
        history = d.get("history") or []
        all_rounds = [r for r in (history + [latest])
                      if isinstance(r.get("hme_coherence"), (int, float))
                      and isinstance(r.get("perceptual_complexity_avg"), (int, float))]
        if not all_rounds:
            return _result(SKIP, 1.0, "no rounds carry both signals")
        if not isinstance(latest.get("hme_coherence"), (int, float)) or \
           not isinstance(latest.get("perceptual_complexity_avg"), (int, float)):
            # SKIP path — but DON'T let the streak-aware license signal go
            # stale just because the quantitative signals are pending.
            # If a ground-truth legendary streak exists, keep the band-
            # widening proposal fresh based on streak alone (composition-
            # aware fast feedback: listener verdicts update the license
            # immediately, not waiting for the next pipeline correlation).
            try:
                _streak = _count_legendary_streak(_PROJECT)
                if _streak >= 2:
                    _delta = min(0.10, 0.05 + max(0, _streak - 1) * 0.025)
                    _expiry = min(4, 1 + max(0, _streak - 1))
                    _refresh_path = os.path.join(_PROJECT, "tmp", "hme-band-tightening.json")
                    _refresh = {
                        "ts": time.time(),
                        "trigger": "streak-aware-skip-refresh",
                        "reason": (f"latest round missing quantitative signals "
                                   f"but {_streak}-round legendary streak active"),
                        "recommended_action": "widen_band",
                        "band_delta": _delta,
                        "expires_after_rounds": _expiry,
                        "streak": {
                            "legendary_consecutive": _streak,
                            "policy": "magnitude +0.025/streak (cap +0.10) · duration +1/streak (cap 4)",
                        },
                    }
                    _refresh_tmp = _refresh_path + ".tmp"
                    with open(_refresh_tmp, "w") as _rf:
                        json.dump(_refresh, _rf, indent=2)
                    os.replace(_refresh_tmp, _refresh_path)
            except OSError:
                # Marker write is advisory; SKIP returns successfully
                # regardless.
                pass
            return _result(SKIP, 1.0, "latest round missing one of the two signals")
        # Data-driven thresholds — medians across history
        sorted_h = sorted(r["hme_coherence"] for r in all_rounds)
        sorted_p = sorted(r["perceptual_complexity_avg"] for r in all_rounds)
        h_thr = sorted_h[len(sorted_h) // 2]
        p_thr = sorted_p[len(sorted_p) // 2]
        cur_h = float(latest["hme_coherence"])
        cur_p = float(latest["perceptual_complexity_avg"])
        if cur_h < h_thr and cur_p < p_thr:
            # Bidirectional V-coupling (Horizon V asymptote): on lost-
            # quadrant FAIL, write a band-tightening proposal so the
            # NEXT round's coherence-budget consumer can opt to narrow
            # the chaordic edge. Composition→HCI was the seed; this
            # closes the HCI→composition direction. The marker file is
            # advisory — composition behavior remains driven by the
            # configured band until a consumer explicitly reads this.
            try:
                tightening = {
                    "ts": time.time(),
                    "trigger": "conjugate-channel-lost-quadrant",
                    "reason": (f"HCI={cur_h:.2f} < {h_thr:.2f} AND "
                               f"perc={cur_p:.2f} < {p_thr:.2f}"),
                    "recommended_action": "narrow_band",
                    "band_delta": -0.05,  # advisory: contract by 5pp
                    "expires_after_rounds": 1,
                }
                tightening_path = os.path.join(
                    _PROJECT, "tmp", "hme-band-tightening.json")
                tightening_tmp = tightening_path + ".tmp"
                with open(tightening_tmp, "w") as _tf:
                    json.dump(tightening, _tf, indent=2)
                os.replace(tightening_tmp, tightening_path)
            except OSError:
                pass
            return _result(FAIL, 0.0,
                           f"latest round in 'lost' quadrant "
                           f"(HCI={cur_h:.2f} < {h_thr:.2f} AND "
                           f"perc={cur_p:.2f} < {p_thr:.2f})",
                           ["wrote tmp/hme-band-tightening.json (V→IX bidirectional coupling)",
                            "consider: i/status mode=conjugate for full quadrant view",
                            "consider: i/why mode=hci-drop to identify regressed axes",
                            "consider: i/why mode=conscience for ground-truth context"])
        # Bidirectional cleanup: if we're NOT in lost quadrant, clear any
        # stale tightening proposal so it doesn't persist past its trigger.
        try:
            tightening_path = os.path.join(_PROJECT, "tmp", "hme-band-tightening.json")
            if os.path.isfile(tightening_path):
                os.remove(tightening_path)
        except OSError:
            pass
        # Otherwise: PASS, with quadrant label in summary.
        # Plus check for the symmetric "license to explore" condition:
        # when most subtags are ABOVE band (system over-coherent), write
        # a band-LOOSENING marker so the next pipeline run gets a wider
        # chaordic edge. Mirrors the tightening branch above. The
        # composition consumer (compute-coherence-budget.js) reads the
        # same file via tmp/hme-band-tightening.json convention and
        # applies the delta. Pure logic enhancement, no constant tuning.
        try:
            snap_path = os.path.join(_PROJECT, "output", "metrics",
                                     "hci-verifier-snapshot.json")
            if os.path.isfile(snap_path):
                with open(snap_path) as _sf:
                    _snap = json.load(_sf)
                # Compute per-subtag mean score; count ABOVE band
                from collections import defaultdict
                _by_subtag: dict = defaultdict(list)
                _scripts2 = os.path.join(_PROJECT, "tools", "HME", "scripts")
                if _scripts2 not in sys.path:
                    sys.path.insert(0, _scripts2)
                from verify_coherence import REGISTRY as _REG
                _name_to_subtag = {v.name: getattr(v, "subtag", "(none)") for v in _REG}
                for name, info in (_snap.get("verifiers") or {}).items():
                    subtag = _name_to_subtag.get(name, "(none)")
                    _by_subtag[subtag].append(float(info.get("score", 0.0)))
                _LO, _HI = 0.55, 0.85
                _above = sum(1 for vals in _by_subtag.values()
                             if vals and (sum(vals) / len(vals)) > _HI)
                _total = sum(1 for vals in _by_subtag.values() if vals)
                # ≥ 5 of 7 axes saturated → license-to-explore signal.
                # Persist a loosening proposal mirroring the tightening
                # one. Composition consumer applies opposite-sign delta.
                # Streak-aware sizing (V × VIII × IX compounding): consecutive
                # legendary ground-truth verdicts indicate the wider band
                # is producing real composition wins, so the license should
                # extend in both magnitude and duration. Without this, every
                # legendary round would re-derive a 1-round license that
                # expires before the next pipeline run inherits it.
                if _total >= 6 and _above >= 5:
                    legendary_streak = _count_legendary_streak(_PROJECT)
                    # Magnitude: +0.05 base, +0.025 per additional streak round, capped at +0.10
                    streak_delta = min(0.10, 0.05 + max(0, legendary_streak - 1) * 0.025)
                    # Duration: 1 round base, +1 per additional streak round, capped at 4
                    streak_expiry = min(4, 1 + max(0, legendary_streak - 1))
                    loosen_path = os.path.join(_PROJECT, "tmp", "hme-band-tightening.json")
                    loosen_proposal = {
                        "ts": time.time(),
                        "trigger": "conjugate-channel-license-to-explore",
                        "reason": (f"{_above} of {_total} subtags ABOVE band "
                                   f"(saturated → license to explore)"),
                        "recommended_action": "widen_band",
                        "band_delta": streak_delta,
                        "expires_after_rounds": streak_expiry,
                        "streak": {
                            "legendary_consecutive": legendary_streak,
                            "policy": "magnitude +0.025/streak (cap +0.10) · duration +1/streak (cap 4)",
                        },
                    }
                    loosen_tmp = loosen_path + ".tmp"
                    with open(loosen_tmp, "w") as _lf:
                        json.dump(loosen_proposal, _lf, indent=2)
                    os.replace(loosen_tmp, loosen_path)
        except (OSError, ImportError, ValueError):
            # Loosening signal is advisory; absence of the marker is
            # equivalent to "no exploration license." Don't fail the
            # verifier on bookkeeping issues.
            pass
        if cur_h >= h_thr and cur_p >= p_thr:
            quad = "mature stability"
        elif cur_h >= h_thr:
            quad = "sterile rigor"
        else:
            quad = "lucky chaos"
        return _result(PASS, 1.0,
                       f"latest round: '{quad}' "
                       f"(HCI={cur_h:.2f}, perc={cur_p:.2f}; medians {h_thr:.2f}/{p_thr:.2f})")




class ShellUndefinedVarsVerifier(Verifier):
    """Delegates to scripts/audit-shell-undefined-vars.py, which statically
    scans tools/HME/hooks/**/*.sh for `$VAR` references that have no
    matching definition anywhere in scope (the file, any file it sources,
    or the dispatcher chain that sources it). Catches the exact bug class
    that silenced auto-completeness-inject for months: `$_AC_PROJECT`
    referenced in holograph.sh had never been defined anywhere, and under
    `set -u` in _safety.sh, stop.sh crashed before the completeness gate
    ever ran. ShellSyntaxVerifier only checks grammar; this verifier
    catches grammar-valid code that explodes at runtime."""
    name = "shell-undefined-vars"
    category = "code"
    subtag = "structural-integrity"
    weight = 2.0  # any violation is silent-disable class, rank high

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-shell-undefined-vars.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        count = payload.get("violation_count", 0)
        files_scanned = payload.get("files_scanned", 0)
        detail = []
        for fileinfo in payload.get("files", []):
            for finding in fileinfo.get("findings", []):
                detail.append(
                    f"{fileinfo['file']}:{finding['line']} ${finding['var']} — {finding['snippet'][:100]}"
                )
        if count == 0:
            return _result(PASS, 1.0, f"no undefined-variable references across {files_scanned} hook(s)")
        # Each undefined ref drops score by 0.25; floor at 0. Any violation
        # is FAIL — even a single one can silently kill an entire hook chain.
        score = max(0.0, 1.0 - 0.25 * count)
        return _result(FAIL, score,
                       f"{count} undefined-variable reference(s) — silent set-u crash risk",
                       detail[:20])




class PythonSyntaxVerifier(Verifier):
    name = "python-syntax"
    category = "code"
    subtag = "structural-integrity"
    weight = 3.0  # critical: broken Python = broken HME server

    def run(self) -> VerdictResult:
        import ast
        broken = []
        total = 0
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                total += 1
                path = os.path.join(root, f)
                try:
                    with open(path, encoding="utf-8") as fp:
                        ast.parse(fp.read())
                except SyntaxError as e:
                    broken.append(f"{os.path.relpath(path, _PROJECT)}:{e.lineno}: {e.msg}")
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} Python files parse")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} Python files broken", broken)




class ShellSyntaxVerifier(Verifier):
    name = "shell-syntax"
    category = "code"
    subtag = "structural-integrity"
    weight = 2.0

    def run(self) -> VerdictResult:
        broken = []
        total = 0
        for f in os.listdir(_HOOKS_DIR):
            if not f.endswith(".sh"):
                continue
            total += 1
            path = os.path.join(_HOOKS_DIR, f)
            rc = subprocess.run(["bash", "-n", path], capture_output=True, text=True)
            if rc.returncode != 0:
                broken.append(f"{f}: {rc.stderr.strip()[:100]}")
        if not broken:
            return _result(PASS, 1.0, f"{total}/{total} shell hooks parse")
        score = 1.0 - len(broken) / total
        return _result(FAIL, score, f"{len(broken)}/{total} shell hooks broken", broken)


# Banned: 4+ identical non-word, non-whitespace, non-paren/bracket characters
# in a row. Targets visual-decoration spam — runs of equals, dashes, hashes,
# pipes, tildes, slashes, or unicode box-drawing — without false-positiving
# on legitimate code structure (stacked closing parens, identifiers with
# repeated underscores, hex constants like 0xFFFFFFFF).
_SPAM_RE = re.compile(r"([^\w\s()\[\]{}])\1{3,}")
# Per-line opt-out: line containing this token is exempt. Keep narrow so
# allowlisting requires conscious intent.
_SPAM_ALLOW = "spam-ok"
# Files/dirs exempt entirely (vendored libs, fixtures that DEFINE the
# patterns the sanitizer detects, model assets).
_SPAM_SKIP_DIRS = {
    ".git", "node_modules", "output", "tmp", "log", "dist", "build",
    "__pycache__", ".venv", "venv", "lab", "plugin-cache", "models",
}
_SPAM_SKIP_FILES = {
    # Test fixtures whose purpose is to exercise sanitizer regex catalogs.
    "tools/HME/proxy/middleware/secret_sanitizer.js",
    "tools/HME/tests/specs/secret_sanitizer.test.js",
    "tools/HME/tests/specs/migrated_policies.test.js",
    "tools/HME/tests/specs/migrated_policies_round2.test.js",
    "tools/HME/tests/specs/metaprofile_next_level.test.js",
    # Vendored: external library, not under our editorial control.
    "tools/csv_maestro/py_midicsv/midi_converters.py",
}
_SPAM_EXTS = (
    ".md", ".py", ".js", ".mjs", ".cjs", ".sh", ".bash", ".json",
    ".yaml", ".yml", ".ts", ".tsx", ".css", ".html", ".txt",
)




class StalePathRenameVerifier(Verifier):
    """Catches stale references to renamed-but-still-cited paths across
    the entire repo. Surfaced after a `mcp/server → service/server`
    rename left 3 sites broken in scripts/ and hooks/ that no other
    verifier caught (silent ImportError → battery skipped → invariant
    history stale → only surfaced 5 days later via downstream FAIL).

    Path patterns that have been renamed live in
    project-rules.json under `stale_path_patterns`: each entry maps
    a pattern (regex) → reason. The verifier greps the whole repo
    for the pattern; any match in a non-comment, non-keyword-list
    context is a violation.

    Per-line opt-out: `# stale-path-ok: <reason>` on the line.
    Use only for keyword lists or historical refs."""
    name = "stale-path-rename"
    category = "code"
    subtag = "drift-detection"
    weight = 1.5

    def run(self) -> VerdictResult:
        rules_path = os.path.join(_PROJECT, "tools", "HME", "config",
                                  "project-rules.json")
        try:
            with open(rules_path) as f:
                patterns = json.load(f).get("stale_path_patterns", [])
        except Exception:
            patterns = []
        if not patterns:
            return _result(SKIP, 1.0, "no stale_path_patterns configured")

        compiled = []
        for entry in patterns:
            try:
                compiled.append((re.compile(entry["pattern"]), entry.get("reason", "")))
            except (re.error, KeyError):
                continue

        roots = [
            os.path.join(_PROJECT, "scripts"),
            os.path.join(_PROJECT, "tools", "HME"),
        ]
        skip_dirs = {"node_modules", "__pycache__", ".git", "output", "tmp", "log"}
        exts = (".py", ".js", ".mjs", ".cjs", ".sh", ".bash", ".ts")
        violations = []
        scanned = 0
        for root in roots:
            if not os.path.isdir(root):
                continue
            for r, dirs, files in os.walk(root):
                dirs[:] = [d for d in dirs if d not in skip_dirs
                           and d not in ("tests", "test", "specs")]
                for f in files:
                    if not f.endswith(exts):
                        continue
                    scanned += 1
                    p = os.path.join(r, f)
                    try:
                        with open(p, encoding="utf-8", errors="ignore") as fp:
                            for i, line in enumerate(fp, start=1):
                                if "stale-path-ok" in line:
                                    continue
                                stripped = line.lstrip()
                                if stripped.startswith(("#", "//", "*")):
                                    continue
                                for pat, reason in compiled:
                                    if pat.search(line):
                                        violations.append(
                                            f"{os.path.relpath(p, _PROJECT)}:{i}: "
                                            f"{reason or 'stale path'}"
                                        )
                                        break
                    except OSError:
                        continue
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} file(s) scanned; no stale path references")
        score = max(0.0, 1.0 - len(violations) * 0.1)
        return _result(FAIL, score,
                       f"{len(violations)} stale path reference(s)",
                       violations[:10])


