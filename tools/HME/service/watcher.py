import logging
import os
import threading
import time

from hme_env import ENV

logger = logging.getLogger(__name__)

# Per-file reindex is fast (~0.2-2s per file with chunk diffing),
# so short cooldown. Full directory reindex keeps the longer cooldown.
# ENV.optional_int raises ValueError on garbage, so a typo in .env
# surfaces immediately instead of silently using the default.
MIN_FILE_INTERVAL = ENV.optional_int("HME_WATCHER_FILE_INTERVAL", 10)
MIN_DIR_INTERVAL  = ENV.optional_int("HME_WATCHER_DIR_INTERVAL", 300)
BATCH_THRESHOLD   = ENV.optional_int("HME_WATCHER_BATCH_THRESHOLD", 15)


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
        IGNORE_DIRS = set(_FW_IGNORE_DIRS) | {
            # LanceDB internals churn constantly (transactions, versions,
            # manifests, tmp writes). These must never reach the reindexer
            # OR the file_written emission — they're not code.
            "_transactions", "_versions", "_deletions", "_indices", "data",
        }
    except ImportError:
        IGNORE_DIRS = {
            ".git", ".claude", "node_modules", "__pycache__", "venv", ".venv",
            "dist", "build", "output", "tmp", "lab", "metrics",
            "_transactions", "_versions", "_deletions", "_indices",
        }
    _BUILTIN_IGNORE_EXTS = {
        ".log", ".lock", ".json", ".jsonl", ".md", ".wav", ".mid",
        ".csv", ".png", ".jpg", ".gif", ".mp3", ".ogg",
        # Binary model artifacts — must never hit the embedder.
        ".gguf", ".safetensors", ".bin", ".pt", ".pth", ".ckpt",
        ".h5", ".onnx", ".tflite", ".pb",
        ".gz", ".tar", ".zip", ".xz", ".zst", ".bz2",
        # LanceDB internal files — churn on every index write.
        ".manifest", ".txn", ".lance",
    }
    _env_exts_raw = os.environ.get("HME_IGNORE_EXTS", "")
    _env_exts = {e.strip() if e.strip().startswith(".") else "." + e.strip()
                 for e in _env_exts_raw.split(",") if e.strip()}
    IGNORE_EXTS = _env_exts if _env_exts else _BUILTIN_IGNORE_EXTS
    # Catch patterns that don't have a clean extension: .tmpXXXXXX, .txn#N, etc.
    _NOISE_SUFFIX_PATTERNS = (".tmp", ".txn", ".manifest", ".tmp.")  # .tmp.<pid> editor temp files
    # Allow-list: file_written activity events ONLY fire for paths under
    # these roots. Everything else is infrastructure churn (KB internals,
    # tmp, metrics) and shouldn't count as "a code edit happened." Reindex
    # can still see them (broader IGNORE_DIRS set above), but they won't
    # pollute the coherence score.
    ACTIVITY_ALLOW_PREFIXES = (
        "/src/",
        "/tools/HME/service/", "/tools/HME/chat/", "/tools/HME/proxy/",
        "/tools/HME/hooks/", "/tools/HME/scripts/", "/tools/HME/activity/",
        "/tools/HME/config/",
        "/scripts/",
        "/doc/",
    )

    # Deduplicate file_written emissions: the watcher receives modify + create
    # + close events for a single edit. Emit once per file per short window.
    _recent_emits: dict[str, float] = {}
    _EMIT_DEDUP_WINDOW = 2.0  # seconds
    _last_size: dict[str, int] = {}
    _EXT_LANG = {
        ".js": "javascript", ".ts": "typescript", ".py": "python",
        ".sh": "bash", ".md": "markdown", ".json": "json",
        ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    }

    def _pipeline_running() -> bool:
        """True while tmp/run.lock exists — pipeline is executing. Writes
        during this window are pipeline-mechanical, not human edits."""
        return os.path.exists(os.path.join(project_root, "tmp", "run.lock"))

    def _emit_file_written(abs_path: str) -> None:
        """Make file_written agent-independent: emit from the filesystem
        watcher so edits via any editor (vim, VSCode direct, external script)
        produce the same event the proxy middleware used to get only from
        Claude's Edit/Write tool invocations.

        Payload fields: file, module, hme_read_prior, bytes, bytes_delta,
        lang, source, session. bytes_delta lets downstream distinguish
        typo-fixes from refactors; lang lets slicers partition by language.
        """
        now = time.time()
        last = _recent_emits.get(abs_path, 0.0)
        if now - last < _EMIT_DEDUP_WINDOW:
            return
        _recent_emits[abs_path] = now
        # Cap dict to prevent unbounded growth
        if len(_recent_emits) > 2048:
            _cutoff = now - 60
            for k in list(_recent_emits.keys()):
                if _recent_emits[k] < _cutoff:
                    del _recent_emits[k]
        basename_full = os.path.basename(abs_path)
        module = basename_full.rsplit(".", 1)[0]
        # Try multiple BRIEF lookup keys. Track which one matched (if any)
        # so the diagnostic payload shows WHY hme_read_prior was true/false.
        tried_keys = [module, abs_path, basename_full]
        matched_key = None
        try:
            from nexus_query import has_brief
            for _k in tried_keys:
                if _k and has_brief(_k):
                    matched_key = _k
                    break
        except Exception as _brief_err:
            logger.debug(f"nexus brief check failed: {type(_brief_err).__name__}: {_brief_err}")
        hme_read_prior = matched_key is not None
        # Size + delta + language tagging
        try:
            cur_size = os.path.getsize(abs_path)
        except OSError:
            cur_size = 0
        prev_size = _last_size.get(abs_path, 0)
        bytes_delta = cur_size - prev_size
        _last_size[abs_path] = cur_size
        if len(_last_size) > 2048:
            _last_size.clear()
        ext = os.path.splitext(abs_path)[1].lower()
        lang = _EXT_LANG.get(ext, "other")
        # If the pipeline is running, this write is pipeline-mechanical
        # (fix-non-ascii, verify-boot-order --fix, formatters, etc.) rather
        # than a human/agent edit. Tag accordingly so downstream coherence
        # analyzers can filter pipeline writes out of the human-edit signal.
        source = "pipeline_script" if _pipeline_running() else "fs_watcher"

        # Spawn emit.py detached — never block the watcher thread
        import subprocess as _subp
        try:
            _subp.Popen(
                ["python3",
                 os.path.join(project_root, "tools", "HME", "activity", "emit.py"),
                 "--event=file_written",
                 f"--file={abs_path}",
                 f"--module={module}",
                 f"--hme_read_prior={'true' if hme_read_prior else 'false'}",
                 f"--brief_match_key={matched_key or ''}",
                 f"--brief_keys_tried={'|'.join(k for k in tried_keys if k)}",
                 f"--bytes={cur_size}",
                 f"--bytes_delta={bytes_delta}",
                 f"--lang={lang}",
                 f"--source={source}",
                 "--session=fs_watcher"],
                stdout=_subp.DEVNULL, stderr=_subp.DEVNULL,
                env={**os.environ, "PROJECT_ROOT": project_root},  # env-ok: subprocess needs inherited env
            )
        except Exception as _emit_err:
            logger.debug(f"file_written emit failed: {_emit_err}")

    # Noise-ratio tracker — periodically emit file_watcher_filtered so the
    # volume of dropped-vs-emitted is visible. Lets us tune the allow-list
    # without guessing.
    _filter_counts = {"emitted": 0, "ignored_dir": 0, "ignored_ext": 0,
                      "ignored_noise": 0, "ignored_not_allowed": 0}
    _last_filter_flush = [time.time()]
    _FILTER_FLUSH_INTERVAL = 300  # 5 min

    def _maybe_flush_filter_stats():
        now = time.time()
        if now - _last_filter_flush[0] < _FILTER_FLUSH_INTERVAL:
            return
        total = sum(_filter_counts.values())
        if total == 0:
            _last_filter_flush[0] = now
            return
        import subprocess as _subp
        try:
            _subp.Popen(
                ["python3",
                 os.path.join(project_root, "tools", "HME", "activity", "emit.py"),
                 "--event=file_watcher_filtered",
                 f"--total={total}",
                 f"--emitted={_filter_counts['emitted']}",
                 f"--ignored_dir={_filter_counts['ignored_dir']}",
                 f"--ignored_ext={_filter_counts['ignored_ext']}",
                 f"--ignored_noise={_filter_counts['ignored_noise']}",
                 f"--ignored_not_allowed={_filter_counts['ignored_not_allowed']}",
                 f"--window_s={int(now - _last_filter_flush[0])}",
                 "--session=fs_watcher"],
                stdout=_subp.DEVNULL, stderr=_subp.DEVNULL,
                env={**os.environ, "PROJECT_ROOT": project_root},  # env-ok: subprocess needs inherited env
            )
        except Exception as _flush_err:
            logger.debug(f"filter-stats flush failed: {_flush_err}")
        for k in _filter_counts:
            _filter_counts[k] = 0
        _last_filter_flush[0] = now

    def _is_activity_eligible(abs_path: str) -> bool:
        """Allow-list: only emit file_written for code/doc edits under the
        project's real source tree. Writes to metrics/, tmp/, KB internals,
        etc. never count as 'a code edit happened.'"""
        norm = abs_path.replace("\\", "/")
        for prefix in ACTIVITY_ALLOW_PREFIXES:
            if prefix in norm:
                return True
        return False

    class Handler(FileSystemEventHandler):
        def on_any_event(self, event):
            if event.is_directory:
                return
            # Only emit file_written for real content changes, not access/open.
            # "moved" catches atomic-rename writes (Edit tool writes to .tmp.<pid>
            # then renames to the final path — watchdog fires "moved" on the rename).
            # Use dest_path (the final path) for moved events.
            etype = getattr(event, "event_type", "")
            is_write = etype in ("modified", "created", "moved")
            path = (getattr(event, "dest_path", "") if etype == "moved"
                    else getattr(event, "src_path", "")) or ""
            parts = path.replace("\\", "/").split("/")
            if any(p in IGNORE_DIRS for p in parts):
                if is_write:
                    _filter_counts["ignored_dir"] += 1
                    _maybe_flush_filter_stats()
                return
            basename = os.path.basename(path)
            # Noise suffix check: patterns like .tmpXXXXXX, .txn#N, .manifest#N
            # don't have a clean extension the ext check catches.
            if any(s in basename for s in _NOISE_SUFFIX_PATTERNS):
                if is_write:
                    _filter_counts["ignored_noise"] += 1
                return
            ext = os.path.splitext(path)[1].lower()
            if ext in IGNORE_EXTS:
                if is_write:
                    _filter_counts["ignored_ext"] += 1
                return
            abs_path = os.path.abspath(path)
            if is_write:
                if _is_activity_eligible(abs_path):
                    _emit_file_written(abs_path)
                    _filter_counts["emitted"] += 1
                else:
                    _filter_counts["ignored_not_allowed"] += 1
                _maybe_flush_filter_stats()
            with _lock:
                _changed_files.add(abs_path)
            _schedule_reindex()
            # Auto hot-reload: any .py edit under tools/HME/service/server/
            # schedules a hot reload after a debounce window. Removes the
            # "edit then i/hme-admin action=reload" friction step.
            #
            # NOTE: this watcher is started ONCE per server boot (see
            # rag_engines.py:738). Edits to start_watcher() itself only
            # take effect after a full server restart, not after
            # `i/hme-admin action=reload` (which only re-imports tool
            # modules — the watcher closure was already bound).
            if (
                ext == ".py"
                and "/tools/HME/service/server/" in abs_path.replace(os.sep, "/")
                and not _pipeline_running()
            ):
                _schedule_hot_reload()

    def _schedule_reindex():
        with _lock:
            if _timer[0] is not None:
                _timer[0].cancel()
            t = threading.Timer(debounce, _maybe_reindex)
            t.daemon = True
            _timer[0] = t
            t.start()

    # Hot-reload debounce: 5s (longer than reindex's 3s so a burst of
    # edits coalesces into one reload).
    _reload_timer: list = [None]
    _reload_pending: list[bool] = [False]

    def _schedule_hot_reload():
        with _lock:
            _reload_pending[0] = True
            if _reload_timer[0] is not None:
                _reload_timer[0].cancel()
            t = threading.Timer(5.0, _do_hot_reload)
            t.daemon = True
            _reload_timer[0] = t
            t.start()

    def _do_hot_reload():
        with _lock:
            if not _reload_pending[0]:
                return
            _reload_pending[0] = False
        try:
            from tools_analysis.evolution.evolution_selftest.hot_reload \
                import hme_hot_reload as _reload
            result = _reload("")
            logger.info("auto hot-reload: %s",
                        result.split("\n")[0] if result else "(empty)")
        except Exception as _e:
            logger.warning("Acceptable warning: auto hot-reload failed: "
                           "%s: %s", type(_e).__name__, _e)

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
        # Route bulk dir reindex through the daemon's GPU-orchestrated
        # indexing-mode so embedding doesn't compete with the arbiter on
        # cuda:0 — calling engine.index_directory() directly here OOM'd
        # repeatedly when the embedder shared a GPU with another model.
        try:
            logger.info(f"Auto-reindex (full) triggered for {project_root}")
            from indexing_mode import request_full_reindex
            result = request_full_reindex()
            with _lock:
                _last_reindex[0] = time.time()
            if result.get("error"):
                logger.error(f"Auto-reindex (full) via daemon failed: {result['error']}")
                return
            if result.get("indexed", 0) > 0:
                logger.info(
                    f"Auto-reindex complete: {result['indexed']} files, "
                    f"{result.get('chunks_created', 0)} chunks"
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
