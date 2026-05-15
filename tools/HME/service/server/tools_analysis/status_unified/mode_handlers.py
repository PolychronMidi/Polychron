"""Status-mode handlers -- registry only. Handlers live in status_modes_*.py siblings."""
from __future__ import annotations

import logging

from server import context as ctx

# Cross-submodule report-function imports (used by lambda registry entries below).
from .resource_reports import _vram_report, _freshness_report, _budget_report
from .lifecycle_reports import (
    _resume_briefing, _evolution_priority_report, _trajectory_report,
)
from .metric_reports import _staleness_report, _coherence_report

# Re-export handlers from sibling modules.
from .status_modes_basic import (  # noqa: F401
    _mode_pipeline, _mode_health, _mode_coupling, _mode_trust, _mode_hme,
    _mode_perceptual, _mode_introspect, _mode_signals,
    _mode_blindspots, _mode_hypotheses, _mode_drift, _mode_accuracy,
    _mode_crystallized, _mode_music_truth, _mode_kb_trust,
    _mode_intention_gap, _mode_self_audit, _mode_probes,
    _mode_negative_space, _mode_cognitive_load, _mode_ground_truth,
    _mode_constitution, _mode_doc_drift, _mode_generalizations,
    _mode_reflexivity, _mode_multi_agent,
    _list_modes,
)
from .status_modes_band import (  # noqa: F401
    _mode_multi_axis_band, _mode_conjugate, _compute_per_axis_band,
)
from .status_modes_band_tuning import _mode_band_tuning  # noqa: F401
from .status_modes_agent import (  # noqa: F401
    _mode_activity, _mode_tool_latency, _mode_agent_loop,
)
from .status_modes_hci import (  # noqa: F401
    _mode_hci_by_subtag, _mode_hci_diff, _mode_race_stats,
)
from .status_modes_kb import _mode_learn_suggestions  # noqa: F401

logger = logging.getLogger("HME")

_STATUS_MODES: dict[str, callable] = {
    "resume": lambda: _resume_briefing(),
    "pipeline": _mode_pipeline,
    "health": _mode_health,
    "coupling": _mode_coupling,
    "trust": _mode_trust,
    "perceptual": _mode_perceptual,
    "hme": _mode_hme,
    "activity": _mode_activity,
    "hci-diff": _mode_hci_diff,
    "hci_diff": _mode_hci_diff,
    "hci-by-subtag": _mode_hci_by_subtag,
    "hci_by_subtag": _mode_hci_by_subtag,
    "agent-loop": _mode_agent_loop,
    "agent_loop": _mode_agent_loop,
    "band-tuning": _mode_band_tuning,
    "band_tuning": _mode_band_tuning,
    "conjugate": _mode_conjugate,
    "multi-axis-band": _mode_multi_axis_band,
    "multi_axis_band": _mode_multi_axis_band,
    "tool-latency": _mode_tool_latency,
    "tool_latency": _mode_tool_latency,
    "staleness": lambda: _staleness_report(),
    "coherence": lambda: _coherence_report(),
    "blindspots": _mode_blindspots,
    "hypotheses": _mode_hypotheses,
    "drift": _mode_drift,
    "accuracy": _mode_accuracy,
    "crystallized": _mode_crystallized,
    "music_truth": _mode_music_truth,
    "kb_trust": _mode_kb_trust,
    "intention_gap": _mode_intention_gap,
    "self_audit": _mode_self_audit,
    "probes": _mode_probes,
    "trajectory": lambda: _trajectory_report(),
    "budget": lambda: _budget_report(),
    "negative_space": _mode_negative_space,
    "cognitive_load": _mode_cognitive_load,
    "ground_truth": _mode_ground_truth,
    "constitution": _mode_constitution,
    "doc_drift": _mode_doc_drift,
    "generalizations": _mode_generalizations,
    # `priorities` and `next` are intentional aliases -- the underlying signal
    "priorities": lambda: _evolution_priority_report(),
    "next": lambda: _evolution_priority_report(),
    "reflexivity": _mode_reflexivity,
    "multi_agent": _mode_multi_agent,
    "freshness": lambda: _freshness_report(),
    "vram": lambda: _vram_report(),
    "introspect": _mode_introspect,
    "signals": _mode_signals,
    # Exploratory-edit signal: modules you edited this round that lack KB
    # coverage -- `learn()` candidates that the old loop never surfaced.
    "learn_suggestions": _mode_learn_suggestions,
    "novel_modules": _mode_learn_suggestions,   # alias
    # Local-vs-cloud race outcomes from _reasoning_think's race-mode path.
    "race_stats": _mode_race_stats,
}
