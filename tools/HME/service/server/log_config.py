"""Logging utilities for HME MCP server."""
import logging
import logging.handlers
import os


class FlushFileHandler(logging.handlers.RotatingFileHandler):
    """Rotating file handler that flushes every record."""
    def __init__(self, filename, **kwargs):
        kwargs.setdefault("maxBytes", 5 * 1024 * 1024)
        kwargs.setdefault("backupCount", 3)
        super().__init__(filename, **kwargs)

    def emit(self, record):
        super().emit(record)
        self.flush()


def _same_file_handler(handler, filename: str) -> bool:
    base = getattr(handler, "baseFilename", "")
    return bool(base) and os.path.abspath(base) == os.path.abspath(filename)


def configure_hme_file_logger(logger: logging.Logger, filename: str) -> FlushFileHandler:
    """Install one hme.log file handler, even across reloads/imports."""
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    logger.propagate = False
    found = None
    for handler in list(logger.handlers):
        if _same_file_handler(handler, filename):
            if found is None:
                found = handler
                continue
            logger.removeHandler(handler)
            handler.close()
    if found is None:
        found = FlushFileHandler(filename, encoding="utf-8")
        found.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(found)
    found.setLevel(logging.DEBUG)
    return found
