#!/usr/bin/env python3
"""PTY bridge for Claude Code: launch the real `claude` under a pseudo-terminal
and expose a control FIFO so HME hooks can type into the LIVE session.

Why this exists: `/compact` is a Claude Code REPL-local command. It is never an
API message, so the HME proxy cannot run it without counterfeiting a fake
compaction on the wire. The only thing that triggers the genuine local /compact
is the session's own input stream. This wrapper owns that stream.

Usage: scripts/hme-claude.py [args passed through to `claude`]

The `cc` shortcut: the UserPromptSubmit hook (claude_adapter.js) writes the token
`cc` to tmp/hme-cc-control.fifo and blocks the literal prompt. This wrapper reads
the token, types `/compact<Enter>` into the live session, waits for the REPL to go
idle, then types `continue<Enter>` -- two real local actions, no API fakery.
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

IDLE_SECS = 3.0          # quiet window after /compact before sending `continue`
MAX_COMPACT_WAIT = 180.0  # hard cap so a stuck compaction never wedges the queue


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
        if os.path.exists(path) and not os.path.isfile(path):
            return path
        try:
            os.unlink(path)
        except OSError:
            pass  # silent-ok: pending review
    try:
        os.mkfifo(path, 0o600)
    except FileExistsError:
        pass  # silent-ok: pending review
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
    pending_continue = False
    compact_started_at = 0.0
    last_master_out = 0.0

    def type_into_session(text):
        try:
            os.write(master, text.encode("utf-8"))
        except OSError:
            pass  # silent-ok: pending review

    try:
        while True:
            timeout = 1.0 if pending_continue else None
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
                    break
                os.write(sys.stdout.fileno(), data)
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
                        if token == "cc" and not pending_continue:
                            type_into_session("/compact\r")
                            pending_continue = True
                            compact_started_at = time.time()
                            last_master_out = time.time()

            if pending_continue:
                now = time.time()
                idle = now - last_master_out
                waited = now - compact_started_at
                if (idle >= IDLE_SECS and waited >= IDLE_SECS) or waited >= MAX_COMPACT_WAIT:
                    type_into_session("continue\r")
                    pending_continue = False
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
