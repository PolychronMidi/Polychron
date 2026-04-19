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
_TYPE_REF_CONTEXT = re.compile(r'(?::\s*$|->|<\s*$|\bextends\b|\bimplements\b|\bwhere\b)')
_STRING_CHAR = {'"', "'", '`'}


# Two-tier cache: (1) a cached file-list snapshot keyed by lang_filter so
# blast-radius BFS (which calls find_callers per-symbol per-layer) doesn't
# re-walk the project tree for every symbol, (2) a per-symbol caller cache
# keyed by (symbol, lang_filter, file_list_signature) so repeated calls for
# the same symbol within one BFS pass are O(1).
# Invalidation: the file_list_signature is the sorted-file-list count + sum
# of mtimes — a cheap proxy that changes whenever any code file is
# added/removed/touched. This is worker-lifetime cache, cleared implicitly
# on worker restart.
_FILE_LIST_CACHE: dict = {}     # lang_filter → (signature, [Path, ...])
_CALLERS_CACHE: dict = {}       # (symbol, lang_filter, signature) → [caller dict, ...]


def _file_list_with_signature(lang_filter: str) -> tuple[tuple, list]:
    """Return (signature, file_list). Signature is a cheap invalidation key
    derived from file count + sum of mtimes. Re-computes walk_code_files
    every call because mtime-sum is ~10ms for ~700 files — cheaper than
    the 100ms+ we'd spend on stale cache hits after a real code change."""
    from os import stat as _stat
    files = list(walk_code_files(lang_filter=lang_filter))
    mtime_sum = 0.0
    for fp in files:
        try:
            mtime_sum += _stat(fp).st_mtime
        except OSError:
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
    # can't possibly match any regex pattern above. Read bytes and check
    # with `in` — one scan per file, skips regex entirely for non-matches.
    symbol_bytes = symbol_name.encode("utf-8")
    callers = []
    for fpath in files:
        try:
            content_bytes = fpath.read_bytes()
        except Exception:
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


def find_dead_code(project_root: str, language: str = "") -> list[dict]:
    root = Path(project_root)
    all_symbols = collect_all_symbols(project_root)

    trait_methods: set[str] = set()
    for fpath in walk_code_files(lang_filter="rust"):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        in_trait = False
        brace_depth = 0
        for line in content.split("\n"):
            stripped = line.strip()
            if re.match(r'^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+', stripped):
                in_trait = True
                brace_depth = 0
            if in_trait:
                brace_depth += line.count("{") - line.count("}")
                fn_match = re.match(r'^\s*(?:async\s+)?fn\s+(\w+)', line)
                if fn_match:
                    trait_methods.add(fn_match.group(1))
                if brace_depth <= 0 and in_trait:
                    in_trait = False

    file_contents: dict[str, str] = {}
    for fpath in walk_code_files(lang_filter=language):
        try:
            file_contents[str(fpath)] = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

    name_pattern_cache: dict[str, re.Pattern] = {}
    dead: list[dict] = []

    for sym in all_symbols:
        if sym["kind"] not in ("function", "method"):
            continue
        if language and sym.get("language", "") != language:
            continue

        name = sym["name"]
        if name in _SKIP_NAMES:
            continue
        if name.startswith("_"):
            continue
        if name.startswith("test_"):
            continue
        if name in trait_methods and sym.get("language") == "rust":
            continue

        sym_file = sym["file"]
        sym_line = sym["line"]

        try:
            src_lines = file_contents.get(sym_file, "").split("\n")
            if sym_line > 0 and sym_line <= len(src_lines):
                prev_line = src_lines[sym_line - 2].strip() if sym_line >= 2 else ""
                if "#[wasm_bindgen" in prev_line or "#[test" in prev_line:
                    continue
                if "export" in src_lines[sym_line - 1]:
                    continue
        except Exception:
            pass

        if name not in name_pattern_cache:
            name_pattern_cache[name] = re.compile(rf'\b{re.escape(name)}\b')

        pat = name_pattern_cache[name]
        found_elsewhere = False

        for fpath_str, content in file_contents.items():
            for line_num, line in enumerate(content.split("\n"), 1):
                if not pat.search(line):
                    continue
                if fpath_str == sym_file and line_num == sym_line:
                    continue
                found_elsewhere = True
                break
            if found_elsewhere:
                break

        if not found_elsewhere:
            dead.append({
                "name": name,
                "kind": sym["kind"],
                "file": sym_file,
                "line": sym_line,
                "language": sym.get("language", ""),
            })

    return dead


def preview_rename(old_name: str, new_name: str, project_root: str, language: str = "") -> list[dict]:
    root = Path(project_root)
    word_re = re.compile(rf'\b{re.escape(old_name)}\b')
    results: list[dict] = []

    for fpath in walk_code_files(lang_filter=language):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        fstr = str(fpath)

        # Track string state at the start of each line (multi-line string support)
        line_start_in_string = False
        line_start_quote_char = None

        for line_num, line in enumerate(content.split("\n"), 1):
            # Capture state at start of this line for per-match scanning
            cur_line_start_in_str = line_start_in_string
            cur_line_start_qchar = line_start_quote_char

            # Advance line-level string state across the entire line
            i = 0
            while i < len(line):
                ch = line[i]
                if ch == '\\' and line_start_quote_char:
                    i += 2
                    continue
                if ch in _STRING_CHAR:
                    if not line_start_in_string:
                        line_start_in_string = True
                        line_start_quote_char = ch
                    elif ch == line_start_quote_char:
                        line_start_in_string = False
                        line_start_quote_char = None
                i += 1

            for m in word_re.finditer(line):
                col = m.start()
                text = line.strip()[:120]

                # Rescan from start of line using beginning-of-line string state
                ms_in_string = cur_line_start_in_str
                ms_quote_char = cur_line_start_qchar
                i = 0
                while i < col:
                    ch = line[i]
                    if ch == '\\' and ms_quote_char:
                        i += 2
                        continue
                    if ch in _STRING_CHAR:
                        if not ms_in_string:
                            ms_in_string = True
                            ms_quote_char = ch
                        elif ch == ms_quote_char:
                            ms_in_string = False
                            ms_quote_char = None
                    i += 1

                stripped = line.lstrip()
                is_comment = (
                    stripped.startswith("//")
                    or stripped.startswith("#")
                    or stripped.startswith("*")
                    or stripped.startswith("/*")
                )

                if ms_in_string or is_comment:
                    results.append({
                        "file": fstr, "line": line_num, "column": col,
                        "text": text,
                        "category": "string_literal" if ms_in_string else "comment",
                        "would_rename": False,
                    })
                    continue

                category = "other"
                if _DEF_KW_RE.match(line) and old_name in line[line.find(old_name):line.find(old_name)+len(old_name)+1]:
                    category = "definition"
                elif _IMPORT_RE.search(line):
                    category = "import"
                elif re.search(rf'(?:\.|::){re.escape(old_name)}\s*\(', line) or re.search(rf'\b{re.escape(old_name)}\s*(?:<[^>]*>\s*)?\(', line):
                    category = "call"
                else:
                    before = line[:col].rstrip()
                    if before.endswith(":") or before.endswith("->") or before.endswith("<") or "extends" in line or "implements" in line or "where" in line:
                        category = "type_reference"

                results.append({
                    "file": fstr, "line": line_num, "column": col,
                    "text": text,
                    "category": category,
                    "would_rename": True,
                })

    return results
