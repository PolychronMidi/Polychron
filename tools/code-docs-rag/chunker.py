from __future__ import annotations
import re
from typing import Optional

try:
    from tree_sitter_languages import get_parser
    HAS_TREE_SITTER = True
except ImportError:
    HAS_TREE_SITTER = False

from lang_registry import TS_LANG_MAP, FUNC_NODE_TYPES, TOP_LEVEL_CONTAINERS, LANGUAGES

MIN_CHUNK_LINES = 3
MAX_CHUNK_LINES = 120
GLUE_THRESHOLD = 8


def _get_name(node) -> str:
    for child in node.children:
        if child.type in ("identifier", "name", "type_identifier", "property_identifier"):
            return child.text.decode("utf-8", errors="replace")
    return ""


def _node_text(node, source_bytes: bytes) -> str:
    return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def chunk_by_functions(source: str, language: str) -> list[dict]:
    ts_lang = TS_LANG_MAP.get(language)
    if not HAS_TREE_SITTER or not ts_lang:
        return _chunk_by_lines_fallback(source, language)

    try:
        parser = get_parser(ts_lang)
    except Exception:
        return _chunk_by_lines_fallback(source, language)

    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes)

    func_types = FUNC_NODE_TYPES.get(ts_lang, set())
    chunks: list[dict] = []
    covered = set()

    def visit(node, depth=0):
        if node.type in func_types:
            start_line = node.start_point[0] + 1
            end_line = node.end_point[0] + 1
            line_count = end_line - start_line + 1

            if line_count > MAX_CHUNK_LINES and node.type in TOP_LEVEL_CONTAINERS:
                for child in node.children:
                    visit(child, depth + 1)
                return

            text = _node_text(node, source_bytes)
            name = _get_name(node)
            chunks.append({
                "start_line": start_line,
                "end_line": end_line,
                "content": text,
                "name": name,
                "kind": node.type,
            })
            for line in range(start_line, end_line + 1):
                covered.add(line)
            return

        for child in node.children:
            visit(child, depth + 1)

    visit(tree.root_node)

    lines = source.split("\n")
    gap_start = None
    for i in range(1, len(lines) + 1):
        if i not in covered:
            if gap_start is None:
                gap_start = i
        else:
            if gap_start is not None:
                gap_text = "\n".join(lines[gap_start - 1:i - 1])
                if gap_text.strip():
                    chunks.append({
                        "start_line": gap_start,
                        "end_line": i - 1,
                        "content": gap_text,
                        "name": "",
                        "kind": "gap",
                    })
                gap_start = None

    if gap_start is not None:
        gap_text = "\n".join(lines[gap_start - 1:])
        if gap_text.strip():
            chunks.append({
                "start_line": gap_start,
                "end_line": len(lines),
                "content": gap_text,
                "name": "",
                "kind": "gap",
            })

    if not chunks:
        # Fallback: try IIFE-aware regex chunking for JS before generic line split
        if language == "javascript":
            iife_chunks = _chunk_js_iife_functions(source)
            if iife_chunks:
                return iife_chunks
        return _chunk_by_lines_fallback(source, language)

    chunks.sort(key=lambda c: c["start_line"])
    return chunks


def get_function_body(source: str, language: str, function_name: str) -> Optional[dict]:
    ts_lang = TS_LANG_MAP.get(language)
    if not HAS_TREE_SITTER or not ts_lang:
        return _regex_find_function(source, language, function_name)

    try:
        parser = get_parser(ts_lang)
    except Exception:
        return _regex_find_function(source, language, function_name)

    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes)
    func_types = FUNC_NODE_TYPES.get(ts_lang, set())
    matches = []

    def visit(node):
        if node.type in func_types:
            name = _get_name(node)
            if name == function_name:
                matches.append({
                    "name": name,
                    "kind": node.type,
                    "start_line": node.start_point[0] + 1,
                    "end_line": node.end_point[0] + 1,
                    "content": _node_text(node, source_bytes),
                })
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return matches[0] if matches else None


_JS_FUNC_RE = re.compile(r'^\s{2}function\s+(\w+)\s*\(([^)]*)\)', re.MULTILINE)

def _chunk_js_iife_functions(source: str) -> list[dict]:
    """Extract named functions inside IIFEs using regex. Polychron's primary pattern."""
    lines = source.split("\n")
    matches = list(_JS_FUNC_RE.finditer(source))
    if len(matches) < 2:
        return []
    # Extract global name from first line pattern: `name = (() => {`
    global_name = ""
    iife_match = re.match(r'^(\w+)\s*=\s*\(\s*\(', source)
    if iife_match:
        global_name = iife_match.group(1)
    chunks = []
    for i, m in enumerate(matches):
        start_line = source[:m.start()].count("\n") + 1
        end_line = matches[i + 1].start() if i + 1 < len(matches) else len(lines)
        end_line = source[:end_line].count("\n")
        name = m.group(1)
        prefix = f"{global_name}." if global_name else ""
        chunk_text = "\n".join(lines[start_line - 1:end_line])
        if chunk_text.strip():
            chunks.append({
                "start_line": start_line,
                "end_line": end_line,
                "content": chunk_text,
                "name": f"{prefix}{name}",
                "kind": "function",
            })
    # Prepend the state/constants section (before first function)
    if matches and matches[0].start() > 0:
        pre_line = source[:matches[0].start()].count("\n")
        pre_text = "\n".join(lines[:pre_line])
        if pre_text.strip():
            chunks.insert(0, {
                "start_line": 1,
                "end_line": pre_line,
                "content": pre_text,
                "name": global_name or "module-state",
                "kind": "module_header",
            })
    chunks.sort(key=lambda c: c["start_line"])
    return chunks


def _chunk_by_lines_fallback(source: str, language: str, chunk_lines: int = 60, overlap: int = 10) -> list[dict]:
    # IIFE-aware chunking for JS before generic line split
    if language == "javascript":
        iife_chunks = _chunk_js_iife_functions(source)
        if iife_chunks:
            return iife_chunks
    lines = source.split("\n")
    if len(lines) <= chunk_lines:
        return [{"start_line": 1, "end_line": len(lines), "content": source, "name": "", "kind": "block"}]
    chunks = []
    step = chunk_lines - overlap
    for i in range(0, len(lines), step):
        end = min(i + chunk_lines, len(lines))
        chunk = "\n".join(lines[i:end])
        chunks.append({"start_line": i + 1, "end_line": end, "content": chunk, "name": "", "kind": "block"})
        if end >= len(lines):
            break
    return chunks


def _regex_find_function(source: str, language: str, function_name: str) -> Optional[dict]:
    patterns = {
        "rust": rf'^\s*(pub\s+)?(async\s+)?fn\s+{re.escape(function_name)}\s*',
        "typescript": rf'(?:export\s+)?(?:async\s+)?function\s+{re.escape(function_name)}\s*[<(]',
        "javascript": rf'(?:export\s+)?(?:async\s+)?function\s+{re.escape(function_name)}\s*\(',
        "python": rf'^\s*(?:async\s+)?def\s+{re.escape(function_name)}\s*\(',
        "c": rf'[\w*&\s]+\b{re.escape(function_name)}\s*\(',
        "cpp": rf'[\w*&:<>\s]+\b{re.escape(function_name)}\s*\(',
        "csharp": rf'[\w<>\[\],\s]+\s+{re.escape(function_name)}\s*\(',
        "go": rf'func\s+(?:\(\w+\s+\*?\w+\)\s+)?{re.escape(function_name)}\s*\(',
        "php": rf'function\s+{re.escape(function_name)}\s*\(',
        "java": rf'(?:(?:public|private|protected|static|abstract|final|synchronized)\s+)*[\w<>\[\],\s]+\s+{re.escape(function_name)}\s*\(',
        "kotlin": rf'(?:(?:fun|class|object|interface)\s+(?:<[^>]*>\s*)?)?{re.escape(function_name)}\s*[(<]',
        "scala": rf'def\s+{re.escape(function_name)}\s*(?:\[[^\]]*\])?\s*\(',
        "ruby": rf'def\s+(?:self\.)?{re.escape(function_name)}[?!=]?\b',
        "lua": rf'(?:local\s+)?function\s+[\w.:]*{re.escape(function_name)}\s*\(',
        "swift": rf'func\s+{re.escape(function_name)}\s*(?:<[^>]*>)?\s*\(',
        "dart": rf'[\w<>\[\]?,\s]+\s+{re.escape(function_name)}\s*\(',
        "elixir": rf'(?:def|defp|defmacro)\s+{re.escape(function_name)}\b',
        "haskell": rf'^{re.escape(function_name)}\s+',
        "r": rf'{re.escape(function_name)}\s*(?:<-|=)\s*function\s*\(',
        "julia": rf'function\s+{re.escape(function_name)}\s*(?:\{{[^}}]*\}})?\s*\(',
        "perl": rf'sub\s+{re.escape(function_name)}\b',
        "bash": rf'(?:function\s+)?{re.escape(function_name)}\s*\(\s*\)',
        "zig": rf'(?:pub\s+)?fn\s+{re.escape(function_name)}\s*\(',
        "nim": rf'(?:proc|func|method|iterator)\s+{re.escape(function_name)}\s*(?:\[[^\]]*\])?\s*\(',
        "ocaml": rf'let\s+(?:rec\s+)?{re.escape(function_name)}\b',
        "erlang": rf'^{re.escape(function_name)}\s*\(',
        "objective_c": rf'[-+]\s*\([^)]*\)\s*{re.escape(function_name)}\b|[\w*&\s]+\b{re.escape(function_name)}\s*\(',
        "proto": rf'(?:message|service|rpc)\s+{re.escape(function_name)}\b',
        "sql": rf'CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?{re.escape(function_name)}\b',
    }
    pattern = patterns.get(language)
    if not pattern:
        return None

    lines = source.split("\n")
    for i, line in enumerate(lines):
        if re.search(pattern, line):
            end = _find_block_end(lines, i, language)
            content = "\n".join(lines[i:end + 1])
            return {
                "name": function_name,
                "kind": "function",
                "start_line": i + 1,
                "end_line": end + 1,
                "content": content,
            }
    return None


def _find_block_end(lines: list[str], start: int, language: str) -> int:
    block_style = LANGUAGES.get(language, {}).get("block_style")

    if block_style == "indent" or language == "python":
        base_indent = len(lines[start]) - len(lines[start].lstrip())
        for i in range(start + 1, len(lines)):
            stripped = lines[i].strip()
            if not stripped:
                continue
            indent = len(lines[i]) - len(lines[i].lstrip())
            if indent <= base_indent:
                return i - 1
        return len(lines) - 1

    elif block_style == "end_keyword" or language in ("ruby", "lua", "elixir", "julia"):
        depth = 0
        openers = re.compile(r'\b(?:def|do|class|module|if|unless|case|while|for|begin|fun|function|struct)\b')
        for i in range(start, len(lines)):
            stripped = lines[i].strip()
            if not stripped or stripped.startswith('#'):
                continue
            depth += len(openers.findall(stripped))
            if stripped == 'end' or stripped.startswith('end ') or stripped.startswith('end;') or stripped.startswith('end)'):
                depth -= 1
                if depth <= 0:
                    return i
        return min(start + 50, len(lines) - 1)

    else:
        depth = 0
        found_open = False
        for i in range(start, len(lines)):
            for ch in lines[i]:
                if ch == '{':
                    depth += 1
                    found_open = True
                elif ch == '}':
                    depth -= 1
                    if found_open and depth == 0:
                        return i
        return min(start + 50, len(lines) - 1)

