import re
import logging
from pathlib import Path

from lang_registry import ext_to_lang, SUPPORTED_EXTENSIONS, LANGUAGES
from file_walker import walk_code_files

logger = logging.getLogger(__name__)

TS_PATTERNS = {
    "function": re.compile(
        r'^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+?))?(?:\s*\{|$)',
        re.MULTILINE,
    ),
    "arrow": re.compile(
        r'^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+?)?\s*=\s*(?:async\s+)?(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^=]+?))?\s*=>',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\{]+?))?(?:\s*\{)',
        re.MULTILINE,
    ),
    "interface": re.compile(
        r'^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^\{]+?))?(?:\s*\{)',
        re.MULTILINE,
    ),
    "type_alias": re.compile(
        r'^(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.+?)(?:;|$)',
        re.MULTILINE,
    ),
    "enum": re.compile(
        r'^(?:export\s+)?(?:const\s+)?enum\s+(\w+)',
        re.MULTILINE,
    ),
    "method": re.compile(
        r'^\s+(?:(?:public|private|protected|static|async|readonly|abstract|override|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{;]+?))?(?:\s*[\{;])',
        re.MULTILINE,
    ),
}

# Polychron uses CommonJS IIFE globals: `name = (() => { ... })();`
# These are the primary module pattern (473 files). TS_PATTERNS misses them.
JS_IIFE_PATTERNS = {
    "iife_global": re.compile(
        r'^(\w+)\s*=\s*(?:/\*\*[^*]*\*/\s*)?(?:\(\s*)?\(\s*\(\s*\)\s*=>\s*\{',
        re.MULTILINE,
    ),
    "iife_function_global": re.compile(
        r'^(\w+)\s*=\s*(?:/\*\*[^*]*\*/\s*)?(?:\(\s*)?\(\s*function\s*\(\s*\)\s*\{',
        re.MULTILINE,
    ),
    "const_global": re.compile(
        r'^(?:const|let|var)\s+(\w+)\s*=\s*(?:require|function)',
        re.MULTILINE,
    ),
    # Indented named functions inside IIFEs (function name(...) {)
    "inner_function": re.compile(
        r'^\s+function\s+(\w+)\s*\(([^)]*)\)',
        re.MULTILINE,
    ),
}

RUST_PATTERNS = {
    "function": re.compile(
        r'^(?:\s*(?:pub(?:\([\w:]+\))?\s+)?)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^\{]+?))?(?:\s*(?:where\s+[^\{]+)?\s*\{)',
        re.MULTILINE,
    ),
    "struct": re.compile(
        r'^(?:pub(?:\([\w:]+\))?\s+)?struct\s+(\w+)(?:<[^>]*>)?',
        re.MULTILINE,
    ),
    "enum": re.compile(
        r'^(?:pub(?:\([\w:]+\))?\s+)?enum\s+(\w+)(?:<[^>]*>)?',
        re.MULTILINE,
    ),
    "trait": re.compile(
        r'^(?:pub(?:\([\w:]+\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)(?:<[^>]*>)?',
        re.MULTILINE,
    ),
    "impl": re.compile(
        r'^impl(?:<[^>]*>)?\s+(?:(\w+)\s+for\s+)?(\w+)(?:<[^>]*>)?',
        re.MULTILINE,
    ),
    "type_alias": re.compile(
        r'^(?:pub(?:\([\w:]+\))?\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.+?);',
        re.MULTILINE,
    ),
    "const": re.compile(
        r'^(?:pub(?:\([\w:]+\))?\s+)?(?:const|static)\s+(\w+)\s*:\s*([^=]+?)\s*=',
        re.MULTILINE,
    ),
    "macro": re.compile(
        r'^(?:pub(?:\([\w:]+\))?\s+)?macro_rules!\s+(\w+)',
        re.MULTILINE,
    ),
}

PY_PATTERNS = {
    "function": re.compile(
        r'^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^class\s+(\w+)(?:\(([^)]*)\))?:',
        re.MULTILINE,
    ),
}

JAVA_PATTERNS = {
    "method": re.compile(
        r'^\s*(?:(?:public|private|protected|static|abstract|final|synchronized|native)\s+)*(?:[\w<>\[\],.\s]+)\s+(\w+)\s*\(([^)]*)\)(?:\s*throws\s+[\w,\s]+)?\s*[{;]',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*(?:class|interface|enum|@interface)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\{]+?))?',
        re.MULTILINE,
    ),
}

KOTLIN_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:(?:public|private|protected|internal|override|open|abstract|suspend|inline|infix|operator|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\{=]+?))?(?:\s*[{=])',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|enum|inner|annotation|value)\s+)*(?:class|interface|object)\s+(\w+)(?:\s*(?::\s*([^\{]+?))?)?(?:\s*[{(]|$)',
        re.MULTILINE,
    ),
}

GO_PATTERNS = {
    "function": re.compile(
        r'^\s*func\s+(?:\(\w+\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*(?:\([^)]*\)|[\w*\[\]]+))?(?:\s*\{)',
        re.MULTILINE,
    ),
    "type": re.compile(
        r'^\s*type\s+(\w+)\s+(struct|interface)',
        re.MULTILINE,
    ),
}

C_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:static\s+|inline\s+|extern\s+)*[\w*&\s]+\b(\w+)\s*\([^)]*\)\s*(?:const\s*)?[{]',
        re.MULTILINE,
    ),
    "struct": re.compile(
        r'^\s*(?:typedef\s+)?(?:struct|enum|union)\s+(\w+)',
        re.MULTILINE,
    ),
}

CPP_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:virtual\s+|static\s+|inline\s+|explicit\s+|extern\s+|constexpr\s+)*[\w:*&<>\s]+?\b(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?(?:final\s*)?[{;]',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|enum\s+class|enum|namespace)\s+(\w+)',
        re.MULTILINE,
    ),
}

CSHARP_PATTERNS = {
    "method": re.compile(
        r'^\s*(?:(?:public|private|protected|internal|static|virtual|override|async|abstract|sealed|new|partial)\s+)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*[{;]',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:(?:public|private|protected|internal|static|abstract|sealed|partial)\s+)*(?:class|struct|enum|interface|record|namespace)\s+(\w+)',
        re.MULTILINE,
    ),
}

PHP_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)\s*\([^)]*\)',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:(?:abstract|final)\s+)?(?:class|interface|trait|enum)\s+(\w+)',
        re.MULTILINE,
    ),
}

RUBY_PATTERNS = {
    "method": re.compile(
        r'^\s*def\s+(self\.)?(\w+[?!=]?)',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:class|module)\s+(\w+(?:::\w+)*)',
        re.MULTILINE,
    ),
}

SCALA_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:override\s+)?(?:private|protected)?\s*def\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)(?:\s*:\s*([^\{=]+?))?',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:abstract\s+|sealed\s+|case\s+|final\s+)*(?:class|object|trait)\s+(\w+)',
        re.MULTILINE,
    ),
}

SWIFT_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:(?:public|private|internal|fileprivate|open|override|static|class|mutating)\s+)*func\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:(?:public|private|internal|fileprivate|open|final)\s+)*(?:class|struct|enum|protocol|extension|actor)\s+(\w+)',
        re.MULTILINE,
    ),
}

DART_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:(?:static|abstract|external|factory)\s+)*[\w<>\[\]?,\s]+\s+(\w+)\s*\([^)]*\)\s*(?:async\s*)?[{;]',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^\s*(?:abstract\s+)?(?:class|mixin|enum|extension|typedef)\s+(\w+)',
        re.MULTILINE,
    ),
}

ELIXIR_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:def|defp|defmacro|defmacrop)\s+(\w+)',
        re.MULTILINE,
    ),
    "module": re.compile(
        r'^\s*defmodule\s+([\w.]+)',
        re.MULTILINE,
    ),
}

LUA_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:local\s+)?function\s+([\w.:]+)\s*\(',
        re.MULTILINE,
    ),
}

BASH_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:function\s+)?(\w+)\s*\(\s*\)\s*\{',
        re.MULTILINE,
    ),
}

PERL_PATTERNS = {
    "function": re.compile(
        r'^\s*sub\s+(\w+)',
        re.MULTILINE,
    ),
    "package": re.compile(
        r'^\s*package\s+([\w:]+)',
        re.MULTILINE,
    ),
}

HASKELL_PATTERNS = {
    "signature": re.compile(
        r'^(\w+)\s*::\s*(.+)$',
        re.MULTILINE,
    ),
    "type": re.compile(
        r'^\s*(?:data|newtype|type|class|instance)\s+(\w+)',
        re.MULTILINE,
    ),
}

R_PATTERNS = {
    "function": re.compile(
        r'^(\w+)\s*(?:<-|=)\s*function\s*\(',
        re.MULTILINE,
    ),
}

JULIA_PATTERNS = {
    "function": re.compile(
        r'^\s*function\s+(\w+)\s*(?:\{[^}]*\})?\s*\(',
        re.MULTILINE,
    ),
    "type": re.compile(
        r'^\s*(?:mutable\s+)?(?:struct|abstract\s+type|module)\s+(\w+)',
        re.MULTILINE,
    ),
}

ZIG_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:pub\s+)?fn\s+(\w+)\s*\(',
        re.MULTILINE,
    ),
    "type": re.compile(
        r'^\s*(?:pub\s+)?const\s+(\w+)\s*=\s*(?:struct|enum|union)\s*[{(]',
        re.MULTILINE,
    ),
}

NIM_PATTERNS = {
    "function": re.compile(
        r'^\s*(?:proc|func|method|iterator|template|macro)\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(',
        re.MULTILINE,
    ),
    "type": re.compile(
        r'^\s*type\s+(\w+)',
        re.MULTILINE,
    ),
}

OCAML_PATTERNS = {
    "let": re.compile(
        r'^\s*let\s+(?:rec\s+)?(\w+)',
        re.MULTILINE,
    ),
    "module": re.compile(
        r'^\s*module\s+(\w+)',
        re.MULTILINE,
    ),
    "type": re.compile(
        r'^\s*type\s+(\w+)',
        re.MULTILINE,
    ),
}

ERLANG_PATTERNS = {
    "function": re.compile(
        r'^(\w+)\s*\([^)]*\)\s*->',
        re.MULTILINE,
    ),
    "module": re.compile(
        r'^-module\((\w+)\)',
        re.MULTILINE,
    ),
}

OBJC_PATTERNS = {
    "method": re.compile(
        r'^[-+]\s*\([^)]*\)\s*(\w+)',
        re.MULTILINE,
    ),
    "class": re.compile(
        r'^@(?:interface|implementation|protocol)\s+(\w+)',
        re.MULTILINE,
    ),
}

PROTO_PATTERNS = {
    "message": re.compile(
        r'^\s*(?:message|service|enum)\s+(\w+)',
        re.MULTILINE,
    ),
    "rpc": re.compile(
        r'^\s*rpc\s+(\w+)\s*\(',
        re.MULTILINE,
    ),
}

SQL_PATTERNS = {
    "create": re.compile(
        r'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER|INDEX|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)',
        re.MULTILINE | re.IGNORECASE,
    ),
}


def extract_symbols(file_path: str, content: str = "") -> list[dict]:
    ext = Path(file_path).suffix
    fname = Path(file_path).name
    lang = ext_to_lang(fname if not ext else ext)
    if not lang or lang == "text":
        return []

    if not content:
        try:
            content = Path(file_path).read_text(encoding="utf-8", errors="ignore")
        except Exception:
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
                    if name in ("if", "else", "for", "while", "switch", "return", "new", "delete", "typeof", "constructor"):
                        if name != "constructor":
                            continue
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
                    if kind == "inner_function":
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


def collect_all_symbols(project_root: str) -> list[dict]:
    all_symbols = []
    for fpath in walk_code_files(project_root):
        syms = extract_symbols(str(fpath))
        all_symbols.extend(syms)
    return all_symbols


def find_callers(symbol_name: str, project_root: str, lang_filter: str = "") -> list[dict]:
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

    callers = []
    for fpath in walk_code_files(project_root, lang_filter=lang_filter):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for line_num, line in enumerate(content.split("\n"), 1):
            is_def = any(p.search(line) for p in def_patterns)
            if is_def:
                continue
            for cp in call_patterns:
                if cp.search(line):
                    callers.append({"file": str(fpath), "line": line_num, "text": line.strip()[:120]})
                    break
    return callers


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

    for fpath in walk_code_files(project_root):
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


_SKIP_NAMES = {
    "main", "new", "constructor", "init", "setup", "teardown",
    "default", "from", "into", "drop", "clone", "fmt",
    "eq", "ne", "partial_cmp", "cmp", "hash",
    "deref", "deref_mut", "index", "index_mut",
    "next", "size_hint", "len", "is_empty",
    "serialize", "deserialize",
}


def find_dead_code(project_root: str, language: str = "") -> list[dict]:
    root = Path(project_root)
    all_symbols = collect_all_symbols(project_root)

    trait_methods: set[str] = set()
    for fpath in walk_code_files(project_root, lang_filter="rust"):
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
    for fpath in walk_code_files(project_root, lang_filter=language):
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


_DEF_KW_RE = re.compile(
    r'^\s*(?:export\s+)?(?:pub(?:\([^)]*\))?\s+)?'
    r'(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?'
    r'(?:fn|function|def|class|struct|enum|trait|interface|type|macro_rules!)\s+'
)
_IMPORT_RE = re.compile(r'\b(?:import|from|use|require)\b')
_CALL_RE_TMPL = r'(?:^|[.\s:]){}(\s*(?:<[^>]*>\s*)?\()'
_TYPE_REF_CONTEXT = re.compile(r'(?::\s*$|->|<\s*$|\bextends\b|\bimplements\b|\bwhere\b)')
_STRING_CHAR = {'"', "'", '`'}


def preview_rename(old_name: str, new_name: str, project_root: str, language: str = "") -> list[dict]:
    root = Path(project_root)
    word_re = re.compile(rf'\b{re.escape(old_name)}\b')
    results: list[dict] = []

    for fpath in walk_code_files(project_root, lang_filter=language):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        fstr = str(fpath)

        for line_num, line in enumerate(content.split("\n"), 1):
            for m in word_re.finditer(line):
                col = m.start()
                text = line.strip()[:120]

                in_string = False
                quote_char = None
                i = 0
                while i < col:
                    ch = line[i]
                    if ch == '\\' and quote_char:
                        i += 2
                        continue
                    if ch in _STRING_CHAR:
                        if not in_string:
                            in_string = True
                            quote_char = ch
                        elif ch == quote_char:
                            in_string = False
                            quote_char = None
                    i += 1

                stripped = line.lstrip()
                is_comment = (
                    stripped.startswith("//")
                    or stripped.startswith("#")
                    or stripped.startswith("*")
                    or stripped.startswith("/*")
                )

                if in_string or is_comment:
                    results.append({
                        "file": fstr, "line": line_num, "column": col,
                        "text": text,
                        "category": "string_literal" if in_string else "comment",
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

