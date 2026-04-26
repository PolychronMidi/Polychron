import os
import re
import subprocess
import logging
from collections import defaultdict

from file_walker import walk_code_files

logger = logging.getLogger(__name__)

ANNOTATION_PATTERN = re.compile(
    r'(?://|#|/\*\*?)\s*(TODO|FIXME|HACK|XXX|BUG|WARN|NOTE|PERF|SAFETY)\b[:\s]*(.*?)(?:\*/)?$',
    re.MULTILINE | re.IGNORECASE,
)


def scan_annotations(project_root: str, annotation_type: str = "") -> list[dict]:
    results = []
    type_filter = annotation_type.upper() if annotation_type else None

    for f in walk_code_files():
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for match in ANNOTATION_PATTERN.finditer(content):
            tag = match.group(1).upper()
            if type_filter and tag != type_filter:
                continue
            text = match.group(2).strip()
            line_num = content[:match.start()].count("\n") + 1
            results.append({
                "file": str(f),
                "line": line_num,
                "type": tag,
                "text": text,
            })

    results.sort(key=lambda x: (x["type"], x["file"], x["line"]))
    return results


def find_similar_code(query_code: str, engine, top_k: int = 10) -> list[dict]:
    return engine.search(query_code, top_k=top_k)


def get_recent_changes(project_root: str, count: int = 20) -> dict:
    try:
        log_result = subprocess.run(
            ["git", "log", f"-{count}", "--pretty=format:%h|%an|%ar|%s", "--stat"],
            cwd=project_root,
            capture_output=True, text=True, timeout=10,
        )
        if log_result.returncode != 0:
            return {"error": f"git log failed: {log_result.stderr.strip()}"}

        diff_result = subprocess.run(
            ["git", "diff", "--stat", "HEAD"],
            cwd=project_root,
            capture_output=True, text=True, timeout=10,
        )

        freq = defaultdict(int)
        freq_result = subprocess.run(
            ["git", "log", f"-{count}", "--pretty=format:", "--name-only"],
            cwd=project_root,
            capture_output=True, text=True, timeout=10,
        )
        if freq_result.returncode == 0:
            for line in freq_result.stdout.strip().split("\n"):
                line = line.strip()
                if line:
                    freq[line] += 1

        hot_files = sorted(freq.items(), key=lambda x: -x[1])[:15]

        return {
            "log": log_result.stdout.strip(),
            "uncommitted": diff_result.stdout.strip() if diff_result.returncode == 0 else "",
            "hot_files": [{"file": f, "changes": c} for f, c in hot_files],
        }
    except FileNotFoundError:
        return {"error": "git not found"}
    except subprocess.TimeoutExpired:
        return {"error": "git command timed out"}


def get_project_summary(project_root: str, engine) -> dict:
    status = engine.get_status()
    kb_status = engine.get_knowledge_status()

    lang_stats = {}
    if engine.table is not None:
        try:
            rows = engine.table.to_arrow()
            langs = rows.column("language").to_pylist()
            for l in langs:
                lang_stats[l] = lang_stats.get(l, 0) + 1
        except Exception as _lang_err:
            logger.debug(f"project.py lang_stats read failed: {type(_lang_err).__name__}: {_lang_err}")

    recent_kb = []
    if engine.knowledge_table is not None:
        try:
            kb_rows = engine.knowledge_table.to_arrow().to_pylist()
            kb_rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)
            for r in kb_rows[:10]:
                recent_kb.append({
                    "title": r["title"],
                    "category": r["category"],
                    "tags": r["tags"],
                })
        except Exception as _kb_err:
            logger.debug(f"project.py recent_kb read failed: {type(_kb_err).__name__}: {_kb_err}")

    changes = get_recent_changes(project_root, count=10)

    return {
        "project_root": project_root,
        "index": status,
        "knowledge": kb_status,
        "language_distribution": lang_stats,
        "recent_knowledge": recent_kb,
        "recent_git": changes,
    }


def save_context_snapshot(project_root: str, snapshot_data: dict) -> str:
    import json
    import time
    snapshot_data["_timestamp"] = time.time()
    snapshot_data["_branch"] = _get_current_branch(project_root)
    path = os.path.join(project_root, "tools", "HME", "KB", "context_snapshot.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot_data, f, indent=2, ensure_ascii=False)
    return path


def load_context_snapshot(project_root: str) -> dict:
    import json
    path = os.path.join(project_root, "tools", "HME", "KB", "context_snapshot.json")
    if not os.path.exists(path):
        return {"error": "No snapshot found"}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _get_current_branch(project_root: str) -> str:
    try:
        r = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=project_root, capture_output=True, text=True, timeout=5,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception as _git_err:
        logger.debug(f"git branch read failed: {type(_git_err).__name__}: {_git_err}")
        return ""
