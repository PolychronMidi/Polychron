from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3]).resolve()


def _under_root(value: str | None, fallback: Path) -> Path:
    if not value:
        return fallback
    candidate = Path(value).expanduser().resolve()
    try:
        candidate.relative_to(PROJECT_ROOT)
        return candidate
    except ValueError:
        return fallback


HME_RUNTIME_DIR = _under_root(
    os.environ.get("HME_RUNTIME_DIR"), PROJECT_ROOT / "tools" / "HME" / "runtime"
)
HME_METRICS_DIR = _under_root(os.environ.get("HME_METRICS_DIR"), HME_RUNTIME_DIR / "metrics")
HME_STATE_DIR = _under_root(os.environ.get("HME_STATE_DIR"), HME_RUNTIME_DIR / "state")
COMPOSITION_OUTPUT_DIR = _under_root(
    os.environ.get("COMPOSITION_OUTPUT_DIR"), PROJECT_ROOT / "src" / "output"
)
COMPOSITION_METRICS_DIR = _under_root(
    os.environ.get("COMPOSITION_METRICS_DIR") or os.environ.get("METRICS_DIR"),
    COMPOSITION_OUTPUT_DIR / "metrics",
)

PROJECT_METRIC_NAMES = {
    "adaptive-state.json",
    "composition-diff.json",
    "composition-diff.md",
    "current-run.json",
    "feedback_graph.json",
    "fingerprint-comparison.json",
    "golden-fingerprint.json",
    "golden-fingerprint.prev.json",
    "hci-snapshot-diff.json",
    "hci-verifier-snapshot.json",
    "journal.md",
    "l0-dump.json",
    "narrative-digest.md",
    "perceptual-report.json",
    "pipeline-summary.json",
    "run-comparison.json",
    "runtime-snapshots.json",
    "system-manifest.json",
    "trace-summary.json",
    "trace.jsonl",
    "verdict-model.json",
}

HME_METRIC_NAMES = {
    "detector-stats.jsonl",
    "hci-regression-alert.json",
    "kb-signatures.json",
    "kb-staleness.json",
    "kb-trust-weights.json",
    "legacy-override-history.jsonl",
    "mode-classifier.jsonl",
    "reflections.jsonl",
    "satisfaction.jsonl",
    "todo-graph.md",
    "vram-history.jsonl",
}


def _name(parts: tuple[str, ...]) -> str:
    return str(parts[0]) if parts else ""


def is_hme_metric_name(*parts: str) -> bool:
    name = _name(parts)
    if not name or name in PROJECT_METRIC_NAMES or name == "run-history":
        return False
    return name.startswith("hme-") or name in HME_METRIC_NAMES


def hme_metric(*parts: str) -> Path:
    return HME_METRICS_DIR.joinpath(*parts)


def hme_state(*parts: str) -> Path:
    return HME_STATE_DIR.joinpath(*parts)


def project_metric(*parts: str) -> Path:
    return COMPOSITION_METRICS_DIR.joinpath(*parts)


def metric_path(*parts: str) -> Path:
    return hme_metric(*parts) if is_hme_metric_name(*parts) else project_metric(*parts)


def read_hme_metric(*parts: str) -> Path:
    primary = hme_metric(*parts)
    return primary if primary.exists() else project_metric(*parts)


def read_metric_path(*parts: str) -> Path:
    return read_hme_metric(*parts) if is_hme_metric_name(*parts) else project_metric(*parts)


def write_hme_metric(*parts: str) -> Path:
    return hme_metric(*parts)


def write_project_metric(*parts: str) -> Path:
    return project_metric(*parts)


def write_metric_path(*parts: str) -> Path:
    return metric_path(*parts)
