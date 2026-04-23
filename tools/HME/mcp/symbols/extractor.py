import re
import logging
from pathlib import Path

from lang_registry import ext_to_lang
from file_walker import walk_code_files
from .patterns import (
    TS_PATTERNS, JS_IIFE_PATTERNS, RUST_PATTERNS, PY_PATTERNS,
    JAVA_PATTERNS, KOTLIN_PATTERNS, GO_PATTERNS, C_PATTERNS, CPP_PATTERNS,
    CSHARP_PATTERNS, PHP_PATTERNS, RUBY_PATTERNS, SCALA_PATTERNS,
    SWIFT_PATTERNS, DART_PATTERNS, ELIXIR_PATTERNS, LUA_PATTERNS,
    BASH_PATTERNS, PERL_PATTERNS, HASKELL_PATTERNS, R_PATTERNS,
    JULIA_PATTERNS, ZIG_PATTERNS, NIM_PATTERNS, OCAML_PATTERNS,
    ERLANG_PATTERNS, OBJC_PATTERNS, PROTO_PATTERNS, SQL_PATTERNS,
)

logger = logging.getLogger(__name__)


def extract_symbols(file_path: str, content: str = "") -> list[dict]:
    ext = Path(file_path).suffix
    fname = Path(file_path).name
    lang = ext_to_lang(fname if not ext else ext)
    if not lang or lang == "text":
        return []

    if not content:
        try:
            content = Path(file_path).read_text(encoding="utf-8", errors="ignore")
        except Exception as _read_err:
            logger.debug(f"extractor: could not read {file_path}: {type(_read_err).__name__}: {_read_err}")
            return []

    if lang == "vue":
        script_match = re.search(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
        if script_match:
            content = script_match.group(1)
            lang = "typescript"
        else:
            return []

    symbols = []

    def _line_at(pos):
        return content[:pos].count("\n") + 1

    if lang in ("typescript", "javascript"):
        patterns = TS_PATTERNS
        current_class = None

        for kind, pat in patterns.items():
            for m in pat.finditer(content):
                line = _line_at(m.start())
                name = m.group(1)

                if kind == "function":
                    params = m.group(2).strip()
                    ret = (m.group(3) or "").strip()
                    symbols.append({
                        "name": name, "kind": "function", "line": line,
                        "signature": f"({params})" + (f": {ret}" if ret else ""),
                        "file": file_path, "language": lang,
                    })
                elif kind == "arrow":
                    params = m.group(2).strip()
                    ret = (m.group(3) or "").strip()
                    symbols.append({
                        "name": name, "kind": "function", "line": line,
                        "signature": f"({params})" + (f": {ret}" if ret else ""),
                        "file": file_path, "language": lang,
                    })
                elif kind == "class":
                    extends = m.group(2) or ""
                    symbols.append({
                        "name": name, "kind": "class", "line": line,
                        "signature": f"extends {extends}" if extends else "",
                        "file": file_path, "language": lang,
                    })
                elif kind == "interface":
                    extends = (m.group(2) or "").strip()
                    symbols.append({
                        "name": name, "kind": "interface", "line": line,
                        "signature": f"extends {extends}" if extends else "",
                        "file": file_path, "language": lang,
                    })
                elif kind == "type_alias":
                    value = m.group(2).strip()[:80]
                    symbols.append({
                        "name": name, "kind": "type", "line": line,
                        "signature": f"= {value}",
                        "file": file_path, "language": lang,
                    })
                elif kind == "enum":
                    symbols.append({
                        "name": name, "kind": "enum", "line": line,
                        "signature": "",
                        "file": file_path, "language": lang,
                    })
                elif kind == "method":
                    _METHOD_SKIP = {
                        "if", "else", "for", "while", "switch", "return", "new", "delete",
                        "typeof", "require", "exports", "module", "Object", "Array", "Promise",
                        "console", "process", "global", "window", "document", "Math", "JSON",
                        "register", "emit", "on", "off", "use", "get", "set", "has", "add",
                        "try", "catch", "finally", "throw", "await", "yield", "import", "export",
                    }
                    if name in _METHOD_SKIP:
                        continue
                    if name != "constructor" and name[0].islower() and len(name) < 4:
                        continue  # skip very short lowercase names (likely keywords or noise)
                    params = m.group(2).strip()
                    ret = (m.group(3) or "").strip()
                    symbols.append({
                        "name": name, "kind": "method", "line": line,
                        "signature": f"({params})" + (f": {ret}" if ret else ""),
                        "file": file_path, "language": lang,
                    })

        # JS IIFE globals: `name = (() => { ... })()`
        if lang == "javascript":
            for kind, pat in JS_IIFE_PATTERNS.items():
                for m in pat.finditer(content):
                    name = m.group(1)
                    if name in ("if", "else", "for", "while", "return", "const", "let", "var"):
                        continue
                    line = _line_at(m.start())
                    if kind in ("inner_function", "arrow_global"):
                        params = m.group(2).strip() if m.lastindex >= 2 else ""
                        symbols.append({
                            "name": name, "kind": "function", "line": line,
                            "signature": f"({params})",
                            "file": file_path, "language": lang,
                        })
                    else:
                        symbols.append({
                            "name": name, "kind": "global", "line": line,
                            "signature": "IIFE global" if "iife" in kind else "module global",
                            "file": file_path, "language": lang,
                        })

    elif lang == "rust":
        for kind, pat in RUST_PATTERNS.items():
            for m in pat.finditer(content):
                line = _line_at(m.start())

                if kind == "function":
                    name = m.group(1)
                    params = m.group(2).strip()
                    ret = (m.group(3) or "").strip()
                    symbols.append({
                        "name": name, "kind": "function", "line": line,
                        "signature": f"({params})" + (f" -> {ret}" if ret else ""),
                        "file": file_path, "language": lang,
                    })
                elif kind in ("struct", "enum", "trait"):
                    name = m.group(1)
                    symbols.append({
                        "name": name, "kind": kind, "line": line,
                        "signature": "",
                        "file": file_path, "language": lang,
                    })
                elif kind == "impl":
                    trait_name = m.group(1) or ""
                    type_name = m.group(2)
                    sig = f"{trait_name} for {type_name}" if trait_name else type_name
                    symbols.append({
                        "name": type_name, "kind": "impl", "line": line,
                        "signature": sig,
                        "file": file_path, "language": lang,
                    })
                elif kind == "type_alias":
                    name = m.group(1)
                    value = m.group(2).strip()[:80]
                    symbols.append({
                        "name": name, "kind": "type", "line": line,
                        "signature": f"= {value}",
                        "file": file_path, "language": lang,
                    })
                elif kind == "const":
                    name = m.group(1)
                    ty = m.group(2).strip()
                    symbols.append({
                        "name": name, "kind": "const", "line": line,
                        "signature": f": {ty}",
                        "file": file_path, "language": lang,
                    })
                elif kind == "macro":
                    name = m.group(1)
                    symbols.append({
                        "name": name, "kind": "macro", "line": line,
                        "signature": "",
                        "file": file_path, "language": lang,
                    })

    elif lang == "python":
        indent_stack = []
        for kind, pat in PY_PATTERNS.items():
            for m in pat.finditer(content):
                line = _line_at(m.start())
                name = m.group(1)

                if kind == "function":
                    params = m.group(2).strip()
                    ret = (m.group(3) or "").strip()
                    symbols.append({
                        "name": name, "kind": "function", "line": line,
                        "signature": f"({params})" + (f" -> {ret}" if ret else ""),
                        "file": file_path, "language": lang,
                    })
                elif kind == "class":
                    bases = (m.group(2) or "").strip()
                    symbols.append({
                        "name": name, "kind": "class", "line": line,
                        "signature": f"({bases})" if bases else "",
                        "file": file_path, "language": lang,
                    })

    elif lang == "java":
        _SKIP_JAVA = {'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'synchronized', 'try'}
        for m in JAVA_PATTERNS["method"].finditer(content):
            name = m.group(1)
            if name in _SKIP_JAVA:
                continue
            line = _line_at(m.start())
            params = m.group(2).strip() if m.lastindex >= 2 else ""
            symbols.append({"name": name, "kind": "method", "line": line, "signature": f"({params})", "file": file_path, "language": lang})
        for m in JAVA_PATTERNS["class"].finditer(content):
            name = m.group(1)
            line = _line_at(m.start())
            extends = m.group(2) or ""
            kind = "class"
            raw = m.group(0).strip()
            if "interface" in raw: kind = "interface"
            elif "enum" in raw: kind = "enum"
            symbols.append({"name": name, "kind": kind, "line": line, "signature": f"extends {extends}" if extends else "", "file": file_path, "language": lang})

    elif lang == "kotlin":
        for m in KOTLIN_PATTERNS["function"].finditer(content):
            name = m.group(1)
            line = _line_at(m.start())
            params = m.group(2).strip() if m.lastindex >= 2 else ""
            ret = (m.group(3) or "").strip() if m.lastindex >= 3 else ""
            symbols.append({"name": name, "kind": "function", "line": line, "signature": f"({params})" + (f": {ret}" if ret else ""), "file": file_path, "language": lang})
        for m in KOTLIN_PATTERNS["class"].finditer(content):
            name = m.group(1)
            line = _line_at(m.start())
            symbols.append({"name": name, "kind": "class", "line": line, "signature": "", "file": file_path, "language": lang})

    elif lang == "go":
        for m in GO_PATTERNS["function"].finditer(content):
            receiver = m.group(1) or ""
            name = m.group(2)
            line = _line_at(m.start())
            params = m.group(3).strip() if m.lastindex >= 3 else ""
            kind = "method" if receiver else "function"
            symbols.append({"name": name, "kind": kind, "line": line, "signature": f"({params})", "file": file_path, "language": lang})
        for m in GO_PATTERNS["type"].finditer(content):
            name = m.group(1)
            kind_str = m.group(2)
            line = _line_at(m.start())
            symbols.append({"name": name, "kind": kind_str, "line": line, "signature": "", "file": file_path, "language": lang})

    elif lang in ("c", "cpp"):
        pats = CPP_PATTERNS if lang == "cpp" else C_PATTERNS
        _SKIP_C = {'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'else', 'decltype', 'alignof'}
        for m in pats["function"].finditer(content):
            name = m.group(1)
            if name in _SKIP_C:
                continue
            line = _line_at(m.start())
            symbols.append({"name": name, "kind": "function", "line": line, "signature": "", "file": file_path, "language": lang})
        struct_pat = pats.get("struct") or pats.get("class")
        if struct_pat:
            for m in struct_pat.finditer(content):
                name = m.group(1)
                line = _line_at(m.start())
                symbols.append({"name": name, "kind": "class", "line": line, "signature": "", "file": file_path, "language": lang})

    elif lang == "csharp":
        _SKIP_CS = {'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'foreach', 'lock', 'using', 'fixed'}
        for m in CSHARP_PATTERNS["method"].finditer(content):
            name = m.group(1)
            if name in _SKIP_CS:
                continue
            line = _line_at(m.start())
            symbols.append({"name": name, "kind": "method", "line": line, "signature": "", "file": file_path, "language": lang})
        for m in CSHARP_PATTERNS["class"].finditer(content):
            name = m.group(1)
            line = _line_at(m.start())
            symbols.append({"name": name, "kind": "class", "line": line, "signature": "", "file": file_path, "language": lang})

    elif lang == "php":
        for m in PHP_PATTERNS["function"].finditer(content):
            name = m.group(1)
            line = _line_at(m.start())
            symbols.append({"name": name, "kind": "function", "line": line, "signature": "", "file": file_path, "language": lang})
        for m in PHP_PATTERNS["class"].finditer(content):
            name = m.group(1)
            line = _line_at(m.start())
            symbols.append({"name": name, "kind": "class", "line": line, "signature": "", "file": file_path, "language": lang})

    else:
        PATTERN_MAP = {
            "ruby": RUBY_PATTERNS, "scala": SCALA_PATTERNS, "swift": SWIFT_PATTERNS,
            "dart": DART_PATTERNS, "elixir": ELIXIR_PATTERNS, "lua": LUA_PATTERNS,
            "bash": BASH_PATTERNS, "perl": PERL_PATTERNS, "haskell": HASKELL_PATTERNS,
            "r": R_PATTERNS, "julia": JULIA_PATTERNS, "zig": ZIG_PATTERNS,
            "nim": NIM_PATTERNS, "ocaml": OCAML_PATTERNS, "erlang": ERLANG_PATTERNS,
            "objective_c": OBJC_PATTERNS, "proto": PROTO_PATTERNS, "sql": SQL_PATTERNS,
        }
        pats = PATTERN_MAP.get(lang)
        if not pats:
            return symbols
        for kind_key, pat in pats.items():
            kind = "function" if kind_key in ("method", "function", "signature", "let", "create", "rpc") else "class" if kind_key in ("class", "module", "type", "message", "package") else kind_key
            for m in pat.finditer(content):
                name = m.group(1) if not (lang == "ruby" and kind_key == "method") else (m.group(2) if m.lastindex >= 2 else m.group(1))
                line = _line_at(m.start())
                symbols.append({"name": name, "kind": kind, "line": line, "signature": "", "file": file_path, "language": lang})

    return symbols


# Worker-lifetime cache keyed by (file-count, sum-of-mtimes). Same
# signature approach as find_callers — cheap to compute, changes whenever
# any code file is touched. Before this cache, module_story called
# collect_all_symbols once per invocation and walked ~819 files +
# ran extract_symbols on every one (tens of seconds for large projects).
_ALL_SYMBOLS_CACHE: dict = {}

def collect_all_symbols(project_root: str) -> list[dict]:
    from os import stat as _stat
    files = list(walk_code_files())
    mtime_sum = 0.0
    for fp in files:
        try:
            mtime_sum += _stat(fp).st_mtime
        except OSError:  # silent-ok: stat() for signature aggregation; missing file contributes 0 to signature, acceptable
            pass
    signature = (len(files), round(mtime_sum, 3))
    cached = _ALL_SYMBOLS_CACHE.get(signature)
    if cached is not None:
        return cached
    all_symbols = []
    for fpath in files:
        syms = extract_symbols(str(fpath))
        all_symbols.extend(syms)
    # Only keep the most recent signature to bound memory
    _ALL_SYMBOLS_CACHE.clear()
    _ALL_SYMBOLS_CACHE[signature] = all_symbols
    return all_symbols
