"""Code-audit verifiers -- extracted cluster. Imports re-export back to
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
    telemetry_event_names,
)
from .code_audits_syntax import (  # noqa: F401
    _SPAM_RE, _SPAM_ALLOW, _SPAM_EXTS, _SPAM_SKIP_DIRS, _SPAM_SKIP_FILES,
)


# Verifier classes (extracted from code_audits.py).


def _activity_ts_seconds(value) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            pass
        try:
            return datetime.datetime.fromisoformat(
                text.replace("Z", "+00:00")
            ).timestamp()
        except ValueError:
            return None
    return None


class CorePrinciplesAuditVerifier(Verifier):
    """Delegates to tools/HME/scripts/audit-core-principles.py, which surveys src/
    against the five core principles declared in doc/templates/AGENTS.md. FAILs only on
    CRITICAL-level violations -- files exceeding 400 LOC or subsystems with
    >=1 .js file but no index.js. WARN-level findings (files over the 200-
    line soft target but under 400) are informational; the 200-line target
    is aspirational and most of the codebase brushes it occasionally."""
    name = "core-principles-audit"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-core-principles.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        crit = payload.get("critical_count", 0)
        warn = payload.get("warn_count", 0)
        p1 = payload.get("p1_count", 0)
        failfast = payload.get("failfast_hits", 0)
        detail = [f"{warn} WARN-level oversize file(s)",
                  f"{failfast} P2 indicator hit(s)"]
        for s in payload.get("subsystems", []):
            for rel, n in s.get("oversize_critical", []):
                detail.append(f"CRITICAL oversize: {rel} ({n} LOC)")
            for item in s["violations"]["P1"]:
                detail.append(f"P1 ({s['name']}): {item}")
        if crit == 0 and p1 == 0:
            return _result(PASS, 1.0,
                           f"no critical violations ({warn} warn-level, {failfast} P2 indicators)",
                           detail[:20])
        # Each critical violation drops the score by 0.25; floor at 0.
        score = max(0.0, 1.0 - 0.25 * (crit + p1))
        return _result(FAIL, score,
                       f"{crit} CRITICAL oversize file(s), {p1} P1 violation(s)",
                       detail[:20])




class HardcodedToolInvocationVerifier(Verifier):
    """Strings like `i/hme admin action=warm`, `i/status mode=hci-diff`,
    `i/evolve focus=design`, `i/review mode=forget`, `i/why mode=block`
    in user-facing output paths (selftest hints, error messages, primer
    examples, narrative output) should render through `tool_invocations.py`
    helpers -- `_action_form('warm')` or `_i_form('status', primer=True)`
    instead of the literal. Otherwise a rename of any wrapper requires
    hand-grepping every occurrence.

    This verifier flags hardcoded `i/<wrapper> <key>=<value>` strings
    that match the mode/action/focus invocation shape. Per-line opt-out:
    append `# tool-form-ok` (use only when the helper genuinely doesn't
    fit, e.g. test fixtures asserting on the literal output, or static
    docstrings where f-strings can't go)."""
    name = "hardcoded-tool-invocation"
    category = "code"
    subtag = "drift-detection"
    weight = 1.5

    # All wrapper invocation shapes that have canonical helper coverage.
    _RE = re.compile(
        r'["\'`](?:i/hme\s+admin\s+action|i/(?:status|evolve|review|why|learn|trace)\s+(?:mode|focus|target|name|query))=[a-zA-Z_][\w-]*'
    )
    _SKIP_FILES = {
        # Helper itself defines the canonical mapping
        "tool_invocations.py",
        # Test fixtures legitimately assert on literal output
    }

    def run(self) -> VerdictResult:
        roots = [os.path.join(_PROJECT, "tools", "HME", "service")]
        violations = []
        scanned = 0
        for root in roots:
            if not os.path.isdir(root):
                continue
            for r, _d, files in os.walk(root):
                if "__pycache__" in r or "/tests/" in r:
                    continue
                for f in files:
                    if not f.endswith(".py") or f in self._SKIP_FILES:
                        continue
                    scanned += 1
                    p = os.path.join(r, f)
                    try:
                        with open(p, encoding="utf-8") as fp:
                            file_lines = fp.readlines()
                        for i, line in enumerate(file_lines, start=1):
                            # Opt-out: `tool-form-ok` on this line OR within
                            opt_out_window = "".join(
                                file_lines[max(0, i - 4): i]
                            )
                            if "tool-form-ok" in opt_out_window:
                                continue
                            stripped = line.lstrip()
                            # Skip Python and JS comments
                            if stripped.startswith("#") or stripped.startswith("//"):
                                continue
                            m = self._RE.search(line)
                            if m:
                                snippet = m.group(0).strip("\"'`")
                                violations.append(
                                    f"{os.path.relpath(p, _PROJECT)}:{i}: "
                                    f"hardcoded `{snippet}` "
                                    f"(use `_action_form()` or `_i_form()` from "
                                    f"tool_invocations; opt-out: append `# tool-form-ok`)"
                                )
                    except OSError:
                        continue
        if not violations:
            return _result(PASS, 1.0,
                           f"{scanned} file(s) scanned; no hardcoded tool invocations")
        score = max(0.0, 1.0 - len(violations) * 0.15)
        return _result(FAIL, score,
                       f"{len(violations)} hardcoded tool-invocation(s)",
                       violations[:10])




class AgentLoopQualityVerifier(Verifier):
    """Scores recent agent-loop telemetry without treating fs-watcher noise as turns."""
    name = "agent-loop-quality"
    category = "code"
    subtag = "freshness"
    weight = 1.0

    def run(self) -> VerdictResult:
        import time as _time
        path = os.path.join(METRICS_DIR, "hme-activity.jsonl")
        if not os.path.isfile(path):
            return _result(SKIP, 1.0, "no activity log yet")
        try:
            with open(path) as f:
                lines = f.readlines()[-3000:]
        except OSError as e:
            return _result(ERROR, 0.0, f"read failed: {e}")

        cutoff = _time.time() - 3600
        events = []
        for ln in lines:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            ts = _activity_ts_seconds(e.get("ts"))
            if ts is not None and ts >= cutoff:
                e["ts"] = ts
                events.append(e)
        if not events:
            return _result(SKIP, 1.0, "no activity in last hour")

        loop_names = telemetry_event_names(stream="activity", group="agent_loop")
        turn_names = telemetry_event_names(stream="activity", group="turn_marker")
        inference_names = telemetry_event_names(stream="activity", group="inference")
        tool_names = telemetry_event_names(stream="activity", group="agent_loop_tool")
        error_names = telemetry_event_names(stream="activity", group="error_surface")
        brief_names = telemetry_event_names(stream="activity", group="briefing")
        loop_events = [e for e in events if e.get("event") in loop_names]
        if not loop_events:
            return _result(SKIP, 1.0,
                           f"no agent-loop telemetry in last hour "
                           f"({len(events)} non-loop activity events)")

        turn_markers = sum(1 for e in loop_events
                           if e.get("event") in turn_names)
        infs = sum(1 for e in loop_events if e.get("event") in inference_names)
        tools = sum(1 for e in loop_events if e.get("event") in tool_names)
        bash_errs = sum(1 for e in loop_events if e.get("event") in error_names)
        briefs = sum(1 for e in loop_events if e.get("event") in brief_names)

        denominator = max(infs, tools, 1)
        err_rate = bash_errs / denominator
        if err_rate > 0.25:
            self._write_tier_marker("RED", f"err_rate={err_rate*100:.1f}%")
            return _result(FAIL, max(0.0, 1.0 - err_rate),
                           f"high error rate: {err_rate*100:.1f}% "
                           f"({bash_errs} bash errors / {denominator} loop events)")

        self._write_tier_marker("GREEN", "healthy loop")
        return _result(PASS, 1.0,
                       f"healthy: {turn_markers} turn markers, {infs} inferences, "
                       f"{tools} tool calls, "
                       f"{briefs} briefs, {bash_errs} errors "
                       f"(err_rate={err_rate*100:.1f}%)")

    def _write_tier_marker(self, tier: str, reason: str) -> None:
        """Persist a GREEN/YELLOW/RED tier marker for downstream
        priming-aggressiveness consumers (Horizon IV maturity)."""
        try:
            import json as _json
            import time as _time
            marker_path = os.path.join(_PROJECT, "tmp", "hme-agent-loop-tier.json")
            tmp_path = marker_path + ".tmp"
            with open(tmp_path, "w") as f:
                _json.dump({
                    "ts": _time.time(),
                    "tier": tier,
                    "reason": reason,
                    "advisory": "consumer wiring optional; no behavior change unless read",
                }, f)
            os.replace(tmp_path, marker_path)
        except OSError:
            # Marker write is advisory; absence shouldn't fail the
            # verifier itself.
            pass




class RepeatedCharSpamVerifier(Verifier):
    """No character may repeat 4+ times in a row in tracked text files --
    targets divider/box-decoration spam (runs of dashes, equals, hashes,
    pipes, tildes, unicode box-drawing). Word characters, whitespace, and
    paren/bracket/brace pairs are exempt so identifiers, indentation, and
    stacked code structure don't trip the rule. Per-line opt-out via the
    literal token `spam-ok`.

    Failing the verifier is intentional: the rule is meant to BLOCK these
    patterns. New violations should be removed -- a markdown heading is
    `## Section`, not the same with a divider tail; a code separator is a
    single blank line, not a comment of repeated symbols."""
    name = "repeated-char-spam"
    category = "code"
    subtag = "regression-prevention"
    weight = 2.0

    def run(self) -> VerdictResult:
        violations = []
        for root, dirs, files in os.walk(_PROJECT):
            dirs[:] = [
                d for d in dirs
                if d not in _SPAM_SKIP_DIRS and not d.startswith(".")
            ]
            for f in files:
                if not f.endswith(_SPAM_EXTS):
                    continue
                abs_path = os.path.join(root, f)
                rel = os.path.relpath(abs_path, _PROJECT)
                if rel in _SPAM_SKIP_FILES:
                    continue
                try:
                    with open(abs_path, encoding="utf-8") as fp:
                        for i, line in enumerate(fp, 1):
                            if _SPAM_ALLOW in line:
                                continue
                            m = _SPAM_RE.search(line)
                            if m:
                                ch = m.group(1)
                                run_len = len(m.group(0))
                                violations.append(
                                    f"{rel}:{i}  {ch!r}*{run_len}"
                                )
                                if len(violations) >= 200:
                                    break
                except (UnicodeDecodeError, OSError):
                    pass  # silent-ok: best-effort fs op
                if len(violations) >= 200:
                    break
            if len(violations) >= 200:
                break
        if not violations:
            return _result(PASS, 1.0, "no character-spam runs detected")
        # Linear penalty: 50 violations halves the score; 100 zeros it.
        score = max(0.0, 1.0 - len(violations) / 100.0)
        suffix = " (showing first 200)" if len(violations) >= 200 else ""
        return _result(
            FAIL, score,
            f"{len(violations)} character-spam run(s){suffix}",
            violations[:30],
        )


class MarkdownLinkIntegrityVerifier(Verifier):
    """All inline markdown links MUST resolve to an existing file or directory.
    Catches the cross-doc drift class that doc-rename and file-relocation
    operations introduce silently. Score is logarithmic against current
    backlog; goal is monotonic improvement."""
    name = "markdown-link-integrity"
    category = "doc"
    subtag = "drift-detection"
    weight = 1.5

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-markdown-links.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        broken = payload.get("broken", [])
        if not broken:
            return _result(PASS, 1.0, "all markdown links resolve")
        # Logarithmic: 100 broken = 0, 50 = 0.15, 10 = 0.5, 1 = 1.0
        import math
        score = max(0.0, 1.0 - math.log10(max(1, len(broken))) / math.log10(100))
        detail = [f"{b['source']}:{b['line']}  ({b['target']})" for b in broken[:10]]
        return _result(FAIL, score, f"{len(broken)} broken markdown link(s)", detail)


class CommentBloatVerifier(Verifier):
    """Comment-block length discipline. doc/templates/AGENTS.md: "Inline comments
    single-line and terse. Elaboration goes in doc/." 3+ consecutive
    comment lines = WARN; 5+ = FAIL.

    Delegates to tools/HME/scripts/audit-comment-bloat.py. Advisory weight (1.0):
    backlog at audit-creation time was 800+ FAIL across the codebase;
    monotonic improvement is the goal, not zero. Score is logarithmic:
    every halving of FAIL count adds substantial score.

    New comment blocks MUST comply. Existing backlog decays naturally as
    files get touched and bloated comments get trimmed. Annotations
    (`# rationale:`, `# silent-ok:`, `# noqa`, `// eslint-`) are exempt.
    """
    name = "comment-bloat"
    category = "code"
    subtag = "regression-prevention"
    weight = 1.0

    def run(self) -> VerdictResult:
        script = os.path.join(_PROJECT, "scripts", "audit-comment-bloat.py")
        if not os.path.isfile(script):
            return _result(SKIP, 1.0, "audit script not found", [script])
        rc, out, err = _run_subprocess([script, "--json"])
        try:
            payload = json.loads(out)
        except Exception:
            return _result(ERROR, 0.0, "could not parse audit output", [err[:500]])
        fail_count = len(payload.get("fail", []))
        warn_count = len(payload.get("warn", []))
        if fail_count == 0:
            return _result(PASS, 1.0, f"no comment-bloat FAILs ({warn_count} WARNs)")
        # Logarithmic scaling: 800 = 0.0, 400 = 0.15, 100 = 0.55, 50 = 0.7,
        # 10 = 0.9, 0 = 1.0. Goal is monotonic improvement, not zero.
        import math
        score = max(0.0, 1.0 - math.log10(max(1, fail_count)) / math.log10(800))
        top = sorted(payload.get("fail", []), key=lambda x: -x.get("block_len", 0))[:10]
        detail = [f"{e['block_len']:>3}L  {e['path']}:{e['line']}" for e in top]
        return _result(
            FAIL, score,
            f"{fail_count} comment block(s) >=5 lines, {warn_count} >=3 lines",
            detail,
        )
