"""Forbidden API-key identifier invariant.

Locks in the deletion of the ANTHROPIC_API_KEY and OPENAI_API_KEY
consumption paths. Any tracked source / script / doc that references
either identifier (case-insensitive) is a regression: route Claude
via OmniRoute OAuth, and route OpenAI-compatible providers via their
project-specific keys (OPENCODE_API_KEY, GROQ_API_KEY, etc.) -- never
the generic vendor-named keys.

The forbidden tokens are assembled at module load via string concat
so this verifier's own source does not match its own pattern; the
self-exemption is the path of the file plus the matching unit test.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from ._base import (
    FAIL,
    PASS,
    VerdictResult,
    Verifier,
    _PROJECT,
    _result,
    passed,
    register,
)

_FORBIDDEN = (
    "anth" + "ropic_api_key",
    "open" + "ai_api_key",
)
_PATTERN = re.compile("|".join(_FORBIDDEN), re.IGNORECASE)

# Self-exempt: this module + its dedicated test must mention the
# tokens to detect them. Everything else is a regression.
_SELF_EXEMPT_RELS = {
    "tools/HME/scripts/verify_coherence/forbidden_api_keys.py",
    "tools/HME/tests/specs/forbidden_api_keys.test.py",
}


def _list_tracked_files(root: Path) -> list[Path]:
    """Use git to enumerate tracked + non-ignored files; fall back to walk."""
    try:
        rc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--cached", "--others",
             "--exclude-standard"],
            capture_output=True, text=True, timeout=30, check=True,
        )
        return [Path(line) for line in rc.stdout.splitlines() if line.strip()]
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            FileNotFoundError, OSError):
        files: list[Path] = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in filenames:
                try:
                    rel = (Path(dirpath) / fn).relative_to(root)
                except ValueError:
                    continue
                files.append(rel)
        return files


def _scannable(rel: Path) -> bool:
    rel_str = str(rel).replace(os.sep, "/")
    if rel_str in _SELF_EXEMPT_RELS:
        return False
    skip_exts = {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".wav", ".mp3", ".ogg",
        ".mid", ".gguf", ".safetensors", ".bin", ".pt", ".pth", ".ckpt",
        ".h5", ".onnx", ".tflite", ".pb", ".gz", ".tar", ".zip", ".xz",
        ".zst", ".bz2", ".lance",
    }
    if rel.suffix.lower() in skip_exts:
        return False
    return True


@register
class ForbiddenApiKeysVerifier(Verifier):
    """Fail if either forbidden API-key identifier appears in tracked content."""

    name = "forbidden-api-keys"
    category = "security"
    subtag = "regression-prevention"
    weight = 2.0

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        hits: list[str] = []
        for rel in _list_tracked_files(root):
            if not _scannable(rel):
                continue
            abs_path = root / rel
            try:
                text = abs_path.read_text(encoding="utf-8", errors="ignore")
            except (OSError, UnicodeError):
                continue
            for m in _PATTERN.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                rel_str = str(rel).replace(os.sep, "/")
                hits.append(f"{rel_str}:{line_no} -- {m.group(0)}")
                if len(hits) >= 30:
                    break
            if len(hits) >= 30:
                break

        if not hits:
            return passed(score=1.0, summary="no forbidden API-key identifiers in tracked content")
        score = max(0.0, 1.0 - len(hits) / 5.0)
        return _result(
            FAIL, score,
            f"{len(hits)} forbidden API-key reference(s) -- regression of "
            "ANTHROPIC/OPENAI key consumption",
            hits[:30],
        )
