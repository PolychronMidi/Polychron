"""Logging utilities for HME MCP server."""
import logging
import logging.handlers


class FlushFileHandler(logging.handlers.RotatingFileHandler):
    """RotatingFileHandler that also flushes after every record.

    Rotates at 5MB, keeps 3 backups → max 20MB on disk.
    Flush-on-emit ensures logs reach disk even if process hangs.
    """
    def __init__(self, filename, **kwargs):
        kwargs.setdefault("maxBytes", 5 * 1024 * 1024)
        kwargs.setdefault("backupCount", 3)
        super().__init__(filename, **kwargs)

    def emit(self, record):
        super().emit(record)
        self.flush()
