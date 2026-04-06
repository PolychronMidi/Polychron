from __future__ import annotations
import json
import logging
import os
from pathlib import Path
from typing import Iterator, Optional

from lang_registry import SUPPORTED_EXTENSIONS, SUPPORTED_FILENAMES, ext_to_lang

logger = logging.getLogger(__name__)

DEFAULT_IGNORE_DIRS = {
    "node_modules", ".git", "target", "dist", "build",
    "__pycache__", ".cache", "pkg", "wasm-pack-out",
    ".claude", "venv", ".venv", "env", ".env",
    "runtime", ".idea", ".vscode", ".next",
    "coverage", ".nyc_output", ".turbo",
    ".github", "metrics", "output", "tmp", "lab",
    "doc", "hooks",
}

IGNORE_FILES = {
    "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
    "Cargo.lock", "poetry.lock", "composer.lock",
}

DEFAULT_MAX_FILE_SIZE = 256 * 1024

_config: dict = {
    "ignore_dirs": set(DEFAULT_IGNORE_DIRS),
    "rag_ignore": None,
    "rag_libs": [],
    "rag_lib_abs": [],
    "max_file_size": DEFAULT_MAX_FILE_SIZE,
    "project_root": "",
}


def init_config(project_root: str):
    _config["project_root"] = project_root
    mcp_path = os.path.join(project_root, ".mcp.json")
    if not os.path.isfile(mcp_path):
        logger.info("No .mcp.json found, using defaults")
        return

    try:
        with open(mcp_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        logger.warning(f"Failed to read .mcp.json: {e}")
        return

    rag_cfg = data.get("mcpServers", {}).get("HME", {})

    dirs = rag_cfg.get("ragIgnoreDirs")
    if dirs and isinstance(dirs, list):
        # Merge with defaults rather than replace — losing 'node_modules'/'.git'/etc
        # would cause the server to index vendor dependencies
        _config["ignore_dirs"] = set(DEFAULT_IGNORE_DIRS) | set(dirs)
        logger.info(f"ragIgnoreDirs loaded: {len(dirs)} entries (merged with {len(DEFAULT_IGNORE_DIRS)} defaults)")

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

    max_kb = rag_cfg.get("ragMaxFileSize")
    if max_kb and isinstance(max_kb, (int, float)):
        _config["max_file_size"] = int(max_kb) * 1024
        logger.info(f"ragMaxFileSize: {max_kb} KB")


def get_ignore_dirs() -> set[str]:
    return _config["ignore_dirs"]


def get_max_file_size() -> int:
    return _config["max_file_size"]


def get_lib_dirs() -> list[str]:
    return list(_config["rag_libs"])


def get_lib_abs_paths() -> list[str]:
    return list(_config["rag_lib_abs"])


def get_project_root() -> str:
    return _config["project_root"]


def walk_code_files(
    directory: str,
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
    root = Path(directory)

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
                except ValueError:
                    pass

            yield fpath
