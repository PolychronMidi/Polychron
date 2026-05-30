#!/usr/bin/env python3
"""PTY bridge for Claude Code: launch the real `claude` under a pseudo-terminal
and expose a control FIFO so HME hooks can type into the LIVE session.

Why this exists: `/compact` is a Claude Code REPL-local command. It is never an
API message, so the HME proxy cannot run it without counterfeiting a fake
compaction on the wire. The only thing that triggers the genuine local /compact
is the session's own input stream. This wrapper owns that stream.

Usage: scripts/hme-claude.py [args passed through to `claude`]

Multi-step shortcuts (config/shortcuts.json `multi-step`, e.g. cc): the
UserPromptSubmit hook (claude_adapter.js) writes the shortcut KEY to
tmp/hme-cc-control.fifo and blocks the literal prompt. This wrapper reads the
key, looks up its `steps` (e.g. ["/compact", "continue"]), and types each step
into the live session in turn -- typing the next only after the REPL goes idle.
Real local actions, no API fakery.
"""
import os
import sys
import pty
import select
import signal
import struct
import fcntl
import termios
import tty
import time
import errno
import stat
import json
import re

IDLE_SECS = 3.0          # quiet window after a step before sending the next one
MAX_STEP_WAIT = 360.0    # per-step hard cap so a stuck step never wedges the queue


def success_banner_text(key, steps):
    # MUST match the reason the UserPromptSubmit hook emits (claude_adapter.js
    # _handleCcShortcut). Claude Code prints a blocked-by-hook reason as
    return (
        "UserPromptSubmit operation blocked by hook:\n"
        "  %s shortcut: dispatched %s to the live session via the PTY bridge."
        % (key, " -> ".join(steps))
    )


class ExactOutputFilter:
    """Streaming byte filter for exact PTY output markers.

    Claude Code always prints hook block reasons to the terminal. For a multi-step
    shortcut's success path that message is pure implementation noise; failures
    must still remain visible. This filter removes only the exact success banners,
    including chunk-boundary cases, and passes everything else through unchanged.
    """

    def __init__(self, patterns):
        self.patterns = sorted([p for p in patterns if p], key=lambda p: p[1], reverse=True)
        self.buf = b""
        self.pending_banner_eol = False
        self.keep = max((window for _pattern, window in self.patterns), default=1) - 1

    def feed(self, data):
        if data:
            self.buf += data
        out = []
        if self.pending_banner_eol and self.buf:
            if self.buf.startswith(b"\r\n"):
                self.buf = self.buf[2:]
            elif self.buf.startswith(b"\n"):
                self.buf = self.buf[1:]
            self.pending_banner_eol = False
        while self.patterns:
            best_m = None
            for pattern, _window in self.patterns:
                match = pattern.search(self.buf)
                if match and (best_m is None or match.start() < best_m.start() or (match.start() == best_m.start() and match.end() > best_m.end())):
                    best_m = match
            if best_m is not None:
                if best_m.start():
                    out.append(self.buf[:best_m.start()])
                self.buf = self.buf[best_m.end():]
                if self.buf.startswith(b"\r\n"):
                    self.buf = self.buf[2:]
                elif self.buf.startswith(b"\n"):
                    self.buf = self.buf[1:]
                continue
            if len(self.buf) <= self.keep:
                break
            emit_len = len(self.buf) - self.keep
            out.append(self.buf[:emit_len])
            self.buf = self.buf[emit_len:]
            break
        return b"".join(out)

    def flush(self):
        tail = self.feed(b"")
        if self.buf:
            tail += self.buf
            self.buf = b""
        return tail


DEFAULT_MULTISTEP = {"cc": ["/compact", "continue"]}


def load_multistep(root):
    # Read the multi-step (local-session) shortcuts from the single source of
    # truth. Resilient: if the config is missing/unreadable, fall back to the
    cfg_path = os.path.join(root, "tools", "HME", "config", "shortcuts.json")
    try:
        with open(cfg_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return dict(DEFAULT_MULTISTEP)
    multistep = data.get("multi-step")
    if not isinstance(multistep, dict):
        return dict(DEFAULT_MULTISTEP)
    out = {}
    for key, spec in multistep.items():
        steps = spec.get("steps") if isinstance(spec, dict) else None
        if isinstance(steps, list) and steps:
            out[str(key).strip().lower()] = [str(s) for s in steps]
    return out or dict(DEFAULT_MULTISTEP)


def _ansi_tolerant_literal(text):
    ansi = rb"(?:\x1b\[[0-9;]*m)*"
    parts = []
    for b in text.encode("utf-8"):
        if b == 10:
            parts.append(ansi + rb"(?:\r\n|\n)" + ansi)
        else:
            parts.append(re.escape(bytes([b])) + ansi)
    return b"".join(parts)


def success_banner_patterns(multistep):
    patterns = []
    trailing_newline = rb"(?:\r\n|\n)?"
    for key, steps in multistep.items():
        body = _ansi_tolerant_literal(success_banner_text(key, steps))
        # Regex length is unrelated to the literal stream length; use a bounded
        # window derived from the plain banner length so chunk-boundary matches keep
        window = len(success_banner_text(key, steps).encode("utf-8")) + 64
        patterns.append((re.compile(body + trailing_newline), window))
    return patterns


def project_root():
    env = os.environ.get("PROJECT_ROOT")
    if env and os.path.isdir(env):
        return env
    # This script may live at tools/HME/scripts after repository normalization.
    # Climb to the repository root so the bridge and hook agree on root tmp/.
    cur = os.path.dirname(os.path.abspath(__file__))
    while True:
        if os.path.isdir(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return os.getcwd()
        cur = parent


def fifo_path(root):
    return os.path.join(root, "tmp", "hme-cc-control.fifo")


def ensure_fifo(path):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    if os.path.exists(path):
        try:
            mode = os.stat(path).st_mode
            if stat.S_ISFIFO(mode):
                return path
            os.unlink(path)
        except OSError:
            pass  # silent-ok: pending review  # best effort: recreate below if possible
    try:
        os.mkfifo(path, 0o600)
    except FileExistsError:
        pass  # silent-ok: pending review  # another bridge may have created it first
    return path


def set_winsize(fd):
    try:
        sz = fcntl.ioctl(sys.stdout.fileno(), termios.TIOCGWINSZ, b"\0" * 8)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, sz)
    except OSError:
        pass  # silent-ok: pending review


def main():
    root = project_root()
    fifo = ensure_fifo(fifo_path(root))
    multistep = load_multistep(root)

    argv = sys.argv[1:]
    claude = os.environ.get("HME_CLAUDE_BIN", "claude")

    pid, master = pty.fork()
    if pid == 0:
        # Child: exec the real claude on the slave side of the PTY.
        try:
            os.execvp(claude, [claude] + argv)
        except OSError as e:
            sys.stderr.write("hme-claude: exec %s failed: %s\n" % (claude, e))
            os._exit(127)

    # Parent: bridge real terminal <-> master, plus the control FIFO.
    set_winsize(master)

    def on_winch(_sig, _frm):
        set_winsize(master)
    signal.signal(signal.SIGWINCH, on_winch)

    stdin_fd = sys.stdin.fileno()
    old_attr = None
    try:
        old_attr = termios.tcgetattr(stdin_fd)
        tty.setraw(stdin_fd)
    except (termios.error, ValueError):
        old_attr = None

    # O_RDWR keeps a writer attached so the FIFO never reports EOF when the hook
    # closes its write end between tokens.
    ctrl_fd = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)

    ctrl_buf = b""
    output_filter = ExactOutputFilter(success_banner_patterns(multistep))
    # Remaining steps of the in-flight multi-step shortcut. The first step is
    # typed the moment the token arrives; the rest drain one-per-idle-window.
    pending_steps = []
    step_started_at = 0.0
    last_master_out = 0.0

    def type_into_session(text):
        try:
            os.write(master, text.encode("utf-8"))
        except OSError:
            pass  # silent-ok: pending review

    try:
        while True:
            timeout = 1.0 if pending_steps else None
            try:
                rfds, _, _ = select.select([stdin_fd, master, ctrl_fd], [], [], timeout)
            except select.error as e:
                if e.args and e.args[0] == errno.EINTR:
                    continue
                raise

            if master in rfds:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    data = b""
                if not data:
                    tail = output_filter.flush()
                    if tail:
                        os.write(sys.stdout.fileno(), tail)
                    break
                filtered = output_filter.feed(data)
                if filtered:
                    os.write(sys.stdout.fileno(), filtered)
                last_master_out = time.time()

            if stdin_fd in rfds:
                try:
                    data = os.read(stdin_fd, 65536)
                except OSError:
                    data = b""
                if data:
                    type_into_session(data.decode("latin-1"))

            if ctrl_fd in rfds:
                try:
                    chunk = os.read(ctrl_fd, 4096)
                except OSError:
                    chunk = b""
                if chunk:
                    ctrl_buf += chunk
                    while b"\n" in ctrl_buf:
                        line, ctrl_buf = ctrl_buf.split(b"\n", 1)
                        token = line.strip().decode("utf-8", "replace").lower()
                        steps = multistep.get(token)
                        if steps and not pending_steps:
                            # Type the first step now; queue the rest to drain
                            # one at a time as the REPL goes idle between them.
                            type_into_session(steps[0] + "\r")
                            pending_steps = list(steps[1:])
                            step_started_at = time.time()
                            last_master_out = time.time()

            if pending_steps:
                now = time.time()
                idle = now - last_master_out
                waited = now - step_started_at
                if (idle >= IDLE_SECS and waited >= IDLE_SECS) or waited >= MAX_STEP_WAIT:
                    type_into_session(pending_steps.pop(0) + "\r")
                    step_started_at = time.time()
                    last_master_out = time.time()
    finally:
        if old_attr is not None:
            try:
                termios.tcsetattr(stdin_fd, termios.TCSAFLUSH, old_attr)
            except (termios.error, ValueError):
                pass  # silent-ok: pending review
        try:
            os.close(ctrl_fd)
        except OSError:
            pass  # silent-ok: pending review
        try:
            os.unlink(fifo)
        except OSError:
            pass  # silent-ok: pending review

    _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        sys.exit(os.WEXITSTATUS(status))
    sys.exit(1)


if __name__ == "__main__":
    main()
