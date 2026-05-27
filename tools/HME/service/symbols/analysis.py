import re
import logging
from pathlib import Path

from lang_registry import ext_to_lang
from file_walker import walk_code_files
from .patterns import TS_PATTERNS, PY_PATTERNS
from .extractor import collect_all_symbols

logger = logging.getLogger(__name__)

_IMPL_FOR_RE = re.compile(
    r'^impl(?:<[^>]*>)?\s+(\w+)\s+for\s+(\w+)', re.MULTILINE
)
_IMPL_SELF_RE = re.compile(
    r'^impl(?:<[^>]*>)?\s+(\w+)(?:<[^>]*>)?\s*\{', re.MULTILINE
)
_RUST_DEF_RE = re.compile(
    r'^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)', re.MULTILINE
)
_RUST_DEF_KIND_RE = re.compile(
    r'^(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+(\w+)', re.MULTILINE
)

_SKIP_NAMES = {
    "main", "new", "constructor", "init", "setup", "teardown",
    "default", "from", "into", "drop", "clone", "fmt",
    "eq", "ne", "partial_cmp", "cmp", "hash",
    "deref", "deref_mut", "index", "index_mut",
    "next", "size_hint", "len", "is_empty",
    "serialize", "deserialize",
}

_DEF_KW_RE = re.compile(
    r'^\s*(?:export\s+)?(?:pub(?:\([^)]*\))?\s+)?'
    r'(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?'
    r'(?:fn|function|def|class|struct|enum|trait|interface|type|macro_rules!)\s+'
)
_IMPORT_RE = re.compile(r'\b(?:import|from|use|require)\b')
_CALL_RE_TMPL = r'(?:^|[.\s:]){}(\s*(?:<[^>]*>\s*)?\()'
_TYPE_REF_CONTEXT = re.compile(r'(?::\s*$>|<\s*$|\bextends\b|\bimplements\b|\bwhere\b)')
_STRING_CHAR = {'"', "'", '`'}


# Two-tier cache: (1) a cached file-list snapshot keyed by lang_filter so
_FILE_LIST_CACHE: dict = {}     # lang_filter -> (signature, [Path, ...])
_CALLERS_CACHE: dict = {}       # (symbol, lang_filter, signature) -> [caller dict, ...]


def _file_list_with_signature(lang_filter: str) -> tuple[tuple, list]:
    """Return (signature, file_list). Signature is a cheap invalidation key
    derived from file count + sum of mtimes. Re-computes walk_code_files
    every call because mtime-sum is ~10ms for ~700 files -- cheaper than
    the 100ms+ we'd spend on stale cache hits after a real code change."""
    from os import stat as _stat
    files = list(walk_code_files(lang_filter=lang_filter))
    mtime_sum = 0.0
    for fp in files:
        try:
            mtime_sum += _stat(fp).st_mtime
        except OSError:  # silent-ok: stat() for signature aggregation; missing file contributes 0 to signature, acceptable
            pass
    signature = (len(files), round(mtime_sum, 3))
    return signature, files


def find_callers(symbol_name: str, project_root: str, lang_filter: str = "") -> list[dict]:
    if not symbol_name:
        return []
    signature, files = _file_list_with_signature(lang_filter)
    cache_key = (symbol_name, lang_filter, signature)
    cached = _CALLERS_CACHE.get(cache_key)
    if cached is not None:
        return cached

    call_patterns = [
        re.compile(rf'\b{re.escape(symbol_name)}\s*\('),
        re.compile(rf'\b{re.escape(symbol_name)}\s*<[^>]*>\s*\('),
        re.compile(rf'::{re.escape(symbol_name)}\s*\('),
        re.compile(rf'\.{re.escape(symbol_name)}\s*\('),
        # Dotted method access: `object.method(` where object is the symbol
        re.compile(rf'\b{re.escape(symbol_name)}\.\w+\s*\('),
        # Variable assignment: `const x = symbolName` or `= symbolName.prop`
        re.compile(rf'=\s*{re.escape(symbol_name)}\b'),
        # Property read: `symbolName.prop` (not already covered by dotted method)
        re.compile(rf'\b{re.escape(symbol_name)}\.\w+'),
    ]

    def_patterns = [
        re.compile(rf'^\s*(?:pub\s+)?(?:async\s+)?(?:fn|function|def|const|let|var|class|struct|enum|trait|interface|type)\s+{re.escape(symbol_name)}\b', re.MULTILINE),
        re.compile(rf'^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+{re.escape(symbol_name)}\b', re.MULTILINE),
    ]

    # Fast pre-filter: files that don't contain the symbol name literally
    symbol_bytes = symbol_name.encode("utf-8")
    callers = []
    for fpath in files:
        try:
            content_bytes = fpath.read_bytes()
        except Exception:
            # silent-ok: optional fallback path.
            continue
        if symbol_bytes not in content_bytes:
            continue
        content = content_bytes.decode("utf-8", errors="ignore")
        for line_num, line in enumerate(content.split("\n"), 1):
            is_def = any(p.search(line) for p in def_patterns)
            if is_def:
                continue
            for cp in call_patterns:
                if cp.search(line):
                    callers.append({"file": str(fpath), "line": line_num, "text": line.strip()[:120]})
                    break
    # Cap the cache to prevent unbounded growth on malformed callers.
    # At worst we re-scan; cap is a memory safety net.
    if len(_CALLERS_CACHE) > 512:
        _CALLERS_CACHE.clear()
    _CALLERS_CACHE[cache_key] = callers
    return callers


def get_type_hierarchy(project_root: str) -> dict:
    root = Path(project_root)
    types: dict[str, dict] = {}
    edges: list[dict] = []

    def _ensure_type(name, kind="unknown", file="", line=0):
        if name not in types:
            types[name] = {
                "kind": kind,
                "file": file,
                "line": line,
                "extends": [],
                "implements": [],
                "implemented_by": [],
                "extended_by": [],
            }
        elif kind != "unknown" and types[name]["kind"] == "unknown":
            types[name]["kind"] = kind
            types[name]["file"] = file
            types[name]["line"] = line

    def _line_at(content, pos):
        return content[:pos].count("\n") + 1

    for fpath in walk_code_files():
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            # silent-ok: optional fallback path.
            continue

        lang = ext_to_lang(fpath.suffix if fpath.suffix else fpath.name)
        fstr = str(fpath)

        if lang == "rust":
            for m in _RUST_DEF_KIND_RE.finditer(content):
                kind = m.group(1)
                name = m.group(2)
                _ensure_type(name, kind, fstr, _line_at(content, m.start()))

            for m in _IMPL_FOR_RE.finditer(content):
                trait_name = m.group(1)
                type_name = m.group(2)
                line = _line_at(content, m.start())
                _ensure_type(type_name)
                _ensure_type(trait_name, "trait")
                if trait_name not in types[type_name]["implements"]:
                    types[type_name]["implements"].append(trait_name)
                edges.append({
                    "from": type_name, "to": trait_name,
                    "relation": "implements", "file": fstr, "line": line,
                })

        elif lang in ("typescript", "javascript") or (lang == "vue"):
            if lang == "vue":
                script_match = re.search(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
                if script_match:
                    content = script_match.group(1)
                else:
                    continue

            for m in TS_PATTERNS["class"].finditer(content):
                name = m.group(1)
                extends = m.group(2) or ""
                implements_raw = (m.group(3) or "").strip()
                line = _line_at(content, m.start())
                _ensure_type(name, "class", fstr, line)

                if extends:
                    extends = extends.strip()
                    _ensure_type(extends)
                    if extends not in types[name]["extends"]:
                        types[name]["extends"].append(extends)
                    edges.append({
                        "from": name, "to": extends,
                        "relation": "extends", "file": fstr, "line": line,
                    })

                if implements_raw:
                    for iface in re.split(r'\s*,\s*', implements_raw):
                        iface = iface.strip().split("<")[0].strip()
                        if not iface:
                            continue
                        _ensure_type(iface, "interface")
                        if iface not in types[name]["implements"]:
                            types[name]["implements"].append(iface)
                        edges.append({
                            "from": name, "to": iface,
                            "relation": "implements", "file": fstr, "line": line,
                        })

            for m in TS_PATTERNS["interface"].finditer(content):
                name = m.group(1)
                extends_raw = (m.group(2) or "").strip()
                line = _line_at(content, m.start())
                _ensure_type(name, "interface", fstr, line)

                if extends_raw:
                    for base in re.split(r'\s*,\s*', extends_raw):
                        base = base.strip().split("<")[0].strip()
                        if not base:
                            continue
                        _ensure_type(base, "interface")
                        if base not in types[name]["extends"]:
                            types[name]["extends"].append(base)
                        edges.append({
                            "from": name, "to": base,
                            "relation": "extends", "file": fstr, "line": line,
                        })

            for m in TS_PATTERNS["enum"].finditer(content):
                name = m.group(1)
                _ensure_type(name, "enum", fstr, _line_at(content, m.start()))

        elif lang == "python":
            for m in PY_PATTERNS["class"].finditer(content):
                name = m.group(1)
                bases = (m.group(2) or "").strip()
                line = _line_at(content, m.start())
                _ensure_type(name, "class", fstr, line)

                if bases:
                    for base in re.split(r'\s*,\s*', bases):
                        base = base.strip().split("(")[0].strip()
                        if not base or base in ("object",):
                            continue
                        _ensure_type(base)
                        if base not in types[name]["extends"]:
                            types[name]["extends"].append(base)
                        edges.append({
                            "from": name, "to": base,
                            "relation": "extends", "file": fstr, "line": line,
                        })

    for name, info in types.items():
        for parent in info["extends"]:
            if parent in types:
                if name not in types[parent]["extended_by"]:
                    types[parent]["extended_by"].append(name)
        for trait in info["implements"]:
            if trait in types:
                if name not in types[trait]["implemented_by"]:
                    types[trait]["implemented_by"].append(name)

    return {"types": types, "edges": edges}



# Re-exports -- find_dead_code + preview_rename extracted.
from .analysis_rename import find_dead_code, preview_rename  # noqa: F401, E402
