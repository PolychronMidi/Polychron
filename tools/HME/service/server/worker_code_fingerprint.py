"""Worker-side code fingerprint -- the mirror of proxy_runtime_fingerprint.js.

The worker process loads worker.py + the server/** tree at boot. Once running,
its /health probe reports liveness but NOT which code it loaded, so a worker
left running after an edit silently serves stale code (the same failure class
as proxy slot drift, one process down). compute() hashes exactly the worker's
own Python sources so the supervisor can compare the live value against disk
and restart on drift.

Worker-scoped ONLY: worker.py + server/**. Deliberately NOT the proxy tree, so
a worker edit never forces proxy slot rotation (wrong coupling).
"""
import hashlib
import os

_SKIP_DIRS = {"__pycache__", "tests", "node_modules"}
_cache = {"root": "", "value": ""}


def _iter_files(service_dir):
    files = []
    worker = os.path.join(service_dir, "worker.py")
    if os.path.isfile(worker):
        files.append(worker)
    server = os.path.join(service_dir, "server")
    for dirpath, dirnames, filenames in os.walk(server):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            if name.endswith(".py"):
                files.append(os.path.join(dirpath, name))
    files.sort()
    return files


def compute(project_root):
    """Hash worker.py + server/**/*.py under <root>/tools/HME/service."""
    service_dir = os.path.join(project_root, "tools", "HME", "service")
    h = hashlib.sha256()
    h.update(b"hme-worker-code-v1\0")
    for abs_path in _iter_files(service_dir):
        rel = os.path.relpath(abs_path, project_root).replace(os.sep, "/")
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        try:
            with open(abs_path, "rb") as f:
                h.update(f.read())
        except OSError:
            h.update(b"missing")
        h.update(b"\0")
    return h.hexdigest()[:12]


def current(project_root):
    """Cached for the process lifetime -- code can't change under a running
    process, and the supervisor only needs the boot-time value to compare."""
    if _cache["root"] == project_root and _cache["value"]:
        return _cache["value"]
    _cache["root"] = project_root
    _cache["value"] = compute(project_root)
    return _cache["value"]
