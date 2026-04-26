"""Meta-observer layer implementations (L13-L∞∞) — package split R100.

Extracted from meta_observer.py; the original monolithic 1412-line
meta_layers.py lives here as a package. Each submodule covers one
meta-layer family. Shared state lives in _shared.py — SUBMODULES
MUST access mutable state via `from . import _shared` + `_shared.<name>`
so external reassignment (`meta_layers._shared._ms = ms`) is visible
to every function.

Public API (re-exported for caller compatibility):
  register_monitor_thread, read_startup_narrative,
  read_entanglement_for_compaction,
  record_prediction, resolve_prediction, get_current_intent

The caller (meta_observer.py) also reaches into private symbols
(_ms, _check_monitor_alive, _correlate, _narrate, etc.) — all those
are re-exported below so `meta_layers._X` access still works.

Submodule layout:
  _shared.py     module-level state + constants (single source of truth)
  monitor.py     L13 monitor watchdog + heartbeat + observation gap
  narrative.py   L14 correlate/narrate + synthesis/coherence history I/O
  environment.py L15 environment scan + entanglement checkpoint
  predictions.py L17 record/resolve/expire/counterfactual/effectiveness
  causal.py      L18 causal attribution + lookahead + run history + KB confidence
  intent.py      L19 intent classification
  archaeology.py L20+ session archaeology + unprovable claims + coherence ceiling
"""
from __future__ import annotations

# Expose _shared so external reassignments like
# `meta_layers._shared._ms = ms` reach every submodule's state access.
from . import _shared  # noqa: F401

# Public API functions
from .monitor import (  # noqa: F401
    register_monitor_thread, _check_monitor_alive,
    _write_heartbeat, _read_heartbeat, _detect_observation_gap,
)
from .narrative import (  # noqa: F401
    _load_synthesis_history, _load_coherence_history,
    _correlate, _narrate, _write_narrative, _trim_narrative_file,
    _read_last_narrative, read_startup_narrative,
)
from .environment import (  # noqa: F401
    _scan_environment, _checkpoint_entanglement,
    _read_entanglement, read_entanglement_for_compaction,
)
from .predictions import (  # noqa: F401
    record_prediction, resolve_prediction, _expire_predictions,
    _write_counterfactual, _trim_counterfactuals_file,
    _compute_effectiveness, _detect_synthesis_patterns,
    _auto_predictions_from_correlator,
)
from .causal import (  # noqa: F401
    _causal_attribution, _anticipatory_lookahead,
    _load_run_history, _iso_to_unix,
    _correlate_composition_runs, _update_kb_confidence,
)
from .intent import (  # noqa: F401
    _classify_intent, get_current_intent,
)
from .archaeology import (  # noqa: F401
    _session_archaeology, _enumerate_unprovable_claims,
    _check_coherence_ceiling,
)


# Back-compat proxy: meta_observer.py sets `meta_layers._ms = X`. With the
# package split, that would only bind a package attribute; submodule
# functions read `_shared._ms`. Intercept the assignment and forward
# to _shared so both paths see the same value.
import sys as _sys


def __getattr__(name):
    # Read-through for back-compat. Caller doing `meta_layers._ms` sees
    # the live _shared value.
    if name in ("_ms", "_monitor_thread_ref", "_monitor_restart_count",
                "_last_correlations", "_last_env_snapshot", "_predictions",
                "_current_intent", "_run_history_dir"):
        return getattr(_shared, name)
    raise AttributeError(f"module 'meta_layers' has no attribute {name!r}")


# Explicit setter for external state assignment. Prefer this over the
# implicit `meta_layers._ms = X` pattern, which now requires __setattr__
# on the module object (not natively supported without sys.modules hacks).
def set_ms(ms) -> None:
    """Called by meta_observer.start() to wire up MetaState."""
    _shared._ms = ms
