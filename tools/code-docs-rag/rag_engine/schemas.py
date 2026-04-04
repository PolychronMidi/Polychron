import pyarrow as pa
import re

_VECTOR_DIM = 768  # updated by RAGEngine.__init__ from model.get_sentence_embedding_dimension()


def _code_schema(dim: int = None) -> pa.Schema:
    d = dim or _VECTOR_DIM
    return pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("content", pa.utf8()),
        pa.field("source", pa.utf8()),
        pa.field("start_line", pa.int32()),
        pa.field("end_line", pa.int32()),
        pa.field("language", pa.utf8()),
        pa.field("token_count", pa.int32()),
        pa.field("vector", pa.list_(pa.float32(), d)),
    ])


def _knowledge_schema(dim: int = None) -> pa.Schema:
    d = dim or _VECTOR_DIM
    return pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("title", pa.utf8()),
        pa.field("content", pa.utf8()),
        pa.field("category", pa.utf8()),
        pa.field("tags", pa.utf8()),
        pa.field("timestamp", pa.float64()),
        pa.field("vector", pa.list_(pa.float32(), d)),
    ])


def _symbol_schema(dim: int = None) -> pa.Schema:
    d = dim or _VECTOR_DIM
    return pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("name", pa.utf8()),
        pa.field("kind", pa.utf8()),
        pa.field("signature", pa.utf8()),
        pa.field("file", pa.utf8()),
        pa.field("line", pa.int32()),
        pa.field("language", pa.utf8()),
        pa.field("vector", pa.list_(pa.float32(), d)),
    ])


def _extract_signatures(text: str, language: str) -> list[str]:
    sigs = []
    if language in ("rust",):
        for m in re.finditer(r'^\s*(pub\s+)?(async\s+)?(fn\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\))', text, re.MULTILINE):
            sigs.append(m.group(3).strip())
        for m in re.finditer(r'^\s*(pub\s+)?(struct|enum|trait|type|impl)\s+(\S+)', text, re.MULTILINE):
            sigs.append(f"{m.group(2)} {m.group(3)}")
    elif language in ("typescript", "javascript", "vue"):
        for m in re.finditer(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
        for m in re.finditer(r'(?:export\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
        for m in re.finditer(r'^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'new', 'else'):
                sigs.append(f".{name}(...)")
    elif language in ("python",):
        for m in re.finditer(r'^\s*(?:async\s+)?def\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"def {m.group(1)}(...)")
        for m in re.finditer(r'^\s*class\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"class {m.group(1)}")
    elif language in ("c", "cpp"):
        for m in re.finditer(r'^\s*(?:virtual\s+|static\s+|inline\s+|extern\s+)*[\w:*&<>\s]+?\b(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'else'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|enum|union|namespace)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("csharp",):
        for m in re.finditer(r'^\s*(?:public|private|protected|internal|static|virtual|override|async|abstract|sealed|\s)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'foreach', 'lock', 'using'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:public|private|protected|internal|static|abstract|sealed|\s)*(?:class|struct|enum|interface|record|namespace)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("go",):
        for m in re.finditer(r'^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"func {m.group(1)}(...)")
        for m in re.finditer(r'^\s*type\s+(\w+)\s+(struct|interface)', text, re.MULTILINE):
            sigs.append(f"type {m.group(1)} {m.group(2)}")
    elif language in ("php",):
        for m in re.finditer(r'^\s*(?:public|private|protected|static|\s)*function\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:abstract\s+|final\s+)?class\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"class {m.group(1)}")
        for m in re.finditer(r'^\s*(?:interface|trait|enum)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("java",):
        for m in re.finditer(r'^\s*(?:public|private|protected|static|abstract|final|synchronized|native|\s)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?(?:\s*[{;])', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'synchronized'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:public|private|protected|static|abstract|final|\s)*(?:class|interface|enum|@interface)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("kotlin",):
        for m in re.finditer(r'^\s*(?:(?:public|private|protected|internal|override|open|abstract|suspend|inline|infix|operator|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"fun {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|enum|inner|annotation|value)\s+)*(?:class|interface|object)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("scala",):
        for m in re.finditer(r'^\s*(?:override\s+)?(?:private|protected)?\s*def\s+(\w+)\s*(?:\[[^\]]*\])?\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"def {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:abstract\s+|sealed\s+|case\s+|final\s+)*(?:class|object|trait)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("ruby",):
        for m in re.finditer(r'^\s*def\s+(self\.)?(\w+[?!=]?)', text, re.MULTILINE):
            prefix = "self." if m.group(1) else ""
            sigs.append(f"def {prefix}{m.group(2)}")
        for m in re.finditer(r'^\s*(?:class|module)\s+(\w+(?:::\w+)*)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("lua",):
        for m in re.finditer(r'^\s*(?:local\s+)?function\s+([\w.:]+)\s*\(', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
    elif language in ("swift",):
        for m in re.finditer(r'^\s*(?:(?:public|private|internal|fileprivate|open|override|static|class|mutating)\s+)*func\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"func {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:(?:public|private|internal|fileprivate|open|final)\s+)*(?:class|struct|enum|protocol|extension|actor)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("dart",):
        for m in re.finditer(r'^\s*(?:(?:static|abstract|external|factory)\s+)*[\w<>\[\]?,\s]+\s+(\w+)\s*\([^)]*\)\s*(?:async\s*)?[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else'):
                sigs.append(f"{name}(...)")
        for m in re.finditer(r'^\s*(?:abstract\s+)?(?:class|mixin|enum|extension|typedef)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("elixir",):
        for m in re.finditer(r'^\s*(?:def|defp|defmacro|defmacrop)\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"def {m.group(1)}")
        for m in re.finditer(r'^\s*defmodule\s+([\w.]+)', text, re.MULTILINE):
            sigs.append(f"defmodule {m.group(1)}")
    elif language in ("haskell",):
        for m in re.finditer(r'^(\w+)\s*::\s*(.+)$', text, re.MULTILINE):
            sigs.append(f"{m.group(1)} :: {m.group(2).strip()[:60]}")
        for m in re.finditer(r'^\s*(?:data|newtype|type|class|instance)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("r",):
        for m in re.finditer(r'^(\w+)\s*(?:<-|=)\s*function\s*\(', text, re.MULTILINE):
            sigs.append(f"{m.group(1)} <- function(...)")
    elif language in ("julia",):
        for m in re.finditer(r'^\s*function\s+(\w+)\s*(?:\{[^}]*\})?\s*\(', text, re.MULTILINE):
            sigs.append(f"function {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:mutable\s+)?(?:struct|abstract\s+type|module)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
    elif language in ("perl",):
        for m in re.finditer(r'^\s*sub\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"sub {m.group(1)}")
        for m in re.finditer(r'^\s*package\s+([\w:]+)', text, re.MULTILINE):
            sigs.append(f"package {m.group(1)}")
    elif language in ("bash",):
        for m in re.finditer(r'^\s*(?:function\s+)?(\w+)\s*\(\s*\)', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}()")
    elif language in ("zig",):
        for m in re.finditer(r'^\s*(?:pub\s+)?fn\s+(\w+)\s*\(', text, re.MULTILINE):
            sigs.append(f"fn {m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:pub\s+)?const\s+(\w+)\s*=\s*struct\s*\{', text, re.MULTILINE):
            sigs.append(f"const {m.group(1)} = struct")
    elif language in ("nim",):
        for m in re.finditer(r'^\s*(?:proc|func|method|iterator|template|macro)\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(', text, re.MULTILINE):
            sigs.append(f"{m.group(0).split('(')[0].strip()}(...)")
        for m in re.finditer(r'^\s*type\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"type {m.group(1)}")
    elif language in ("ocaml",):
        for m in re.finditer(r'^\s*let\s+(?:rec\s+)?(\w+)', text, re.MULTILINE):
            sigs.append(f"let {m.group(1)}")
        for m in re.finditer(r'^\s*module\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"module {m.group(1)}")
        for m in re.finditer(r'^\s*type\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"type {m.group(1)}")
    elif language in ("erlang",):
        for m in re.finditer(r'^(\w+)\s*\([^)]*\)\s*->', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}(...)")
        for m in re.finditer(r'^-module\((\w+)\)', text, re.MULTILINE):
            sigs.append(f"-module({m.group(1)})")
    elif language in ("objective_c",):
        for m in re.finditer(r'^[-+]\s*\([^)]*\)\s*(\w+)', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}")
        for m in re.finditer(r'^@(?:interface|implementation|protocol)\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"@{m.group(0).split()[0][1:]} {m.group(1)}")
        for m in re.finditer(r'^\s*(?:virtual\s+|static\s+|inline\s+|extern\s+)*[\w:*&<>\s]+?\b(\w+)\s*\([^)]*\)\s*(?:const\s*)?[{;]', text, re.MULTILINE):
            name = m.group(1)
            if name not in ('if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'else'):
                sigs.append(f"{name}(...)")
    elif language in ("proto",):
        for m in re.finditer(r'^\s*(?:message|service|enum)\s+(\w+)', text, re.MULTILINE):
            sigs.append(m.group(0).strip())
        for m in re.finditer(r'^\s*rpc\s+(\w+)\s*\(', text, re.MULTILINE):
            sigs.append(f"rpc {m.group(1)}(...)")
    elif language in ("sql",):
        for m in re.finditer(r'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER|INDEX|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)', text, re.MULTILINE | re.IGNORECASE):
            sigs.append(m.group(0).strip())
    elif language in ("glsl", "hlsl", "wgsl"):
        for m in re.finditer(r'^\s*(?:void|float|vec[234]|mat[234]|int|uint|bool|half[234]?|f(?:16|32))\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}(...)")
        for m in re.finditer(r'^\s*(?:struct|cbuffer|tbuffer)\s+(\w+)', text, re.MULTILINE):
            sigs.append(f"struct {m.group(1)}")
        if language == "wgsl":
            for m in re.finditer(r'^\s*fn\s+(\w+)\s*\([^)]*\)', text, re.MULTILINE):
                sigs.append(f"fn {m.group(1)}(...)")
    elif language in ("asm",):
        for m in re.finditer(r'^(\w+):', text, re.MULTILINE):
            sigs.append(f"{m.group(1)}:")
    seen = set()
    return [s for s in sigs if not (s in seen or seen.add(s))]


def summarize_chunk(content: str, language: str, max_context_lines: int = 3) -> str:
    sigs = _extract_signatures(content, language)
    if sigs:
        return " | ".join(sigs)
    lines = [l.rstrip() for l in content.split("\n") if l.strip() and not l.strip().startswith(("//", "#", "/*", "*", "<!--"))]
    return " | ".join(lines[:max_context_lines]) if lines else "(empty)"


def _chunk_by_lines(text: str, chunk_lines: int = 60, overlap_lines: int = 10) -> list[tuple[int, int, str]]:
    lines = text.split("\n")
    if len(lines) <= chunk_lines:
        return [(1, len(lines), text)]
    chunks = []
    step = chunk_lines - overlap_lines
    for i in range(0, len(lines), step):
        end = min(i + chunk_lines, len(lines))
        chunk = "\n".join(lines[i:end])
        chunks.append((i + 1, end, chunk))
        if end >= len(lines):
            break
    return chunks
