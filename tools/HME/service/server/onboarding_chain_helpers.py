"""HME onboarding chain -- per-session walkthrough state machine.

Chain-decider middleman. Lives INSIDE the MCP server so tool handlers can
invoke each other directly (hooks cannot). Full design spec in
onboarding_chain.py module docstring.

Linear state machine with silent prerequisite auto-chaining:

    boot            fresh session -- waiting for selftest
    selftest_ok     selftest passed -- waiting for evolve(focus='design')
    targeted        target picked -- waiting for read(target, mode='before')
    briefed         KB briefing absorbed -- waiting for Edit(s) on target
    edited          Edit done -- waiting for review(mode='forget')
    reviewed        review clean -- waiting for npm run main
    piped           pipeline running in background -- waiting for verdict
    verified        STABLE/EVOLVED -- waiting for learn(title=, content=)
    graduated       loop complete -- blocks relax, state file deleted

Design rules:
  * Agents see ONE tool call per logical step. Prerequisites run silently
    inside the tool handler and their output is prepended to the result.
  * Advancement is automatic -- tools and hooks write state, agent never does.
  * Missing state file = graduated (permissive). Hooks create it on SessionStart.
  * Chain never HARD-blocks a tool. Failures are reported, tool still runs.
    Hard gates live in shell hooks (for Edit/Bash, which this module can't reach).
  * Graduation is irreversible within a session. Next SessionStart re-arms boot.

State persists across auto-compaction (tmp/ survives). PreCompact/PostCompact
handle edge cases.
"""
import functools
import logging
import os
import re
import sys
from typing import Callable, Optional

_mcp_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

# Sibling state-machine state. Lazy module-attr access avoids the circular
# load order between onboarding_chain / onboarding_chain_dispatch / this
# helpers module -- see onboarding_chain_dispatch.py for the same pattern.
def state():
    from . import onboarding_chain as _oc; return _oc.state()
def set_state(s):
    from . import onboarding_chain as _oc; return _oc.set_state(s)
def target():
    from . import onboarding_chain as _oc; return _oc.target()
def step_index(s):
    from . import onboarding_chain as _oc; return _oc.step_index(s)
def status_line():
    from . import onboarding_chain as _oc; return _oc.status_line()
def is_graduated():
    from . import onboarding_chain as _oc; return _oc.is_graduated()
def force_state(s):
    from . import onboarding_chain_dispatch as _ocd; return _ocd.force_state(s)

# Pull canonical i/<wrapper> + action= forms from the single source of
# truth. Fallback keeps server bootable if the helper module is missing.
# _mcp_root is tools/HME/service; helpers live at tools/HME/scripts
# (one dirname up from _mcp_root, then "scripts").
try:
    _scripts_dir = os.path.join(
        os.path.dirname(_mcp_root), "scripts"
    )
    if _scripts_dir not in sys.path:
        sys.path.insert(0, _scripts_dir)
    from tool_invocations import i_form as _i_form, action_form as _action_form  # type: ignore
except Exception:
    def _i_form(name, primer=False):
        return f"i/{name.replace('_', '-')}"
    def _action_form(action):
        return f"i/hme admin action={action}"

logger = logging.getLogger("HME.onboarding")

STATES = [
    "boot",
    "selftest_ok",
    "targeted",
    "edited",
    "reviewed",
    "piped",
    "verified",
    "graduated",
]

STEP_LABELS = {
    "boot":        f"1/7 boot check (run {_action_form('selftest')})",
    "selftest_ok": f"2/7 pick evolution target (run {_i_form('evolve', primer=True)})",
    "targeted":    "3/7 edit target module (Edit tool -- briefing auto-chains)",
    "edited":      f"4/7 audit changes (run {_i_form('review', primer=True)})",
    "reviewed":    "5/7 run pipeline (Bash: npm run main)",
    "piped":       "6/7 await verdict (hooks advance automatically)",
    "verified":    f"7/7 persist learning (run {_i_form('learn', primer=True)})",
    "graduated":   "graduated -- blocks relax",
}

# Ordered step list for the todo tree mirror -- index matches STATES order
STEP_SHORT = [
    f"boot check ({_action_form('selftest')})",
    f"pick evolution target ({_i_form('evolve', primer=True)})",
    "edit target module (KB briefing auto-chains)",
    f"audit changes ({_i_form('review', primer=True)})",
    "run pipeline (Bash: npm run main)",
    "await pipeline verdict",
    f"persist learning ({_i_form('learn', primer=True)})",
]

_PROJECT_ROOT = ENV.require("PROJECT_ROOT")
# Flat per-field state files -- kept separate (not merged into JSON) so shell
# helpers can read them via `cat` without pulling in `jq` or Python. The
# tradeoff: two files instead of one, but much simpler hook code.
_STATE_FILE = os.path.join(_PROJECT_ROOT, "tmp", "hme-onboarding.state")
_TARGET_FILE = os.path.join(_PROJECT_ROOT, "tmp", "hme-onboarding.target")



# State I/O -- single-file flat storage, never raises






def _run_selftest_prereq() -> str:
    """Run selftest in-process and format its output.

    Calls the undecorated hme_selftest directly -- going through the
    @chained hme_admin dispatcher would append another status_line, which
    the outer tool's chain_exit also appends, causing a duplicate banner.
    Advances state to 'selftest_ok' manually on clean pass (the side
    effect the decorator would have performed).
    """
    try:
        from server.tools_analysis.evolution import hme_selftest
        result = hme_selftest(verbose=False)
        if _selftest_clean(result) and step_index(state()) <= step_index("selftest_ok"):
            set_state("selftest_ok")
        header = (
            "[AUTO-CHAIN] Onboarding step 1/8: ran selftest as prerequisite.\n"
            " selftest output "
        )
        footer = " prerequisite done, continuing with your original call \n"
        return f"{header}\n{result}\n{footer}"
    except Exception as e:
        return f"[AUTO-CHAIN] selftest prerequisite error: {e}\n"


def _selftest_clean(output: str) -> bool:
    """Return True if selftest output indicates 0 FAILs. Checks ONLY the
    structured 'FAIL:' check lines (e.g. '  FAIL: doc sync -- OUT OF SYNC'),
    not substring matches on the word 'fail' which triggered false negatives
    from historical WARN log summaries ('default backend failed' inside a
    benign ONNX-fallback WARNING was blocking onboarding graduation)."""
    # Look for explicit FAIL-status lines in the structured selftest output.
    # These have the form "  FAIL: <check name> -- <detail>" -- case-sensitive
    # "FAIL:" distinguishes them from the word "failed" in prose.
    import re as _re
    if _re.search(r'^\s*FAIL:\s', output, flags=_re.MULTILINE):
        return False
    # No explicit FAIL lines -- READY verdict or only WARN/INFO.
    return True


def _review_clean(output: str) -> bool:
    """Return True if review(mode='forget') reports clean status.

    Preferred path: structured `<!-- HME_REVIEW_VERDICT: clean -->` marker.
    Fallback: text heuristics matching current review output format. The
    fallback becomes unnecessary once review_unified.py starts emitting
    markers via emit_review_verdict_marker().
    """
    # Preferred: structured marker
    m = re.search(r'<!--\s*HME_REVIEW_VERDICT:\s*(clean|warnings|error)\s*-->', output)
    if m:
        return m.group(1) == "clean"
    # Fallback: text heuristics
    lo = output.lower()
    if "warnings: none" in lo:
        return True
    if "no changed files detected" in lo:
        return True
    return False


def _extract_target_from_evolve(output: str) -> str:
    """Parse a target module name out of evolve() output.

    Robust layered lookup -- tries structured markers first, falls back to
    regex heuristics. When upstream generators start emitting markers via
    `emit_target_marker()`, the structured path takes over and brittle
    regex fallbacks become unnecessary.
    """
    # Layer 1 (preferred): structured HTML-comment marker
    #   <!-- HME_TARGET: moduleName -->
    m = re.search(r'<!--\s*HME_TARGET:\s*([a-zA-Z_][a-zA-Z0-9_]+)\s*-->', output)
    if m:
        return m.group(1)
    # Layer 2: fenced marker -- used when HTML comments would break rendering
    #   [HME_TARGET:moduleName]
    m = re.search(r'\[HME_TARGET:\s*([a-zA-Z_][a-zA-Z0-9_]+)\s*\]', output)
    if m:
        return m.group(1)
    # Layer 3: explicit "target: crossLayerClimaxEngine" or similar
    m = re.search(r'(?:target|module|file|focus)[:\s]+`?([a-zA-Z_][a-zA-Z0-9_]+)`?',
                  output, re.IGNORECASE)
    if m:
        return m.group(1)
    # Layer 4: backtick-wrapped camelCase identifier
    m = re.search(r'`([a-z][a-zA-Z0-9]+[A-Z][a-zA-Z0-9_]*)`', output)
    if m:
        return m.group(1)
    return ""


def emit_target_marker(module_name: str) -> str:
    """Format a structured target marker for embedding in evolve() output.

    Producers should append this line to their output when they want the
    chain decider to reliably pick up a target module regardless of text
    formatting. Example:
        result = build_design_report(...)
        result += "\\n" + emit_target_marker("crossLayerClimaxEngine")
        return result
    """
    if not module_name or not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]+$', module_name):
        return ""
    return f"<!-- HME_TARGET: {module_name} -->"


def emit_review_verdict_marker(verdict: str) -> str:
    """Format a structured review verdict marker.

    Producers should append this line to `review(mode='forget')` output so
    the chain decider can advance state deterministically:
        clean:      agent may proceed (edited -> reviewed)
        warnings:   agent must fix warnings first (stay at edited)
        error:      verifier itself failed (stay at edited, surface error)
    """
    if verdict not in ("clean", "warnings", "error"):
        return ""
    return f"<!-- HME_REVIEW_VERDICT: {verdict} -->"



# CLI -- callable from shell hooks via `python3 -m server.onboarding_chain ...`


def _cli():
    """CLI for shell hooks. Usage:
        python3 -m server.onboarding_chain state
        python3 -m server.onboarding_chain target
        python3 -m server.onboarding_chain set <state>
        python3 -m server.onboarding_chain advance <state>
        python3 -m server.onboarding_chain graduated
        python3 -m server.onboarding_chain status_line
    """
    if len(sys.argv) < 2:
        print(state())
        return
    cmd = sys.argv[1]
    if cmd == "state":
        print(state())
    elif cmd == "target":
        print(target())
    elif cmd == "set" and len(sys.argv) > 2:
        set_state(sys.argv[2])
    elif cmd == "advance" and len(sys.argv) > 2:
        print("ok" if force_state(sys.argv[2]) else "no-op")
    elif cmd == "graduated":
        print("yes" if is_graduated() else "no")
    elif cmd == "status_line":
        print(status_line().strip())
    elif cmd == "step":
        s = state()
        print(STEP_LABELS.get(s, s))
    else:
        sys.stderr.write(f"unknown command: {cmd}\n")
        sys.exit(1)


if __name__ == "__main__":
    _cli()
