"""HME onboarding chain -- per-session walkthrough state machine.

Chain-decider middleman. Lives INSIDE the MCP server so tool handlers can
invoke each other directly (hooks cannot). Full design spec in
onboarding_chain.py module docstring.

Linear state machine with silent prerequisite auto-chaining:

    boot            fresh session -- waiting for selftest
    selftest_ok     selftest passed -- waiting for evolve(focus='design')
    targeted        target picked -- waiting for HME pre-edit briefing
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

# Sibling state-machine. Lazy module-attr access avoids the circular: when
def state():
    from . import onboarding_chain as _oc; return _oc.state()
def set_state(s):
    from . import onboarding_chain as _oc; return _oc.set_state(s)
def target():
    from . import onboarding_chain as _oc; return _oc.target()
def set_target(t):
    from . import onboarding_chain as _oc; return _oc.set_target(t)
def step_index(s):
    from . import onboarding_chain as _oc; return _oc.step_index(s)
def status_line():
    from . import onboarding_chain as _oc; return _oc.status_line()
def is_graduated():
    from . import onboarding_chain as _oc; return _oc.is_graduated()

# Pull canonical i/<wrapper> + action= forms from the single source of
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
_STATE_FILE = os.path.join(_PROJECT_ROOT, "tmp", "hme-onboarding.state")
_TARGET_FILE = os.path.join(_PROJECT_ROOT, "tmp", "hme-onboarding.target")



# State I/O -- single-file flat storage, never raises




def chain_enter(tool: str, args: dict) -> Optional[str]:
    """Auto-run prerequisites for `tool` based on current state.

    Returns prereq output text to be prepended to the tool's own result, or
    None if no chaining needed. Never raises. Never hard-aborts the tool --
    if a prereq fails, the output is still prepended but the tool runs.
    """
    s = state()
    if s == "graduated":
        return None

    # Prerequisite rule: every HME tool except selftest auto-runs selftest
    if s == "boot":
        needs_selftest = not (
            tool == "hme_admin" and args.get("action") == "selftest"
        )
        if needs_selftest:
            return _run_selftest_prereq()

    return None


def chain_exit(tool: str, args: dict, output: str) -> str:
    """Advance state based on tool completion. Append status line.

    Never raises. Advancement is strictly forward -- never moves state
    backwards, never skips steps it doesn't understand.
    """
    if not isinstance(output, str):
        output = str(output)

    s = state()
    if s == "graduated":
        return output

    try:
        _advance(tool, args, output, s)
    except Exception as e:
        logger.warning(f"onboarding: advance failed for {tool}: {e}")

    return output + status_line()


def _advance(tool: str, args: dict, output: str, s: str) -> None:
    """State transition table. Each branch only advances FORWARD."""
    idx = step_index(s)

    # admin selftest passes -> selftest_ok
    if tool == "hme_admin" and args.get("action") == "selftest":
        if idx <= step_index("selftest_ok") and _selftest_clean(output):
            set_state("selftest_ok")
            return

    # evolve(focus=<target-picking>) -> targeted. Diagnostic foci
    if tool == "evolve":
        focus = args.get("focus", "all")
        if focus in ("design", "forge", "curate"):
            if idx < step_index("targeted"):
                picked = _extract_target_from_evolve(output)
                if picked:
                    set_target(picked)
                set_state("targeted")
                return

    # Internal pre-edit briefing on a module captures target if missing (the hook
    if tool == "read" and args.get("mode") == "before":
        tgt = args.get("target", "") or ""
        if tgt and not target():
            set_target(tgt)

    # review(mode='forget') clean -> reviewed
    # Only advances from 'edited' state; can't jump over Edit.
    if tool == "review" and args.get("mode") == "forget":
        if idx == step_index("edited") and _review_clean(output):
            set_state("reviewed")
            return

    # learn(title=, content=) while verified -> graduated
    if tool == "learn" and args.get("title") and args.get("content"):
        if idx >= step_index("verified"):
            set_state("graduated")
            return



# Decorator -- the clean wrap point for @ctx.mcp.tool() functions


def chained(tool_name: str) -> Callable:
    """Decorator that wraps an HME tool handler with chain_enter/chain_exit.

    Usage:
        @ctx.mcp.tool()
        @chained("evolve")
        def evolve(focus: str = "all", query: str = "") -> str:
            ...

    Decorator order matters -- @ctx.mcp.tool() must be OUTERMOST so FastMCP
    registers the wrapped function. functools.wraps preserves __wrapped__ so
    inspect.signature() still sees the original signature for MCP schema.
    """
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            # Build arg dict from kwargs -- positional args rare for MCP tools
            arg_dict = dict(kwargs)
            prereq = None
            try:
                prereq = chain_enter(tool_name, arg_dict)
            except Exception as e:
                logger.warning(f"onboarding: chain_enter failed for {tool_name}: {e}")

            try:
                result = fn(*args, **kwargs)
            except Exception as _err:
                logger.debug(f"unnamed-except onboarding_chain.py:323: {type(_err).__name__}: {_err}")
                import traceback
                result = f"Error: {traceback.format_exc()}"

            if not isinstance(result, str):
                result = str(result)

            if prereq:
                result = prereq + "\n" + result

            try:
                return chain_exit(tool_name, arg_dict, result)
            except Exception as e:
                logger.warning(f"onboarding: chain_exit failed for {tool_name}: {e}")
                return result

        return wrapper
    return decorator



# External API -- for shell hooks to drive Edit/Bash state transitions


def force_state(s: str) -> bool:
    """External state advance -- used by hooks via `python3 -c`.
    Only advances forward; refuses backward moves. Returns True on success.
    """
    if s not in STATES:
        return False
    cur = state()
    if step_index(s) <= step_index(cur):
        return False
    set_state(s)
    return True



# Helpers



# Re-exports -- helpers extracted.
from .onboarding_chain_helpers import (  # noqa: F401, E402
    _run_selftest_prereq, _selftest_clean, _review_clean,
    _extract_target_from_evolve,
    emit_target_marker, emit_review_verdict_marker,
)
