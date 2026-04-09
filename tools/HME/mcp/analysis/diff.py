import os
import re
import subprocess
import logging
from pathlib import Path

from lang_registry import ext_to_lang
from file_walker import walk_code_files, get_ignore_dirs, get_lib_abs_paths
from .deps import IMPORT_PATTERNS, _resolve_import

logger = logging.getLogger(__name__)


def analyze_diff(project_root: str, ref: str = "") -> dict:
    from symbols import extract_symbols

    try:
        cmd = ["git", "diff", "--unified=0", "--no-color"]
        if ref:
            cmd.insert(2, ref)
        else:
            cmd.insert(2, "HEAD")
        r = subprocess.run(cmd, cwd=project_root, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return {"error": f"git diff failed: {r.stderr.strip()}"}
    except subprocess.TimeoutExpired:
        return {"error": "git diff timed out"}
    except FileNotFoundError:
        return {"error": "git not found"}

    diff_text = r.stdout
    hunk_re = re.compile(r'^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@', re.MULTILINE)
    file_re = re.compile(r'^diff --git a/(.*?) b/(.*?)$', re.MULTILINE)

    changed_files = []
    total_ins = 0
    total_del = 0

    file_splits = list(file_re.finditer(diff_text))
    for idx, fm in enumerate(file_splits):
        fpath = fm.group(2)
        start = fm.end()
        end = file_splits[idx + 1].start() if idx + 1 < len(file_splits) else len(diff_text)
        chunk = diff_text[start:end]

        ins = sum(1 for line in chunk.split("\n") if line.startswith("+") and not line.startswith("+++"))
        dels = sum(1 for line in chunk.split("\n") if line.startswith("-") and not line.startswith("---"))
        total_ins += ins
        total_del += dels

        hunk_ranges = []
        for hm in hunk_re.finditer(chunk):
            new_start = int(hm.group(3))
            new_count = int(hm.group(4)) if hm.group(4) else 1
            old_start = int(hm.group(1))
            old_count = int(hm.group(2)) if hm.group(2) else 1
            hunk_ranges.append((old_start, old_start + old_count, new_start, new_start + new_count))

        affected_symbols = []
        full_path = os.path.join(project_root, fpath)
        if os.path.isfile(full_path):
            fp = Path(full_path)
            file_lang = ext_to_lang(fp.suffix if fp.suffix else fp.name)
            if file_lang and file_lang != "text":
                try:
                    symbols = extract_symbols(full_path)
                    for sym in symbols:
                        sym_line = sym.get("line", 0)
                        end_line = sym.get("end_line", sym_line + 20)
                        for _, _, ns, ne in hunk_ranges:
                            if ns <= end_line and ne >= sym_line:
                                affected_symbols.append({
                                    "name": sym["name"],
                                    "kind": sym.get("kind", ""),
                                    "line": sym_line,
                                })
                                break
                except Exception:
                    pass

        changed_files.append({
            "file": fpath,
            "insertions": ins,
            "deletions": dels,
            "affected_symbols": affected_symbols,
        })

    impact = set()
    changed_paths = set()
    for cf in changed_files:
        changed_paths.add(os.path.normpath(os.path.join(project_root, cf["file"])))

    for f in walk_code_files(project_root):
        f_norm = os.path.normpath(str(f))
        if f_norm in changed_paths:
            continue
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
                    if resolved and os.path.normpath(resolved) in changed_paths:
                        impact.add(str(f))
                        break

    return {
        "ref": ref or "HEAD (working tree)",
        "files_changed": len(changed_files),
        "insertions": total_ins,
        "deletions": total_del,
        "changed_files": changed_files,
        "impact": sorted(impact),
    }


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def trace_cross_language(symbol_name: str, project_root: str) -> dict:
    camel_name = _snake_to_camel(symbol_name)

    rust_def = None
    fn_re = re.compile(rf'^\s*pub\s+fn\s+{re.escape(symbol_name)}\s*\(', re.MULTILINE)
    for fpath in walk_code_files(project_root, lang_filter="rust"):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        m = fn_re.search(content)
        if m:
            line_num = content[:m.start()].count("\n") + 1
            before = content[max(0, m.start() - 200):m.start()]
            is_wasm = "#[wasm_bindgen]" in before or "#[wasm_bindgen(" in before
            rust_def = {
                "file": os.path.relpath(str(fpath), project_root),
                "line": line_num,
                "is_wasm_export": is_wasm,
            }
            break

    bridge_refs = []
    ts_callers = []
    ts_exts = {".ts", ".tsx", ".js"}
    for fpath in walk_code_files(project_root, extensions=ts_exts):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        fname = fpath.name
        is_bridge = "wasm" in fname.lower()
        for search_name in {symbol_name, camel_name}:
            pat = re.compile(rf'\b{re.escape(search_name)}\b')
            for m_ts in pat.finditer(content):
                line_num = content[:m_ts.start()].count("\n") + 1
                line_text = content.split("\n")[line_num - 1].strip()
                entry = {
                    "file": os.path.relpath(str(fpath), project_root),
                    "line": line_num,
                    "text": line_text[:200],
                }
                if is_bridge:
                    bridge_refs.append(entry)
                else:
                    ts_callers.append(entry)
                break

    chain = []
    if rust_def:
        wasm_tag = " [wasm_bindgen]" if rust_def["is_wasm_export"] else ""
        chain.append(f"rust:{rust_def['file']}:{rust_def['line']} fn {symbol_name}{wasm_tag}")
    for br in bridge_refs:
        chain.append(f"bridge:{br['file']}:{br['line']}")
    for tc in ts_callers:
        chain.append(f"caller:{tc['file']}:{tc['line']}")

    return {
        "symbol": symbol_name,
        "rust_definition": rust_def,
        "wasm_bridge": bridge_refs,
        "ts_callers": ts_callers,
        "chain": chain,
    }


def diff_configs(project_root: str) -> dict:
    config_patterns = [
        "Cargo.toml", "package.json", "tsconfig.json",
        "tsconfig.*.json", ".eslintrc*", "vite.config.*", "wasm-pack.toml",
        "pom.xml", "build.gradle", "build.sbt", "go.mod",
    ]

    ignore_dirs = get_ignore_dirs()
    lib_abs = get_lib_abs_paths()
    config_files = []
    for pattern in config_patterns:
        for fpath in Path(project_root).rglob(pattern):
            fpath_norm = os.path.normpath(str(fpath))
            rel = os.path.relpath(str(fpath), project_root)
            skip = False
            for ig in ignore_dirs:
                if ig in rel.split(os.sep):
                    skip = True
                    break
            if not skip:
                for la in lib_abs:
                    if fpath_norm == la or fpath_norm.startswith(la + os.sep):
                        skip = True
                        break
            if not skip:
                config_files.append(str(fpath))

    dep_add_re = re.compile(r'^\+\s*"?(\S+?)"?\s*[:=]')
    dep_del_re = re.compile(r'^-\s*"?(\S+?)"?\s*[:=]')

    results = []
    for cf in sorted(set(config_files)):
        rel_path = os.path.relpath(cf, project_root)
        try:
            r = subprocess.run(
                ["git", "diff", "HEAD", "--", rel_path],
                cwd=project_root, capture_output=True, text=True, timeout=15,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

        has_changes = bool(r.stdout.strip())
        added_deps = []
        removed_deps = []
        changed_settings = []
        diff_summary = ""

        if has_changes:
            lines = r.stdout.split("\n")
            added = [l for l in lines if l.startswith("+") and not l.startswith("+++")]
            removed = [l for l in lines if l.startswith("-") and not l.startswith("---")]
            diff_summary = f"+{len(added)} -{len(removed)} lines"

            fname = os.path.basename(cf)
            if fname == "Cargo.toml" or fname == "package.json":
                in_deps = False
                for line in lines:
                    low = line.lower()
                    if "dependencies" in low:
                        in_deps = True
                    elif line.startswith("@@"):
                        in_deps = "dependencies" in low if low else in_deps
                    elif in_deps and line.startswith("+"):
                        m = dep_add_re.match(line)
                        if m:
                            added_deps.append(m.group(1).strip('"').strip("'"))
                    elif in_deps and line.startswith("-"):
                        m = dep_del_re.match(line)
                        if m:
                            removed_deps.append(m.group(1).strip('"').strip("'"))

            if "tsconfig" in fname.lower():
                for line in added + removed:
                    clean = line.lstrip("+-").strip().strip(",").strip('"')
                    if ":" in clean:
                        key = clean.split(":")[0].strip().strip('"')
                        if key and not key.startswith("//"):
                            changed_settings.append(key)
                changed_settings = list(set(changed_settings))

        results.append({
            "file": rel_path,
            "has_changes": has_changes,
            "diff_summary": diff_summary,
            "added_deps": added_deps,
            "removed_deps": removed_deps,
            "changed_settings": changed_settings,
        })

    return {"configs": results}


def generate_changelog(project_root: str, since: str = "", count: int = 50) -> str:
    try:
        if since:
            cmd = ["git", "log", f"{since}..HEAD", f"--pretty=format:%h|%an|%ad|%s", "--date=short"]
        else:
            cmd = ["git", "log", f"-{count}", f"--pretty=format:%h|%an|%ad|%s", "--date=short"]
        r = subprocess.run(cmd, cwd=project_root, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return f"Error: {r.stderr.strip()}"
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return f"Error: {e}"

    categories = {
        "Features": [], "Bug Fixes": [], "Refactoring": [],
        "Performance": [], "Documentation": [], "Tests": [],
        "Maintenance": [], "Other": [],
    }

    prefix_map = {
        "feat": "Features", "add": "Features",
        "fix": "Bug Fixes",
        "refactor": "Refactoring",
        "perf": "Performance",
        "docs": "Documentation", "doc": "Documentation",
        "test": "Tests", "tests": "Tests",
        "chore": "Maintenance", "ci": "Maintenance", "build": "Maintenance",
    }

    for line in r.stdout.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("|", 3)
        if len(parts) < 4:
            continue
        sha, author, date, msg = parts

        cat = "Other"
        msg_lower = msg.lower().strip()
        for prefix, category in prefix_map.items():
            if msg_lower.startswith(prefix + ":") or msg_lower.startswith(prefix + "("):
                cat = category
                break

        categories[cat].append(f"- {msg} (`{sha}`, {author}, {date})")

    lines = ["# Changelog", ""]
    if since:
        lines.append(f"Changes since `{since}`")
        lines.append("")
    for cat, entries in categories.items():
        if not entries:
            continue
        lines.append(f"## {cat}")
        lines.append("")
        lines.extend(entries)
        lines.append("")

    return "\n".join(lines)
