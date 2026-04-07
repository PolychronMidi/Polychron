"""Protocol-level stdin logging proxy for MCP stdio transport.

Wraps sys.stdin so every incoming tools/call message is logged to hme.log
*before* the tool dispatcher runs — captures requests even if the tool hangs.
"""
import json
import logging
import sys

logger = logging.getLogger("HME")


class _LoggingBuffer:
    """Byte-stream proxy that logs every incoming tools/call MCP message."""

    def __init__(self, inner):
        self._inner = inner
        self._pending = b""

    def _sniff(self, data: bytes):
        if not data:
            return
        self._pending += data
        while b"\n" in self._pending:
            line, self._pending = self._pending.split(b"\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                method = msg.get("method", "")
                if method == "tools/call":
                    name_ = (msg.get("params") or {}).get("name", "?")
                    logger.info(f"PROTO tools/call → {name_}")
                elif method and not method.startswith("notifications/"):
                    logger.info(f"PROTO {method}")
            except Exception:
                pass

    def read(self, n=-1):
        d = self._inner.read(n)
        self._sniff(d)
        return d

    def readline(self):
        d = self._inner.readline()
        self._sniff(d)
        return d

    def read1(self, n=-1):
        fn = getattr(self._inner, "read1", None) or self._inner.read
        d = fn(n)
        self._sniff(d)
        return d

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _LoggingStdin:
    """sys.stdin proxy with a logging .buffer for FastMCP stdio transport."""

    def __init__(self, original):
        self._original = original
        self.buffer = _LoggingBuffer(original.buffer)

    def __getattr__(self, name):
        return getattr(self._original, name)


def install():
    """Replace sys.stdin with the logging proxy."""
    sys.stdin = _LoggingStdin(sys.stdin)
