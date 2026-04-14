"""HME onboarding chain — per-session walkthrough state machine.

The "chain decider middleman" from HME_ONBOARDING_FLOW.md. Lives INSIDE the
MCP server so tool handlers can invoke each other directly (hooks cannot).

Linear state machine with silent prerequisite auto-chaining:

    boot            fresh session — waiting for selftest
    selftest_ok     selftest passed — waiting for evolve(focus='design')
    targeted        target picked — waiting for read(target, mode='before')
    briefed         KB briefing absorbed — waiting for Edit(s) on target
    edited          Edit done — waiting for review(mode='forget')
    reviewed        review clean — waiting for npm run main
    piped           pipeline running in background — waiting for verdict
    verified        STABLE/EVOLVED — waiting for learn(title=, content=)
    graduated       loop complete — blocks relax, state file deleted

Design rules:
  * Agents see ONE tool call per logical step. Prerequisites run silently
    inside the tool handler and their output is prepended to the result.
  * Advancement is automatic — tools and hooks write state, agent never does.
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
    "boot":        "1/7 boot check (run hme_admin selftest)",
    "selftest_ok": "2/7 pick evolution target (run evolve focus=design)",
    "targeted":    "3/7 edit target module (Edit tool — briefing auto-chains)",
    "edited":      "4/7 audit changes (run review mode=forget)",
    "reviewed":    "5/7 run pipeline (Bash: npm run main)",
    "piped":       "6/7 await verdict (hooks advance automatically)",
    "verified":    "7/7 persist learning (run learn title=, content=)",
    "graduated":   "graduated — blocks relax",
}

# Ordered step list for the todo tree mirror — index matches STATES order
STEP_SHORT = [
    "boot check (hme_admin action=selftest)",
    "pick evolution target (evolve focus=design)",
    "edit target module (KB briefing auto-chains)",
    "audit changes (review mode=forget)",
    "run pipeline (Bash: npm run main)",
    "await pipeline verdict",
    "persist learning (learn title=, content=)",
]

_PROJECT_ROOT = (
    os.environ.get("PROJECT_ROOT")
    or os.environ.get("CLAUDE_PROJECT_DIR")
    or "/home/jah/Polychron"
)
# Flat per-field state files — kept separate (not merged into JSON) so shell
# helpers can read them via `cat` without pulling in `jq` or Python. The
# tradeoff: two files instead of one, but much simpler hook code.
_STATE_FILE = os.path.join(_PROJECT_ROOT, "tmp", "hme-onboarding.state")
_TARGET_FILE = os.path.join(_PROJECT_ROOT, "tmp", "hme-onboarding.target")


# --------------------------------------------------------------------------
# State I/O — single-file flat storage, never raises
# --------------------------------------------------------------------------

def state() -> str:
    """Current onboarding state. Missing file = 'graduated' (permissive)."""
    try:
        with open(_STATE_FILE) as f:
            s = f.read().strip()
        return s if s in STATES else "graduated"
    except FileNotFoundError:
        return "graduated"
    except Exception as e:
        logger.warning(f"onboarding: state read failed: {e}")
        return "graduated"


def set_state(s: str) -> None:
    """Write new state. Deletes file on 'graduated'. Never raises.

    Also mirrors the new state into the HME todo tree so the walkthrough is
    visible in the agent's native todo view (E4 integration).
    """
    if s not in STATES:
        logger.warning(f"onboarding: rejected invalid state {s!r}")
        return
    try:
        if s == "graduated":
            for f in (_STATE_FILE, _TARGET_FILE):
                try:
                    os.remove(f)
                except FileNotFoundError:
                    pass
            _mirror_to_todo_tree_graduated()
            return
        os.makedirs(os.path.dirname(_STATE_FILE), exist_ok=True)
        with open(_STATE_FILE, "w") as f:
            f.write(s)
        _mirror_to_todo_tree(s)
    except Exception as e:
        logger.warning(f"onboarding: state write failed: {e}")


def _mirror_to_todo_tree(current_state: str) -> None:
    """Project the current state onto the HME todo tree as a parent with subs
    per step. Called on every state transition. Soft-fails if the todo module
    can't be loaded (e.g., during early server bootstrap)."""
    try:
        from server.tools_analysis.todo import register_onboarding_tree
    except Exception:
        return
    cur_idx = step_index(current_state)
    steps = []
    for i, short in enumerate(STEP_SHORT):
        if i < cur_idx:
            status = "completed"
        elif i == cur_idx:
            status = "in_progress"
        else:
            status = "pending"
        steps.append((short, status))
    try:
        register_onboarding_tree(steps)
    except Exception as e:
        logger.warning(f"onboarding: todo tree mirror failed: {e}")


def _mirror_to_todo_tree_graduated() -> None:
    try:
        from server.tools_analysis.todo import clear_onboarding_tree
        clear_onboarding_tree()
    except Exception:
        pass


def target() -> str:
    """Briefed target module name (or empty)."""
    try:
        with open(_TARGET_FILE) as f:
            return f.read().strip()
    except Exception:
        return ""


def set_target(t: str) -> None:
    """Write target module name. Never raises."""
    if not t:
        return
    try:
        os.makedirs(os.path.dirname(_TARGET_FILE), exist_ok=True)
        with open(_TARGET_FILE, "w") as f:
            f.write(t)
    except Exception as e:
        logger.warning(f"onboarding: target write failed: {e}")


def is_graduated() -> bool:
    return state() == "graduated"


def step_index(s: str) -> int:
    try:
        return STATES.index(s)
    except ValueError:
        return len(STATES)


def status_line() -> str:
    """One-line suffix for tool output (empty if graduated)."""
    s = state()
    if s == "graduated":
        return ""
    return f"\n\n[HME onboarding: step {STEP_LABELS.get(s, s)}]"


# --------------------------------------------------------------------------
# Chain enter/exit — the "middleman" that decides when to chain prerequisites
# --------------------------------------------------------------------------

def chain_enter(tool: str, args: dict) -> Optional[str]:
    """Auto-run prerequisites for `tool` based on current state.

    Returns prereq output text to be prepended to the tool's own result, or
    None if no chaining needed. Never raises. Never hard-aborts the tool —
    if a prereq fails, the output is still prepended but the tool runs.
    """
    s = state()
    if s == "graduated":
        return None

    # Prerequisite rule: every HME tool except selftest auto-runs selftest
    # when state is 'boot'. This is the single chaining rule — everything
    # else is state advancement, not prerequisite chaining.
    if s == "boot":
        needs_selftest = not (
            tool == "hme_admin" and args.get("action") == "selftest"
        )
        if needs_selftest:
            return _run_selftest_prereq()

    return None


def chain_exit(tool: str, args: dict, output: str) -> str:
    """Advance state based on tool completion. Append status line.

    Never raises. Advancement is strictly forward — never moves state
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

    # hme_admin(action='selftest') passes -> selftest_ok
    if tool == "hme_admin" and args.get("action") == "selftest":
        if idx <= step_index("selftest_ok") and _selftest_clean(output):
            set_state("selftest_ok")
            return

    # evolve(focus='design'|'forge'|'curate'|'stress'|'invariants') -> targeted
    # Any "pick a target" call advances. We also capture the target module if
    # we can parse one out of the output.
    if tool == "evolve":
        focus = args.get("focus", "all")
        if focus in ("design", "forge", "curate", "stress", "invariants", "patterns"):
            if idx < step_index("targeted"):
                picked = _extract_target_from_evolve(output)
                if picked:
                    set_target(picked)
                set_state("targeted")
                return

    # read(mode='before') on a module -> captures target if missing (the hook
    # auto-chains read() into Edit, so this is a passive capture, not a state
    # transition). State advances on Edit, not on read.
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


# --------------------------------------------------------------------------
# Decorator — the clean wrap point for @ctx.mcp.tool() functions
# --------------------------------------------------------------------------

def chained(tool_name: str) -> Callable:
    """Decorator that wraps an HME tool handler with chain_enter/chain_exit.

    Usage:
        @ctx.mcp.tool()
        @chained("evolve")
        def evolve(focus: str = "all", query: str = "") -> str:
            ...

    Decorator order matters — @ctx.mcp.tool() must be OUTERMOST so FastMCP
    registers the wrapped function. functools.wraps preserves __wrapped__ so
    inspect.signature() still sees the original signature for MCP schema.
    """
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            # Build arg dict from kwargs — positional args rare for MCP tools
            arg_dict = dict(kwargs)
            prereq = None
            try:
                prereq = chain_enter(tool_name, arg_dict)
            except Exception as e:
                logger.warning(f"onboarding: chain_enter failed for {tool_name}: {e}")

            try:
                result = fn(*args, **kwargs)
            except Exception:
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


# --------------------------------------------------------------------------
# External API — for shell hooks to drive Edit/Bash state transitions
# --------------------------------------------------------------------------

def force_state(s: str) -> bool:
    """External state advance — used by hooks via `python3 -c`.
    Only advances forward; refuses backward moves. Returns True on success.
    """
    if s not in STATES:
        return False
    cur = state()
    if step_index(s) <= step_index(cur):
        return False
    set_state(s)
    return True


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _run_selftest_prereq() -> str:
    """Run hme_admin(action='selftest') in-process and format its output."""
    try:
        from server.tools_analysis.evolution_admin import hme_admin
        result = hme_admin(action="selftest")
        header = (
            "[AUTO-CHAIN] Onboarding step 1/8: ran selftest as prerequisite.\n"
            "--- selftest output ---"
        )
        footer = "--- prerequisite done, continuing with your original call ---\n"
        return f"{header}\n{result}\n{footer}"
    except Exception as e:
        return f"[AUTO-CHAIN] selftest prerequisite error: {e}\n"


def _selftest_clean(output: str) -> bool:
    """Return True if selftest output indicates 0 FAILs."""
    lo = output.lower()
    if "0 fail" in lo:
        return True
    if "fail:" in lo and "0 fail" not in lo:
        # Has explicit FAIL lines
        return False
    # Default: assume OK if no explicit FAIL
    return "fail" not in lo or "0 fail" in lo


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

    Robust layered lookup — tries structured markers first, falls back to
    regex heuristics. When upstream generators start emitting markers via
    `emit_target_marker()`, the structured path takes over and brittle
    regex fallbacks become unnecessary.
    """
    # Layer 1 (preferred): structured HTML-comment marker
    #   <!-- HME_TARGET: moduleName -->
    m = re.search(r'<!--\s*HME_TARGET:\s*([a-zA-Z_][a-zA-Z0-9_]+)\s*-->', output)
    if m:
        return m.group(1)
    # Layer 2: fenced marker — used when HTML comments would break rendering
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
        clean:      agent may proceed (edited → reviewed)
        warnings:   agent must fix warnings first (stay at edited)
        error:      verifier itself failed (stay at edited, surface error)
    """
    if verdict not in ("clean", "warnings", "error"):
        return ""
    return f"<!-- HME_REVIEW_VERDICT: {verdict} -->"


# --------------------------------------------------------------------------
# CLI — callable from shell hooks via `python3 -m server.onboarding_chain ...`
# --------------------------------------------------------------------------

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
