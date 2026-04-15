import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

# Per-file reindex is fast (~0.2-2s per file with chunk diffing),
# so short cooldown. Full directory reindex keeps the longer cooldown.
MIN_FILE_INTERVAL = 10    # seconds between per-file reindex batches
MIN_DIR_INTERVAL = 300    # seconds between full directory reindexes
BATCH_THRESHOLD = 15      # more than this many files -> full directory reindex


def start_watcher(project_root: str, engine, debounce: float = 3.0):
    """Start background file watcher. Collects changed file paths during
    debounce window, then indexes them individually (fast path) or falls
    back to full directory reindex for bulk changes (git checkout, etc)."""
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        logger.info("watchdog not installed -- auto-reindex disabled")
        return None

    _timer: list = [None]
    _last_reindex: list[float] = [0.0]
    _changed_files: set = set()
    _lock = threading.Lock()

    # Stay in sync with file_walker.DEFAULT_IGNORE_DIRS — the watcher must
    # not feed paths to engine.index_file() that walk_code_files() would
    # have rejected. Otherwise the watcher becomes a back door that
    # bypasses every ignore rule (e.g. indexing binary model weights
    # dropped into metrics/).
    try:
        from file_walker import DEFAULT_IGNORE_DIRS as _FW_IGNORE_DIRS
        IGNORE_DIRS = set(_FW_IGNORE_DIRS)
    except ImportError:
        IGNORE_DIRS = {
            ".git", ".claude", "node_modules", "__pycache__", "venv", ".venv",
            "dist", "build", "output", "tmp", "lab", "metrics",
        }
    IGNORE_EXTS = {
        ".log", ".lock", ".json", ".jsonl", ".md", ".wav", ".mid",
        ".csv", ".png", ".jpg", ".gif", ".mp3", ".ogg",
        # Binary model artifacts — must never hit the embedder.
        ".gguf", ".safetensors", ".bin", ".pt", ".pth", ".ckpt",
        ".h5", ".onnx", ".tflite", ".pb",
        ".gz", ".tar", ".zip", ".xz", ".zst", ".bz2",
    }

    class Handler(FileSystemEventHandler):
        def on_any_event(self, event):
            if event.is_directory:
                return
            path = getattr(event, "src_path", "") or ""
            parts = path.replace("\\", "/").split("/")
            if any(p in IGNORE_DIRS for p in parts):
                return
            ext = os.path.splitext(path)[1].lower()
            if ext in IGNORE_EXTS:
                return
            with _lock:
                _changed_files.add(os.path.abspath(path))
            _schedule_reindex()

    def _schedule_reindex():
        with _lock:
            if _timer[0] is not None:
                _timer[0].cancel()
            t = threading.Timer(debounce, _maybe_reindex)
            t.daemon = True
            _timer[0] = t
            t.start()

    def _maybe_reindex():
        now = time.time()
        with _lock:
            elapsed = now - _last_reindex[0]
            files = list(_changed_files)
            _changed_files.clear()

        if not files:
            return

        if len(files) > BATCH_THRESHOLD:
            # Many files changed at once (git checkout, branch switch)
            if elapsed < MIN_DIR_INTERVAL:
                logger.debug(
                    f"Batch reindex deferred — {len(files)} files, "
                    f"cooldown {MIN_DIR_INTERVAL - elapsed:.0f}s remaining"
                )
                with _lock:
                    _changed_files.update(files)
                    t = threading.Timer(MIN_DIR_INTERVAL - elapsed + 1, _maybe_reindex)
                    t.daemon = True
                    _timer[0] = t
                    t.start()
                return
            _do_dir_reindex()
        else:
            # Small number of files — fast per-file reindex
            if elapsed < MIN_FILE_INTERVAL:
                with _lock:
                    _changed_files.update(files)
                    t = threading.Timer(MIN_FILE_INTERVAL - elapsed + 1, _maybe_reindex)
                    t.daemon = True
                    _timer[0] = t
                    t.start()
                return
            _do_file_reindex(files)

    def _do_file_reindex(files):
        try:
            total_embedded = 0
            total_reused = 0
            indexed = 0
            for fpath in files:
                result = engine.index_file(fpath)
                if result.get("indexed", 0) > 0:
                    indexed += 1
                    total_embedded += result.get("chunks_embedded", result.get("chunks_created", 0))
                    total_reused += result.get("chunks_reused", 0)
                elif result.get("removed", 0) > 0:
                    indexed += 1
            with _lock:
                _last_reindex[0] = time.time()
            if indexed > 0:
                parts = [f"Auto-reindex: {indexed}/{len(files)} files"]
                if total_embedded:
                    parts.append(f"{total_embedded} embedded")
                if total_reused:
                    parts.append(f"{total_reused} reused")
                logger.info(", ".join(parts))
        except Exception as e:
            logger.error(f"Auto-reindex (per-file) failed: {e}")

    def _do_dir_reindex():
        try:
            logger.info(f"Auto-reindex (full) triggered for {project_root}")
            result = engine.index_directory(project_root)
            with _lock:
                _last_reindex[0] = time.time()
            if result["indexed"] > 0:
                logger.info(
                    f"Auto-reindex complete: {result['indexed']} files, "
                    f"{result['chunks_created']} chunks"
                )
        except Exception as e:
            logger.error(f"Auto-reindex (full) failed: {e}")

    observer = Observer()
    observer.schedule(Handler(), project_root, recursive=True)
    observer.daemon = True
    observer.start()
    logger.info(
        f"File watcher started: {project_root} "
        f"(debounce={debounce}s, file_cooldown={MIN_FILE_INTERVAL}s, dir_cooldown={MIN_DIR_INTERVAL}s)"
    )
    return observer
