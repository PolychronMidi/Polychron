"""HME onboarding chain -- per-session walkthrough state machine.

Chain-decider middleman. Lives INSIDE the MCP server so tool handlers can
invoke each other directly (hooks cannot). Agent-facing walkthrough is in
doc/templates/ONBOARDING.md.

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
  * One tool call per logical step. Prerequisites run silently inside
    the tool handler and their output is prepended to the result.
  * Advancement is automatic -- tools/hooks write state, agent never does.
  * Forward-only. Eliminates whole classes of race conditions.
  * Permissive on missing/corrupt state -- treat as graduated; never get
    the agent stuck.
  * Composition is the carrier wave; HME self-monitoring rides along
    (every walkthrough targets a composition evolution).
  * Hooks enforce what the chain decider cannot. Hooks handle Edit/Bash/
    Write; for HME tools the chain decider is the authority.

Auto-chaining (one rule):
  When state == boot AND any HME tool other than hme_admin(action='selftest')
  is called, the handler runs selftest in-process first, prepends its output
  to the tool result, and advances to selftest_ok if zero failures. Other
  transitions describe natural workflow order; silent auto-chaining for
  judgment calls (which target? what content?) would hide work from the agent.

Tool-handler wiring (@chained decorator):
  Sits between @ctx.mcp.tool() and the function body. @ctx.mcp.tool() must
  be OUTERMOST so FastMCP registers the wrapped function. functools.wraps
  preserves __wrapped__; inspect.signature() follows transparently.
  Decorator order:
      @ctx.mcp.tool()
      @chained("evolve")
      def evolve(...): ...
  chain_enter runs prereqs + captures output. Tool body runs. Prereq
  output prepended to result. chain_exit advances state, appends status line.

Gate hooks (external tools the chain decider can't reach from Python):
  pretooluse_edit.sh   block Edit on /src/ when state earlier than briefed
  pretooluse_bash.sh   block npm-run-main when state earlier than reviewed
  posttooluse_edit.sh  advance briefed->edited on src/ Edit success
  posttooluse_bash.sh  advance reviewed->piped on npm launch; piped->verified
                       on STABLE/EVOLVED verdict

Graduation:
  learn(title=, content=) with non-empty args + state == verified -> chain_exit
  sets state to graduated, deletes tmp/hme-onboarding.state and .target,
  appends "[grad] HME ONBOARDING COMPLETE", subsequent calls bypass gates.
  Per-session: next SessionStart re-arms boot via sessionstart.sh:_onb_init.

Failure modes:
  state file missing mid-session  -> treated as graduated (permissive)
  Python import fails             -> shell hooks still gate via raw cat
  agent picks bad target          -> read() errors; state stays targeted
  agent edits outside /src/       -> no block; gates only fire for /src/
  selftest fails at boot          -> output prepended; state stays boot
  user interrupts mid-loop        -> state persists; nexus reminder next turn
  compaction                      -> tmp/ survives; walkthrough resumes

Adding a new state:
  1. Append to STATES + STEP_LABELS
  2. Add transition branch in _advance()
  3. Add to _ONB_STATES in hooks/helpers/_onboarding.sh
  4. Add step-label case in _onb_step_label
  5. Update doc/templates/ONBOARDING.md state-machine block

Adding a new gate for an external tool:
  1. Source _onboarding.sh in pretooluse_*.sh
  2. _onb_before "state_name" + emit decision: deny with instructive reason
  3. Matching posttooluse_*.sh advances via _onb_advance_to

Native TodoWrite integration:
  set_state writes the state file AND register_onboarding_tree(steps) in
  todo.py. pretooluse_todowrite.sh merges the HME tree into the agent's
  native list via updatedInput, preserving sub IDs across transitions.
  On graduation, clear_onboarding_tree() removes the parent + subs.

NOT enforced:
  * Cross-session graduation persistence (matches LLM amnesia)
  * Order within a state (agent edits multiple files in any order)
  * Quality of learn() content (KB quality lives in evolve(focus='curate'))
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

def _load_states() -> list[str]:
    """Load canonical state list from tools/HME/config/onboarding_states.json."""
    import json as _json
    here = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(here, "..", "..", "..", "config", "onboarding_states.json")
    try:
        with open(json_path, encoding="utf-8") as f:
            return _json.load(f)["states"]
    except (OSError, KeyError, _json.JSONDecodeError):
        return ["boot", "selftest_ok", "targeted", "edited", "reviewed", "piped", "verified", "graduated"]

STATES = _load_states()

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
    try:
        from server.lifecycle_writers import assert_writer
        assert_writer("onboarding-state", __file__)
    except ImportError:  # silent-ok: lifecycle_writers optional outside full HME tree
        pass
    if s not in STATES:
        logger.warning(f"onboarding: rejected invalid state {s!r}")
        return
    try:
        if s == "graduated":
            for f in (_STATE_FILE, _TARGET_FILE):
                try:
                    os.remove(f)
                except FileNotFoundError:  # silent-ok: graduation-state file cleanup; missing file = already graduated
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
        from server.tools_analysis import register_onboarding_tree
    except Exception as _err:
        logger.debug(f"unnamed-except onboarding_chain.py:133: {type(_err).__name__}: {_err}")
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
        from server.tools_analysis import clear_onboarding_tree
        clear_onboarding_tree()
    except (ImportError, AttributeError) as _clr_err:
        logger.debug(f"onboarding: clear_onboarding_tree unavailable: {_clr_err}")


def target() -> str:
    """Briefed target module name (or empty)."""
    try:
        with open(_TARGET_FILE) as f:
            return f.read().strip()
    except Exception as _err:
        logger.debug(f"unnamed-except onboarding_chain.py:164: {type(_err).__name__}: {_err}")
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
    """One-line suffix for tool output.

    R24 #6: when graduated, prepends substrate briefing from the four-arc
    state IF there are queued actions or high divergence. Silent when the
    substrate reports healthy quiescent state. Agent gets the briefing
    via normal tool output instead of needing to query status_unified.
    """
    s = state()
    if s == "graduated":
        return _substrate_brief_line()
    onboard = f"\n\n[HME onboarding: step {STEP_LABELS.get(s, s)}]"
    return _substrate_brief_line() + onboard


def _substrate_brief_line() -> str:
    """Return a brief substrate status line if there's a signal; else empty.

    Fast: reads only pre-computed JSON artifacts, no shell/git work.
    """
    try:
        import json as _json
        from server import context as _ctx
        root = _ctx.PROJECT_ROOT
        na_path = os.path.join(root, "output", "metrics", "hme-next-actions.json")
        con_path = os.path.join(root, "output", "metrics", "hme-consensus.json")
        na = {}
        con = {}
        if os.path.isfile(na_path):
            with open(na_path) as f:
                na = _json.load(f) or {}
        if os.path.isfile(con_path):
            with open(con_path) as f:
                con = _json.load(f) or {}
        n_actions = na.get("total_actions", 0)
        stdev = con.get("stdev")
        divergence = con.get("divergence")
        # Show only when signal exists: queued actions OR high divergence
        if n_actions <= 0 and divergence != "high":
            return ""
        bits = [f"consensus stdev={stdev} divergence={divergence}"]
        if n_actions > 0:
            bits.append(f"{n_actions} action(s) queued")
            top = (na.get("actions") or [{}])[0]
            if top.get("id"):
                bits.append(f"next: {top['id']}")
        return f"\n\n[HME substrate: {' | '.join(bits)}]"
    except Exception as _brief_err:
        # Silent -- briefing is opportunistic; never break tool output.
        _ = _brief_err
        return ""



# Chain enter/exit -- the "middleman" that decides when to chain prerequisites



# Re-exports -- chain dispatch logic extracted to sibling.
from .onboarding_chain_dispatch import (  # noqa: F401, E402
    chain_enter, chain_exit, chained, force_state,
    emit_target_marker, emit_review_verdict_marker,
)
