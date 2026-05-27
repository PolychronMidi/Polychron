"""Repo-mermaid freshness invariant.

The main README.md carries an auto-generated mermaid block between
BEGIN_REPO_MERMAID / END_REPO_MERMAID markers. This verifier re-runs
the generator in-memory and compares against the committed block. Drift
between the tracked tree's actual dir_intent state and the README's
diagram surfaces as WARN -- the fix is one command:

  python3 tools/HME/scripts/generate-repo-mermaid.py
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

from ._base import (
    Verifier,
    _PROJECT,
    failed,
    passed,
    register,
    skipped,
    warned,
)

GENERATOR_REL = "tools/HME/scripts/generate-repo-mermaid.py"
README_REL = "README.md"


def _load_generator(root: Path):
    path = root / GENERATOR_REL
    spec = importlib.util.spec_from_file_location("_repo_mermaid_gen", path)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _extract_block(text: str, begin: str, end: str) -> str | None:
    if begin not in text or end not in text:
        return None
    start = text.index(begin)
    finish = text.index(end, start) + len(end)
    return text[start:finish]


@register
class RepoMermaidFreshnessVerifier(Verifier):
    """README.md's mermaid block must match the current tracked tree."""

    name = "repo-mermaid-freshness"
    category = "doc"
    subtag = "drift-detection"
    weight = 1.0

    def run(self):
        root = Path(_PROJECT)
        readme = root / README_REL
        gen_path = root / GENERATOR_REL
        if not readme.is_file():
            return skipped(summary=f"no {README_REL}")
        if not gen_path.is_file():
            return skipped(summary=f"no generator at {GENERATOR_REL}")
        try:
            gen = _load_generator(root)
        except Exception as e:
            return failed(summary=f"generator import failed -- {type(e).__name__}: {e}")
        if gen is None:
            return failed(summary="generator module could not be loaded")

        try:
            fresh_block = gen.render_section(root)
        except Exception as e:
            return failed(summary=f"generator run failed -- {type(e).__name__}: {e}")

        text = readme.read_text(encoding="utf-8")
        committed = _extract_block(text, gen.BEGIN, gen.END)
        if committed is None:
            return warned(
                summary=f"{README_REL} is missing the auto-generated block markers",
                details=[
                    "expected BEGIN_REPO_MERMAID / END_REPO_MERMAID anchors",
                    f"regenerate: python3 {GENERATOR_REL}",
                ],
            )

        if committed.strip() == fresh_block.strip():
            return passed(summary="repo mermaid block matches tracked tree")
        return warned(
            summary="repo mermaid block is stale vs. the current tree",
            details=[f"regenerate: python3 {GENERATOR_REL}"],
        )
