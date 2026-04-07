"""Logging utilities for HME MCP server."""
import logging


class FlushFileHandler(logging.FileHandler):
    """FileHandler that flushes after every record — ensures logs reach disk even if process hangs."""
    def emit(self, record):
        super().emit(record)
        self.flush()
