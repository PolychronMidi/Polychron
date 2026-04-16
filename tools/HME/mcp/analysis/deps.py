import os
import re
import logging
from pathlib import Path
from typing import Optional

from lang_registry import ext_to_lang
from file_walker import walk_code_files

logger = logging.getLogger(__name__)

IMPORT_PATTERNS = {
    "typescript": [
        re.compile(r'''(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]'''),
        re.compile(r'''(?:import|export)\s*\(\s*['"]([^'"]+)['"]\s*\)'''),
        re.compile(r'''require\s*\(\s*['"]([^'"]+)['"]\s*\)'''),
    ],
    "javascript": [
        re.compile(r'''(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]'''),
        re.compile(r'''require\s*\(\s*['"]([^'"]+)['"]\s*\)'''),
    ],
    "rust": [
        re.compile(r'''use\s+((?:crate|super|self)(?:::\w+)+)'''),
        re.compile(r'''mod\s+(\w+)\s*;'''),
    ],
    "python": [
        re.compile(r'''^\s*(?:from\s+(\S+)\s+)?import\s+(\S+)''', re.MULTILINE),
    ],
    "vue": [
        re.compile(r'''(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]'''),
    ],
    "java": [
        re.compile(r'''^\s*import\s+(?:static\s+)?([\w.]+)\s*;''', re.MULTILINE),
    ],
    "kotlin": [
        re.compile(r'''^\s*import\s+([\w.]+)''', re.MULTILINE),
    ],
    "scala": [
        re.compile(r'''^\s*import\s+([\w.{},\s]+)''', re.MULTILINE),
    ],
    "go": [
        re.compile(r'''^\s*import\s+"([^"]+)"''', re.MULTILINE),
        re.compile(r'''^\s*"([^"]+)"''', re.MULTILINE),
    ],
    "ruby": [
        re.compile(r'''^\s*require\s+['"]([^'"]+)['"]''', re.MULTILINE),
        re.compile(r'''^\s*require_relative\s+['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "c": [
        re.compile(r'''^\s*#include\s*[<"]([^>"]+)[>"]''', re.MULTILINE),
    ],
    "cpp": [
        re.compile(r'''^\s*#include\s*[<"]([^>"]+)[>"]''', re.MULTILINE),
    ],
    "csharp": [
        re.compile(r'''^\s*using\s+([\w.]+)\s*;''', re.MULTILINE),
    ],
    "php": [
        re.compile(r'''^\s*use\s+([\w\\]+)\s*;''', re.MULTILINE),
        re.compile(r'''^\s*(?:require|include)(?:_once)?\s+['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "dart": [
        re.compile(r'''^\s*import\s+['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "swift": [
        re.compile(r'''^\s*import\s+(\w+)''', re.MULTILINE),
    ],
    "elixir": [
        re.compile(r'''^\s*(?:import|alias|use|require)\s+([\w.]+)''', re.MULTILINE),
    ],
    "haskell": [
        re.compile(r'''^\s*import\s+(?:qualified\s+)?([\w.]+)''', re.MULTILINE),
    ],
    "ocaml": [
        re.compile(r'''^\s*open\s+(\w+)''', re.MULTILINE),
    ],
    "erlang": [
        re.compile(r'''^\s*-include\(\s*"([^"]+)"\s*\)''', re.MULTILINE),
    ],
    "julia": [
        re.compile(r'''^\s*(?:using|import)\s+([\w.]+)''', re.MULTILINE),
    ],
    "perl": [
        re.compile(r'''^\s*use\s+([\w:]+)''', re.MULTILINE),
        re.compile(r'''^\s*require\s+['"]?([^'"\s;]+)''', re.MULTILINE),
    ],
    "lua": [
        re.compile(r'''^\s*(?:local\s+\w+\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "zig": [
        re.compile(r'''@import\s*\(\s*"([^"]+)"\s*\)'''),
    ],
    "nim": [
        re.compile(r'''^\s*import\s+([\w/]+)''', re.MULTILINE),
        re.compile(r'''^\s*from\s+([\w/]+)\s+import''', re.MULTILINE),
    ],
    "proto": [
        re.compile(r'''^\s*import\s+"([^"]+)"''', re.MULTILINE),
    ],
}


def _resolve_import(import_path: str, source_file: Path, project_root: str, lang: str) -> Optional[str]:
    root = Path(project_root)

    if lang in ("typescript", "javascript", "vue"):
        if import_path.startswith("."):
            base = source_file.parent / import_path
            for suffix in [".ts", ".tsx", ".js", ".jsx", ".vue", "/index.ts", "/index.js"]:
                candidate = base.parent / (base.name + suffix)
                if candidate.exists():
                    return str(candidate)
            if base.is_dir():
                for idx in ["index.ts", "index.js", "index.tsx"]:
                    candidate = base / idx
                    if candidate.exists():
                        return str(candidate)
        return None

    if lang == "rust":
        parts = import_path.split("::")
        if parts[0] == "crate":
            parts = parts[1:]
        elif parts[0] in ("super", "self"):
            return None
        src_dir = None
        for p in source_file.parents:
            if (p / "Cargo.toml").exists():
                src_dir = p / "src"
                break
        if src_dir:
            mod_path = src_dir
            for part in parts[:2]:
                candidate_file = mod_path / f"{part}.rs"
                candidate_dir = mod_path / part
                if candidate_file.exists():
                    return str(candidate_file)
                elif candidate_dir.is_dir():
                    mod_path = candidate_dir
                    if (mod_path / "mod.rs").exists():
                        return str(mod_path / "mod.rs")
        return None

    if lang == "python":
        if import_path and not import_path.startswith("."):
            parts = import_path.split(".")
            candidate = root
            for part in parts:
                candidate = candidate / part
            for suffix in [".py", "/__init__.py"]:
                check = Path(str(candidate) + suffix)
                if check.exists():
                    return str(check)
        return None

    if lang in ("c", "cpp"):
        if not import_path.startswith("/"):
            candidate = source_file.parent / import_path
            if candidate.exists():
                return str(candidate)
        return None

    if lang == "go":
        return None

    if lang == "ruby":
        if import_path and not import_path.startswith("/"):
            candidate = source_file.parent / (import_path + ".rb")
            if candidate.exists():
                return str(candidate)
        return None

    return None


def get_dependency_graph(file_path: str, project_root: str) -> dict:
    target = Path(file_path)
    if not target.exists():
        return {"error": f"File not found: {file_path}"}

    lang = ext_to_lang(target.suffix if target.suffix else target.name)
    if not lang or lang == "text":
        return {"error": f"Unsupported language: {target.suffix}"}

    imports_from = []
    try:
        content = target.read_text(encoding="utf-8", errors="ignore")
        patterns = IMPORT_PATTERNS.get(lang, [])
        for pat in patterns:
            for match in pat.finditer(content):
                raw = match.group(1) or (match.group(2) if match.lastindex >= 2 else None)
                if raw:
                    resolved = _resolve_import(raw, target, project_root, lang)
                    imports_from.append({"raw": raw, "resolved": resolved})
    except Exception as e:
        logger.error(f"Failed to parse imports: {e}")

    imported_by = []
    target_str = str(target)
    for f in walk_code_files():
        if f == target:
            continue
        f_lang = ext_to_lang(f.suffix if f.suffix else f.name)
        if not f_lang or f_lang == "text":
            continue
        try:
            f_content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat in IMPORT_PATTERNS.get(f_lang, []):
            for match in pat.finditer(f_content):
                raw = match.group(1) or (match.group(2) if match.lastindex >= 2 else None)
                if raw:
                    resolved = _resolve_import(raw, f, project_root, f_lang)
                    if resolved and os.path.normpath(resolved) == os.path.normpath(target_str):
                        imported_by.append(str(f))
                        break

    return {
        "file": file_path,
        "imports": imports_from,
        "imported_by": imported_by,
    }


def find_orphan_files(project_root: str) -> dict:
    files = list(walk_code_files())
    all_resolved = set()

    for f in files:
        lang = ext_to_lang(f.suffix if f.suffix else f.name)
        if not lang or lang == "text":
            continue
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat in IMPORT_PATTERNS.get(lang, []):
            for match in pat.finditer(content):
                raw = match.group(1) or (match.group(2) if match.lastindex >= 2 else None)
                if raw:
                    resolved = _resolve_import(raw, f, project_root, lang)
                    if resolved:
                        all_resolved.add(os.path.normpath(resolved))

    entry_patterns = [
        "main.ts", "main.rs", "lib.rs", "mod.rs", "index.ts", "index.js",
        "App.vue", "main.py", "__init__.py",
        "Main.java", "Application.java", "main.go", "Program.cs",
        "main.kt", "Main.kt", "main.rb", "main.lua", "main.jl",
        "Makefile", "Dockerfile",
    ]

    orphans = []
    for f in files:
        norm = os.path.normpath(str(f))
        if norm in all_resolved:
            continue
        if f.name in entry_patterns:
            continue
        orphans.append(str(f))

    return {
        "total_files": len(files),
        "orphan_count": len(orphans),
        "orphans": orphans,
    }
