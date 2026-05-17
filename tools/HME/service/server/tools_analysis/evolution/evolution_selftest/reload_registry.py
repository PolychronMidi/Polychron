"""Canonical hot-reload target registry."""
from __future__ import annotations

from pathlib import Path

RELOADABLE = [
    "synthesis_config", "synthesis_llamacpp", "synthesis_gemini",
    "synthesis_groq", "synthesis_openrouter", "synthesis_cerebras",
    "synthesis_mistral", "synthesis_nvidia", "synthesis_reasoning",
    "synthesis_session", "synthesis_warm", "synthesis_pipeline", "synthesis_proxy_route",
    "synthesis_inference", "synthesis_cascade", "synthesis_provider_base",
    "request_coordinator",
    "warm_disk", "warm_persona",
    "tool_cache",
    "symbols", "workflow", "workflow_audit",
    "reasoning", "reasoning_think",
    "health",
    "evolution_next", "evolution_suggest",
    "evolution_trace", "evolution_strategies",
    "evolution_admin", "evolution_introspect", "evolution_selftest",
    "index_jobs", "todo_admin",
    "runtime", "composition", "trust_analysis",
    "digest", "digest_analysis",
    "section_compare", "perceptual", "perceptual_engines",
    "coupling_channels", "coupling_data", "coupling_clusters", "coupling_bridges",
    "drama_map", "health_analysis", "section_labels",
    "evolution_evolve", "evolution_invariants", "search_unified", "review_unified",
    "read_unified", "learn_unified", "status_unified", "trace_unified",
    "agent_unified",
    "todo_store", "todo_state_guard", "todo_sources", "todo_md_sync", "todo_archive",
    "todo_markdown_ingest", "todo_close", "todo_lifesaver", "todo_native_merge", "todo",
    "enrich_prompt", "tools_passthru", "activity_digest", "blindspots",
    "cascade_analysis", "hypothesis_registry", "prediction_accuracy",
    "semantic_drift_report", "crystallizer", "self_audit", "probe",
    "epistemic_reports", "negative_space", "cognitive_load", "ground_truth",
    "phase6_reports", "multi_agent",
    "digest_pipeline_status", "perceptual_inference", "reasoning_blast",
    "review_unified_recommender", "symbols_hierarchy",
    "workflow_audit_bugs", "workflow_audit_diagnose", "workflow_before_editing",
]
SERVER_RELOADABLE = ["onboarding_chain"]
TOP_LEVEL_RELOADABLE = ["tools_search", "tools_knowledge", "meta_layers", "meta_observer"]
ROOT_FIRST_RELOADABLE = ["paths"]
ROOT_RELOADABLE = ["file_walker", "lang_registry", "chunker", "structure"]
SUBPACKAGES = ("synthesis", "evolution", "coupling")


def all_reload_targets() -> list[str]:
    return ROOT_FIRST_RELOADABLE + RELOADABLE + SERVER_RELOADABLE + TOP_LEVEL_RELOADABLE + ROOT_RELOADABLE


def module_candidates(name: str) -> list[str]:
    if name in ROOT_FIRST_RELOADABLE or name in ROOT_RELOADABLE:
        return [name]
    if name in TOP_LEVEL_RELOADABLE or name in SERVER_RELOADABLE:
        return [f"server.{name}"]
    return [f"server.tools_analysis.{name}"] + [
        f"server.tools_analysis.{subpkg}.{name}" for subpkg in SUBPACKAGES
    ]


def candidate_files(project_root: str | Path, name: str) -> list[Path]:
    service = Path(project_root) / "tools" / "HME" / "service"
    files: list[Path] = []
    for mod in module_candidates(name):
        rel = Path(*mod.split("."))
        if mod.startswith("server."):
            rel = Path(*mod.split("."))
        files.append(service / f"{rel}.py")
        files.append(service / rel / "__init__.py")
    return files
