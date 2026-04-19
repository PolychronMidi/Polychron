import re
import logging
from pathlib import Path

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
        r'^(\w+)\s*(?:<=)\s*function\s*\(',
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


def find_iife_globals(content: str) -> list[str]:
    """Find all IIFE global names in JavaScript content."""
    names = []
    skip = {'if', 'else', 'for', 'while', 'return'}
    for pat in (JS_IIFE_PATTERNS["iife_global"], JS_IIFE_PATTERNS["iife_function_global"]):
        for m in pat.finditer(content):
            name = m.group(1)
            if name not in skip:
                names.append(name)
    return names
