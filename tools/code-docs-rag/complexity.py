import re
import os
from pathlib import Path
from lang_registry import ext_to_lang, SUPPORTED_EXTENSIONS, LANGUAGES
from file_walker import walk_code_files


def _extract_balanced_braces(content: str, start: int) -> tuple[int, str]:
    depth = 0
    i = start
    while i < len(content) and content[i] != '{':
        i += 1
    if i >= len(content):
        return start, ""
    body_start = i
    while i < len(content):
        if content[i] == '{':
            depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                return i + 1, content[body_start:i + 1]
        i += 1
    return i, content[body_start:i]


def _extract_function_bodies(content: str, language: str) -> list[tuple[str, int, str]]:
    results = []
    block_style = LANGUAGES.get(language, {}).get("block_style")

    if language == "rust":
        pat = re.compile(
            r'^(?:\s*(?:pub(?:\([\w:]+\))?\s+)?)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)',
            re.MULTILINE,
        )
        for m in pat.finditer(content):
            name = m.group(1)
            line = content[:m.start()].count("\n") + 1
            end_pos, body = _extract_balanced_braces(content, m.end())
            if body:
                results.append((name, line, body))

    elif language in ("typescript", "javascript"):
        func_pat = re.compile(
            r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)',
            re.MULTILINE,
        )
        for m in func_pat.finditer(content):
            name = m.group(1)
            line = content[:m.start()].count("\n") + 1
            end_pos, body = _extract_balanced_braces(content, m.end())
            if body:
                results.append((name, line, body))

        arrow_pat = re.compile(
            r'(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=]+?)?\s*=\s*(?:async\s+)?(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^=]+?)?\s*=>',
            re.MULTILINE,
        )
        for m in arrow_pat.finditer(content):
            name = m.group(1)
            line = content[:m.start()].count("\n") + 1
            end_pos, body = _extract_balanced_braces(content, m.end())
            if body:
                results.append((name, line, body))

        method_pat = re.compile(
            r'^\s+(?:(?:public|private|protected|static|async|readonly|abstract|override|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{;]+?)?\s*\{',
            re.MULTILINE,
        )
        skip_keywords = {"if", "else", "for", "while", "switch", "return", "new", "delete", "typeof"}
        for m in method_pat.finditer(content):
            name = m.group(1)
            if name in skip_keywords:
                continue
            line = content[:m.start()].count("\n") + 1
            brace_pos = m.end() - 1
            end_pos, body = _extract_balanced_braces(content, brace_pos)
            if body:
                results.append((name, line, body))

    elif language == "python":
        pat = re.compile(r'^( *)(?:async\s+)?def\s+(\w+)\s*\([^)]*\)[^:]*:', re.MULTILINE)
        lines = content.split("\n")
        for m in pat.finditer(content):
            name = m.group(2)
            base_indent = len(m.group(1))
            start_line = content[:m.start()].count("\n") + 1
            start_line_idx = start_line - 1
            body_lines = []
            for i in range(start_line_idx + 1, len(lines)):
                ln = lines[i]
                if ln.strip() == "":
                    body_lines.append(ln)
                    continue
                indent = len(ln) - len(ln.lstrip())
                if indent > base_indent:
                    body_lines.append(ln)
                else:
                    break
            while body_lines and body_lines[-1].strip() == "":
                body_lines.pop()
            if body_lines:
                results.append((name, start_line, "\n".join(body_lines)))

    elif block_style == "brace" and language in ("java", "kotlin", "scala", "csharp", "go", "php", "dart", "swift", "c", "cpp", "objective_c", "zig", "proto"):
        _BRACE_FUNC_PATTERNS = {
            "java": re.compile(r'^\s*(?:(?:public|private|protected|static|abstract|final|synchronized|native)\s+)*[\w<>\[\],.\s]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{', re.MULTILINE),
            "kotlin": re.compile(r'^\s*(?:(?:public|private|protected|internal|override|open|abstract|suspend|inline)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)\s*\([^)]*\)[^{]*\{', re.MULTILINE),
            "scala": re.compile(r'^\s*(?:override\s+)?(?:private|protected)?\s*def\s+(\w+)\s*(?:\[[^\]]*\])?\s*\([^)]*\)[^{]*\{', re.MULTILINE),
            "csharp": re.compile(r'^\s*(?:(?:public|private|protected|internal|static|virtual|override|async|abstract|sealed)\s+)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*\{', re.MULTILINE),
            "go": re.compile(r'^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\([^)]*\)[^{]*\{', re.MULTILINE),
            "php": re.compile(r'^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)\s*\([^)]*\)[^{]*\{', re.MULTILINE),
            "dart": re.compile(r'^\s*(?:(?:static|abstract|external)\s+)*[\w<>\[\]?,\s]+\s+(\w+)\s*\([^)]*\)\s*(?:async\s*)?\{', re.MULTILINE),
            "swift": re.compile(r'^\s*(?:(?:public|private|internal|open|override|static|class|mutating)\s+)*func\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)[^{]*\{', re.MULTILINE),
            "c": re.compile(r'^\s*(?:static\s+|inline\s+|extern\s+)*[\w*&\s]+\b(\w+)\s*\([^)]*\)\s*\{', re.MULTILINE),
            "cpp": re.compile(r'^\s*(?:virtual\s+|static\s+|inline\s+|explicit\s+)*[\w:*&<>\s]+?\b(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?\{', re.MULTILINE),
            "objective_c": re.compile(r'(?:[-+]\s*\([^)]*\)\s*(\w+)[^{]*\{|^\s*[\w*&\s]+\b(\w+)\s*\([^)]*\)\s*\{)', re.MULTILINE),
            "zig": re.compile(r'^\s*(?:pub\s+)?fn\s+(\w+)\s*\([^)]*\)[^{]*\{', re.MULTILINE),
        }
        skip_kw = {'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'sizeof', 'typeof', 'foreach', 'synchronized'}
        pat = _BRACE_FUNC_PATTERNS.get(language)
        if pat:
            for m in pat.finditer(content):
                name = m.group(1) or (m.group(2) if m.lastindex >= 2 else None)
                if not name or name in skip_kw:
                    continue
                line = content[:m.start()].count("\n") + 1
                brace_pos = m.end() - 1
                end_pos, body = _extract_balanced_braces(content, brace_pos)
                if body:
                    results.append((name, line, body))

    elif block_style == "end_keyword" and language in ("ruby", "lua", "elixir", "julia"):
        _END_FUNC_PATTERNS = {
            "ruby": re.compile(r'^\s*def\s+(?:self\.)?(\w+[?!=]?)', re.MULTILINE),
            "lua": re.compile(r'^\s*(?:local\s+)?function\s+([\w.:]+)\s*\(', re.MULTILINE),
            "elixir": re.compile(r'^\s*(?:def|defp)\s+(\w+)', re.MULTILINE),
            "julia": re.compile(r'^\s*function\s+(\w+)', re.MULTILINE),
        }
        pat = _END_FUNC_PATTERNS.get(language)
        if pat:
            src_lines = content.split("\n")
            for m in pat.finditer(content):
                name = m.group(1)
                start_line = content[:m.start()].count("\n") + 1
                depth = 1
                end_idx = start_line
                opener = re.compile(r'\b(?:def|do|class|module|if|unless|case|while|for|begin|fun|function|struct)\b')
                for idx in range(start_line, len(src_lines)):
                    stripped = src_lines[idx].strip()
                    if not stripped or stripped.startswith('#') or stripped.startswith('--'):
                        continue
                    depth += len(opener.findall(stripped))
                    if stripped == 'end' or stripped.startswith('end ') or stripped.startswith('end;') or stripped.startswith('end)'):
                        depth -= 1
                        if depth <= 0:
                            end_idx = idx
                            break
                body = "\n".join(src_lines[start_line:end_idx + 1])
                if body.strip():
                    results.append((name, start_line, body))

    elif block_style == "indent" and language in ("nim", "haskell"):
        if language == "nim":
            pat = re.compile(r'^( *)(?:proc|func|method|iterator)\s+(\w+)', re.MULTILINE)
        else:
            pat = re.compile(r'^(\w+)\s+', re.MULTILINE)
        src_lines = content.split("\n")
        for m in pat.finditer(content):
            name = m.group(2) if m.lastindex >= 2 else m.group(1)
            base_indent = len(m.group(1)) if m.group(1) and m.group(1).isspace() else 0
            start_line = content[:m.start()].count("\n") + 1
            body_lines = []
            for idx in range(start_line, len(src_lines)):
                ln = src_lines[idx]
                if ln.strip() == "":
                    body_lines.append(ln)
                    continue
                indent = len(ln) - len(ln.lstrip())
                if indent > base_indent:
                    body_lines.append(ln)
                else:
                    if body_lines:
                        break
            while body_lines and body_lines[-1].strip() == "":
                body_lines.pop()
            if body_lines:
                results.append((name, start_line, "\n".join(body_lines)))

    return results


def _compute_complexity_rust(body: str) -> int:
    c = 1
    c += len(re.findall(r'\bif\b', body))
    c += len(re.findall(r'\bfor\b', body))
    c += len(re.findall(r'\bwhile\b', body))
    c += len(re.findall(r'\bloop\b', body))
    c += len(re.findall(r'=>', body))
    c += len(re.findall(r'&&', body))
    c += len(re.findall(r'\|\|', body))
    c += len(re.findall(r'\?', body))
    c += len(re.findall(r'\.unwrap\(\)', body))
    return c


def _compute_complexity_ts(body: str) -> int:
    c = 1
    c += len(re.findall(r'\bif\b', body))
    c += len(re.findall(r'\bfor\b', body))
    c += len(re.findall(r'\bwhile\b', body))
    c += len(re.findall(r'\bcase\b', body))
    c += len(re.findall(r'&&', body))
    c += len(re.findall(r'\|\|', body))
    c += len(re.findall(r'\?(?![.?])', body))
    c += len(re.findall(r'\bcatch\b', body))
    return c


def _compute_complexity_python(body: str) -> int:
    c = 1
    c += len(re.findall(r'\bif\b', body))
    c += len(re.findall(r'\belif\b', body))
    c += len(re.findall(r'\bfor\b', body))
    c += len(re.findall(r'\bwhile\b', body))
    c += len(re.findall(r'\bexcept\b', body))
    c += len(re.findall(r'\band\b', body))
    c += len(re.findall(r'\bor\b', body))
    return c


def _compute_complexity_brace_generic(body: str) -> int:
    c = 1
    c += len(re.findall(r'\bif\b', body))
    c += len(re.findall(r'\bfor\b', body))
    c += len(re.findall(r'\bwhile\b', body))
    c += len(re.findall(r'\bcase\b', body))
    c += len(re.findall(r'\bswitch\b', body))
    c += len(re.findall(r'&&', body))
    c += len(re.findall(r'\|\|', body))
    c += len(re.findall(r'\?(?![.?])', body))
    c += len(re.findall(r'\bcatch\b', body))
    return c


def _compute_complexity_end_keyword(body: str) -> int:
    c = 1
    c += len(re.findall(r'\bif\b', body))
    c += len(re.findall(r'\belsif\b|\belif\b', body))
    c += len(re.findall(r'\bfor\b', body))
    c += len(re.findall(r'\bwhile\b', body))
    c += len(re.findall(r'\bcase\b|\bwhen\b', body))
    c += len(re.findall(r'\brescue\b|\bcatch\b|\bexcept\b', body))
    c += len(re.findall(r'\band\b|\b&&\b', body))
    c += len(re.findall(r'\bor\b|\b\|\|\b', body))
    return c


def _max_nesting_braces(body: str) -> int:
    depth = 0
    max_depth = 0
    for ch in body:
        if ch == '{':
            depth += 1
            max_depth = max(max_depth, depth)
        elif ch == '}':
            depth -= 1
    return max_depth


def _max_nesting_indent(body: str) -> int:
    if not body.strip():
        return 0
    lines = body.split("\n")
    non_empty = [ln for ln in lines if ln.strip()]
    if not non_empty:
        return 0
    base_indent = len(non_empty[0]) - len(non_empty[0].lstrip())
    max_depth = 0
    for ln in non_empty:
        indent = len(ln) - len(ln.lstrip())
        rel = (indent - base_indent) // 4
        if rel > max_depth:
            max_depth = rel
    return max_depth


def compute_complexity(file_path: str) -> list[dict]:
    fpath = Path(file_path)
    ext = fpath.suffix
    lang = ext_to_lang(ext if ext else fpath.name)
    if not lang or lang == "text":
        return []

    try:
        content = fpath.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    if lang == "vue":
        script_match = re.search(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
        if script_match:
            content = script_match.group(1)
            lang = "typescript"
        else:
            return []

    functions = _extract_function_bodies(content, lang)
    results = []
    block_style = LANGUAGES.get(lang, {}).get("block_style")

    for name, line, body in functions:
        if lang == "rust":
            cx = _compute_complexity_rust(body)
            nd = _max_nesting_braces(body)
        elif lang in ("typescript", "javascript"):
            cx = _compute_complexity_ts(body)
            nd = _max_nesting_braces(body)
        elif lang == "python":
            cx = _compute_complexity_python(body)
            nd = _max_nesting_indent(body)
        elif block_style == "brace":
            cx = _compute_complexity_brace_generic(body)
            nd = _max_nesting_braces(body)
        elif block_style == "end_keyword":
            cx = _compute_complexity_end_keyword(body)
            nd = _max_nesting_indent(body)
        elif block_style == "indent":
            cx = _compute_complexity_python(body)
            nd = _max_nesting_indent(body)
        else:
            continue

        body_lines = body.count("\n") + 1
        results.append({
            "name": name,
            "file": file_path,
            "line": line,
            "complexity": cx,
            "nesting_depth": nd,
            "lines": body_lines,
        })

    return results


def find_hotspots(directory: str, top_n: int = 30) -> list[dict]:
    all_funcs = []

    for fpath in walk_code_files(directory):
        lang = ext_to_lang(fpath.suffix if fpath.suffix else fpath.name)
        if not lang or lang == "text":
            continue

        metrics = compute_complexity(str(fpath))
        for m in metrics:
            m["language"] = lang
            all_funcs.append(m)

    all_funcs.sort(key=lambda x: x["complexity"], reverse=True)
    return all_funcs[:top_n]

