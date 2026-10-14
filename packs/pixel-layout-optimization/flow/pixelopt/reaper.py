"""Child-subreaper wrapper (stdlib only), a port of the day-1 ``reap.py``.

``python reaper.py -- <argv...>`` makes this process a child subreaper
(``PR_SET_CHILD_SUBREAPER`` via ``prctl(36, 1)``), forks and ``exec``s the given
command, then reaps the command and any orphans it leaves, and exits with the
command's own status (128 + signal when it was killed). Long-lived daemons such
as ``oaFSLockD`` are left running; only already-exited orphans are reaped.

The dedicated ``eda-runner-pixelpack`` container runs ``podman-init`` as PID 1,
so the judge does not need this there (an init already reaps). It is kept for
sites whose container has no init, and is launched as the reaper of one
candidate's whole judgement.
"""
from __future__ import annotations

import ctypes
import os
import sys

_PR_SET_CHILD_SUBREAPER = 36


def _set_child_subreaper():
    """Set this process as a child subreaper; returns True on success."""
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl(_PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
        return True
    except (OSError, AttributeError):
        return False


def run(argv):
    """Fork/exec ``argv``, reap it and its orphans, return the child's status.

    ``argv`` is the command and its arguments (already stripped of the ``--``).
    """
    if not argv:
        raise SystemExit("reaper: no command after --")
    _set_child_subreaper()
    pid = os.fork()
    if pid == 0:
        try:
            os.execvp(argv[0], list(argv))
        except OSError as exc:
            os.write(2, ("reaper: cannot exec %s: %s\n" % (argv[0], exc)).encode())
            os._exit(127)
    rc = 1
    while True:
        wpid, status = os.wait()
        if wpid == pid:
            if os.WIFEXITED(status):
                rc = (status >> 8) & 0xFF
            else:
                rc = 128 + os.WTERMSIG(status)
            break
    # Reap any orphans that have already exited, then stop.
    while True:
        try:
            wpid, _status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            break
        if wpid == 0:
            break
    return rc


def main(argv):
    """CLI entry: expects ``-- <command...>``."""
    if "--" in argv:
        cmd = argv[argv.index("--") + 1:]
    else:
        cmd = argv
    return run(cmd)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
