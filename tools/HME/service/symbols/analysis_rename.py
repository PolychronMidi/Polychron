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




def find_dead_code(project_root: str, language: str = "") -> list[dict]:
    root = Path(project_root)
    all_symbols = collect_all_symbols(project_root)

    trait_methods: set[str] = set()
    for fpath in walk_code_files(lang_filter="rust"):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            # silent-ok: optional fallback path.
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
            # silent-ok: optional fallback path.
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
        except (IndexError, AttributeError) as _export_err:
            # Narrowed from `Exception`: these are the only plausible
            logger.debug(f"export-detection skip for {sym_file}:{sym_line}: {type(_export_err).__name__}: {_export_err}")

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
            # silent-ok: optional fallback path.
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
