import logging
import os
import threading
import time

logger = logging.getLogger(__name__)


def start_watcher(project_root: str, engine, debounce: float = 5.0):
    """Start a background file watcher that re-indexes on source changes.

    Uses watchdog if available; silently skips if not installed.
    Debounces rapid batches of changes into a single index_directory call.
    """
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        logger.info("watchdog not installed -- auto-reindex disabled")
        return None

    _timer: list[threading.Timer] = [None]
    _lock = threading.Lock()

    IGNORE_DIRS = {".git", ".claude", "node_modules", "__pycache__", "venv", ".venv", "dist", "build", "output", "tmp", "lab"}
    IGNORE_EXTS = {".log", ".lock", ".json", ".jsonl", ".md", ".wav", ".mid", ".csv", ".png", ".jpg", ".gif", ".mp3", ".ogg"}

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
            _schedule_reindex()

    def _schedule_reindex():
        with _lock:
            if _timer[0] is not None:
                _timer[0].cancel()
            t = threading.Timer(debounce, _do_reindex)
            t.daemon = True
            _timer[0] = t
            t.start()

    def _do_reindex():
        try:
            logger.info(f"Auto-reindex triggered for {project_root}")
            result = engine.index_directory(project_root)
            if result["indexed"] > 0:
                logger.info(
                    f"Auto-reindex complete: {result['indexed']} files re-indexed, "
                    f"{result['chunks_created']} chunks"
                )
        except Exception as e:
            logger.error(f"Auto-reindex failed: {e}")

    observer = Observer()
    observer.schedule(Handler(), project_root, recursive=True)
    observer.daemon = True
    observer.start()
    logger.info(f"File watcher started: {project_root} (debounce={debounce}s)")
    return observer
