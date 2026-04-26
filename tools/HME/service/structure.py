import os
import logging
from pathlib import Path
from collections import defaultdict

from symbols import extract_symbols
from lang_registry import ext_to_lang, SUPPORTED_EXTENSIONS, SUPPORTED_FILENAMES
from file_walker import walk_code_files, get_ignore_dirs

logger = logging.getLogger(__name__)


def file_summary(file_path: str) -> dict:
    fpath = Path(file_path)
    if not fpath.exists():
        return {"error": f"File not found: {file_path}"}

    try:
        content = fpath.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        return {"error": str(e)}

    line_count = content.count("\n") + 1
    symbols = extract_symbols(file_path, content)

    by_kind = defaultdict(list)
    for s in symbols:
        by_kind[s["kind"]].append(s)

    exports = []
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("export ") or stripped.startswith("pub "):
            exports.append(stripped[:120])
        if len(exports) >= 30:
            break

    return {
        "file": file_path,
        "lines": line_count,
        "symbols": symbols,
        "by_kind": {k: len(v) for k, v in by_kind.items()},
        "exports_preview": exports[:20],
    }


def module_map(directory: str, max_depth: int = 3) -> dict:
    root = Path(directory)
    if not root.is_dir():
        return {"error": f"Not a directory: {directory}"}

    ignore_dirs = get_ignore_dirs()
    tree = {}

    def _scan(current: Path, depth: int, node: dict):
        if depth > max_depth:
            return

        try:
            entries = sorted(current.iterdir())
        except PermissionError:
            return

        dirs = []
        files = []

        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                if entry.name not in ignore_dirs:
                    dirs.append(entry)
            elif entry.is_file() and (entry.suffix in SUPPORTED_EXTENSIONS or entry.name in SUPPORTED_FILENAMES):
                files.append(entry)

        for f in files:
            syms = extract_symbols(str(f))
            kind_counts = defaultdict(int)
            for s in syms:
                kind_counts[s["kind"]] += 1

            try:
                line_count = f.read_text(encoding="utf-8", errors="ignore").count("\n") + 1
            except Exception:
                line_count = 0
            node[f.name] = {
                "_type": "file",
                "_lines": line_count,
                "_symbols": dict(kind_counts),
                "_key_symbols": [s["name"] for s in syms if s["kind"] in ("class", "struct", "trait", "interface", "enum")][:5],
            }

        for d in dirs:
            child = {}
            _scan(d, depth + 1, child)
            if child:
                code_files = sum(1 for v in child.values() if isinstance(v, dict) and v.get("_type") == "file")
                sub_dirs = sum(1 for v in child.values() if isinstance(v, dict) and v.get("_type") != "file")
                child["_type"] = "dir"
                child["_files"] = code_files
                child["_subdirs"] = sub_dirs
                node[d.name] = child

    _scan(root, 0, tree)
    return tree


def format_module_map(tree: dict, prefix: str = "", max_lines: int = 200) -> str:
    lines = []

    def _fmt(node: dict, indent: str, remaining: list):
        if remaining[0] <= 0:
            return

        items = sorted(node.items())
        dirs_items = [(k, v) for k, v in items if isinstance(v, dict) and v.get("_type") != "file" and not k.startswith("_")]
        file_items = [(k, v) for k, v in items if isinstance(v, dict) and v.get("_type") == "file"]

        for name, info in dirs_items:
            if remaining[0] <= 0:
                break
            fc = info.get("_files", 0)
            sd = info.get("_subdirs", 0)
            lines.append(f"{indent}{name}/ ({fc} files, {sd} dirs)")
            remaining[0] -= 1
            _fmt(info, indent + "  ", remaining)

        for name, info in file_items:
            if remaining[0] <= 0:
                break
            lc = info.get("_lines", 0)
            syms = info.get("_symbols", {})
            key = info.get("_key_symbols", [])

            sym_str = ", ".join(f"{v}{k[0]}" for k, v in syms.items() if v > 0)
            key_str = f" [{', '.join(key)}]" if key else ""
            lines.append(f"{indent}{name} ({lc}L, {sym_str}){key_str}")
            remaining[0] -= 1

    _fmt(tree, prefix, [max_lines])
    return "\n".join(lines)


def directory_summary(directory: str) -> dict:
    root = Path(directory)
    if not root.is_dir():
        return {"error": f"Not a directory: {directory}"}

    lang_stats = defaultdict(lambda: {"files": 0, "lines": 0, "symbols": 0})
    total_files = 0
    total_lines = 0

    for fpath in walk_code_files():
        total_files += 1
        lang = ext_to_lang(fpath.suffix if fpath.suffix else fpath.name)
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            lc = content.count("\n") + 1
            total_lines += lc
            lang_stats[lang]["files"] += 1
            lang_stats[lang]["lines"] += lc
            syms = extract_symbols(str(fpath), content)
            lang_stats[lang]["symbols"] += len(syms)
        except Exception:
            continue

    return {
        "directory": directory,
        "total_files": total_files,
        "total_lines": total_lines,
        "languages": dict(lang_stats),
    }

