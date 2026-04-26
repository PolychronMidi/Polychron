from __future__ import annotations
import json
import logging
import os
from pathlib import Path
from typing import Iterator, Optional

from hme_env import ENV
from lang_registry import SUPPORTED_EXTENSIONS, SUPPORTED_FILENAMES, ext_to_lang

logger = logging.getLogger(__name__)

# Baseline fallback — used only when HME_IGNORE_DIRS env var is absent.
# "doc" and "hooks" intentionally NOT here — HME indexes its own enforcement
# hooks (tools/HME/hooks/) and project docs (doc/) for full self-awareness.
_BUILTIN_IGNORE_DIRS = {
    "node_modules", ".git", "target", "dist", "build",
    "__pycache__", ".cache", "pkg", "wasm-pack-out",
    ".claude", "venv", ".venv", "env", ".env",
    "runtime", ".idea", ".vscode", ".next",
    "coverage", ".nyc_output", ".turbo",
    ".github", "metrics", "output", "tmp", "lab",
}


def _dirs_from_env() -> set[str]:
    """Parse HME_IGNORE_DIRS env var (comma-separated). Returns empty set if unset."""
    raw = os.environ.get("HME_IGNORE_DIRS", "")
    return {d.strip() for d in raw.split(",") if d.strip()} if raw.strip() else set()


def _dirs_from_gitignore(project_root: str) -> set[str]:
    """Extract bare directory names from .gitignore (no path separators, no wildcards)."""
    gi_path = os.path.join(project_root, ".gitignore")
    dirs: set[str] = set()
    try:
        with open(gi_path, encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                # Strip leading slash (root-anchored) and trailing slash (dir marker)
                name = line.lstrip("/").rstrip("/")
                # Skip: wildcards, path separators, file extensions, negations
                if any(c in name for c in ("*", "?", "[", "/", ".")):
                    continue
                if name.startswith("!"):
                    continue
                dirs.add(name)
    except OSError:  # silent-ok: .gitignore absent or unreadable; _BUILTIN_IGNORE_DIRS is the fallback baseline
        pass
    return dirs


def _build_ignore_dirs(project_root: str = "") -> set[str]:
    env_dirs = _dirs_from_env()
    base = env_dirs if env_dirs else _BUILTIN_IGNORE_DIRS
    gitignore_dirs = _dirs_from_gitignore(project_root) if project_root else set()
    return base | gitignore_dirs


# Module-level default (no project_root yet — gitignore dirs added in init_config).
DEFAULT_IGNORE_DIRS = _build_ignore_dirs()

_BUILTIN_IGNORE_FILES = {
    "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
    "Cargo.lock", "poetry.lock", "composer.lock",
}


def _files_from_env() -> set[str]:
    raw = os.environ.get("HME_IGNORE_FILES", "")
    return {f.strip() for f in raw.split(",") if f.strip()} if raw.strip() else set()


IGNORE_FILES = _files_from_env() or _BUILTIN_IGNORE_FILES

_BUILTIN_MAX_FILE_SIZE_KB = 256


def _max_file_size_from_env() -> int:
    # ENV.optional_int raises on garbage so a typo in .env surfaces immediately
    # instead of silently using the default.
    return ENV.optional_int("HME_RAG_MAX_FILE_SIZE_KB", _BUILTIN_MAX_FILE_SIZE_KB) * 1024


_config: dict = {
    "ignore_dirs": set(DEFAULT_IGNORE_DIRS),
    "rag_ignore": None,
    "rag_libs": [],
    "rag_lib_abs": [],
    "rag_index_dirs": [],      # explicit allowlist — ONLY these dirs get indexed
    "rag_index_dirs_abs": [],  # resolved absolute paths
    "max_file_size": _max_file_size_from_env(),
    "project_root": "",
}


def init_config(project_root: str):
    _config["project_root"] = project_root
    # Rebuild ignore_dirs now that we have project_root for .gitignore parsing.
    _config["ignore_dirs"] = _build_ignore_dirs(project_root)
    logger.info(f"ignore_dirs: {len(_config['ignore_dirs'])} entries (env+gitignore merged)")
    # RAG config migrated from .mcp.json → tools/HME/config/rag.json (owned by HME,
    # independent of Claude Code's MCP system). Schema is flat (no mcpServers.HME
    # wrapper): ragIndexDirs, ragIgnoreDirs, ragIgnore, ragLibs, ragMaxFileSize.
    rag_path = os.path.join(project_root, "tools", "HME", "config", "rag.json")
    if not os.path.isfile(rag_path):
        logger.info("No tools/HME/config/rag.json found, using defaults")
        return

    try:
        with open(rag_path, "r", encoding="utf-8") as f:
            rag_cfg = json.load(f)
    except Exception as e:
        logger.warning(f"Failed to read tools/HME/config/rag.json: {e}")
        return

    patterns = rag_cfg.get("ragIgnore")
    if patterns and isinstance(patterns, list):
        try:
            import pathspec
            _config["rag_ignore"] = pathspec.PathSpec.from_lines("gitwildmatch", patterns)
            logger.info(f"ragIgnore loaded: {len(patterns)} patterns")
        except ImportError:
            logger.warning("pathspec not installed, ragIgnore disabled")
        except Exception as e:
            logger.warning(f"ragIgnore parse error: {e}")

    libs = rag_cfg.get("ragLibs")
    if libs and isinstance(libs, list):
        _config["rag_libs"] = libs
        _config["rag_lib_abs"] = [
            os.path.normpath(os.path.join(project_root, lib)) for lib in libs
        ]
        logger.info(f"ragLibs loaded: {libs}")

    # ragIndexDirs: explicit allowlist of directories to index (relative to project root).
    # When set, ONLY these directories are indexed — no directory argument can override this.
    index_dirs = rag_cfg.get("ragIndexDirs")
    if index_dirs and isinstance(index_dirs, list):
        _config["rag_index_dirs"] = index_dirs
        _config["rag_index_dirs_abs"] = [
            os.path.normpath(os.path.join(project_root, d)) for d in index_dirs
        ]
        logger.info(f"ragIndexDirs loaded: {index_dirs} — ONLY these directories will be indexed")


def get_ignore_dirs() -> set[str]:
    return _config["ignore_dirs"]


def get_max_file_size() -> int:
    return _config["max_file_size"]


def get_lib_dirs() -> list[str]:
    return list(_config["rag_libs"])


def get_lib_abs_paths() -> list[str]:
    return list(_config["rag_lib_abs"])


def get_index_dirs() -> list[str]:
    """Return the explicit index allowlist. Empty = index everything (legacy)."""
    return list(_config["rag_index_dirs"])


def get_index_dirs_abs() -> list[str]:
    """Resolved absolute paths of ragIndexDirs."""
    return list(_config["rag_index_dirs_abs"])


def get_project_root() -> str:
    return _config["project_root"]


def walk_code_files(
    extensions: Optional[set[str]] = None,
    lang_filter: str = "",
    max_size: Optional[int] = None,
    exclude_libs: bool = True,
) -> Iterator[Path]:
    exts = extensions if extensions is not None else SUPPORTED_EXTENSIONS
    fnames = SUPPORTED_FILENAMES
    size_limit = max_size if max_size is not None else _config["max_file_size"]
    ignore_dirs = _config["ignore_dirs"]
    rag_ignore = _config["rag_ignore"]

    # When ragIndexDirs is configured, use it as a strict allowlist.
    # Otherwise walk PROJECT_ROOT and rely on .gitignore + ragIgnore +
    # HME_IGNORE_DIRS basename excludes for filtering.
    roots: list[Path] = []
    if _config["rag_index_dirs_abs"]:
        for d in _config["rag_index_dirs_abs"]:
            p = Path(d)
            if p.is_dir():
                roots.append(p)
        if not roots:
            logger.warning("ragIndexDirs configured but no valid directories found — indexing nothing")
            return
    else:
        project_root = _config.get("project_root")
        if not project_root:
            logger.error("project_root not initialized — call init_config() before walking")
            return
        roots.append(Path(project_root))

    for root in roots:
      for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ignore_dirs]

        if exclude_libs and _config["rag_lib_abs"]:
            abs_dir = os.path.normpath(dirpath)
            dirnames[:] = [
                d for d in dirnames
                if not any(
                    os.path.normpath(os.path.join(abs_dir, d)).startswith(lib_abs)
                    or os.path.normpath(os.path.join(abs_dir, d)) == lib_abs
                    for lib_abs in _config["rag_lib_abs"]
                )
            ]

        for fname in filenames:
            if fname in IGNORE_FILES:
                continue
            fpath = Path(dirpath) / fname
            suffix = fpath.suffix

            if suffix in exts:
                pass
            elif fname in fnames:
                pass
            else:
                continue

            if lang_filter:
                lang = ext_to_lang(fname if not suffix else suffix)
                if lang != lang_filter:
                    continue

            if size_limit > 0:
                try:
                    if fpath.stat().st_size > size_limit:
                        continue
                except OSError:
                    continue

            if rag_ignore:
                try:
                    rel = fpath.relative_to(root).as_posix()
                    if rag_ignore.match_file(rel):
                        continue
                except ValueError:  # silent-ok: path outside root; rag_ignore only filters paths within root
                    pass

            yield fpath
