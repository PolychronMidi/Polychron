"""Single source of truth for project-relative file paths.

Every module that references a doc/ template, KB devlog dir, or other
project-anchored path imports from here instead of computing the path
locally. Relocations (like the 2026-05-03 doc/ -> doc/templates/ move)
become a one-file edit instead of a sed-and-pray across N modules.

Resolution is lazy: paths are functions, not module-level constants.
Each call re-reads PROJECT_ROOT, so hot-reload + path changes take
effect without a full proxy restart. Module-level constants computed
at import time froze the OLD path even after `i/hme admin reload`,
which is why the templates/ move required a full process restart.
"""
from __future__ import annotations

import os
import sys

_mcp_root = os.path.dirname(os.path.abspath(__file__))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402


def project_root() -> str:
    return ENV.require("PROJECT_ROOT")


def doc_dir() -> str:
    return os.path.join(project_root(), "doc")


def templates_dir() -> str:
    return os.path.join(doc_dir(), "templates")


def todo_file() -> str:
    return os.path.join(templates_dir(), "TODO.md")


def todo_store_file() -> str:
    return os.path.join(project_root(), "tools", "HME", "KB", "todos.json")


def onboarding_file() -> str:
    return os.path.join(templates_dir(), "ONBOARDING.md")


def kb_devlog_dir() -> str:
    return os.path.join(project_root(), "tools", "HME", "KB", "devlog")


def todo_archive_index_file() -> str:
    return os.path.join(project_root(), "tools", "HME", "config", "todo-archive-index.json")


def errors_log() -> str:
    return os.path.join(project_root(), "log", "hme-errors.log")


def runtime_dir() -> str:
    """Durable inter-script state. NOT tmp/ -- tmp/ is genuinely throwaway."""
    return os.path.join(project_root(), "tools", "HME", "runtime")


def hme_metrics_dir() -> str:
    return ENV.optional("HME_METRICS_DIR", os.path.join(runtime_dir(), "metrics"))


def hme_metric(*parts: str) -> str:
    return os.path.join(hme_metrics_dir(), *parts)


def composition_metrics_dir() -> str:
    return ENV.optional("COMPOSITION_METRICS_DIR", ENV.require("METRICS_DIR"))


def project_metric(*parts: str) -> str:
    return os.path.join(composition_metrics_dir(), *parts)


def supervisor_abandoned_sentinel() -> str:
    return os.path.join(runtime_dir(), "supervisor-abandoned")


def fp_gate_armed_flag() -> str:
    return os.path.join(runtime_dir(), "fp-gate-armed.flag")


def stop_detector_verdicts() -> str:
    return os.path.join(runtime_dir(), "stop-detector-verdicts.env")
