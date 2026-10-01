#!/usr/bin/env python3
"""Linux Site launcher: reap only this EDA job's descendants, including double forks.

Invoke inside edarun, before bash/the tool. Shared container PID1 is never changed.
PR_SET_CHILD_SUBREAPER semantics: https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html
"""
import ctypes
import os
import signal
import sys
import time

GRACE_SECONDS = 2.0
KILL_SECONDS = 5.0


def children():
    with open('/proc/self/task/{}/children'.format(os.getpid())) as stream:
        return [int(pid) for pid in stream.read().split()]


def main(argv):
    if not argv:
        print('eda-job-reaper: command required', file=sys.stderr)
        return 2
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        print('eda-job-reaper: subreaper unavailable: {}'.format(os.strerror(ctypes.get_errno())), file=sys.stderr)
        return 125
    primary = None
    primary_status = None
    received = []
    forwarded_signals = (signal.SIGHUP, signal.SIGINT, signal.SIGTERM)

    def forward(sig, _frame):
        received.append(sig)

    for sig in forwarded_signals:
        signal.signal(sig, forward)
    # The fork child must never run the inherited handler with primary == 0.
    old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, forwarded_signals)
    ready_read, ready_write = os.pipe()
    primary = os.fork()
    if primary == 0:
        os.close(ready_read)
        for sig in forwarded_signals:
            signal.signal(sig, signal.SIG_DFL)
        os.setsid()
        os.write(ready_write, b'1')
        os.close(ready_write)
        signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
        try:
            os.execvp(argv[0], argv)
        except OSError as error:
            print('eda-job-reaper: {}'.format(error), file=sys.stderr)
            os._exit(127 if error.errno == 2 else 126)

    os.close(ready_write)
    os.read(ready_read, 1)
    os.close(ready_read)
    signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
    cleanup_started = None
    while True:
        while True:
            # Atomically stop group forwarding before releasing a reaped PID/PGID.
            old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, forwarded_signals)
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
                if pid == primary:
                    primary_status = status
                    cleanup_started = time.monotonic()
            except ChildProcessError:
                pid = 0
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
            if pid == 0:
                break
        owned = children()
        if primary_status is not None and not owned:
            break
        # Deliver each incoming signal once. The ready pipe establishes the group.
        old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, forwarded_signals)
        pending, received[:] = list(received), []
        signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
        for sig in pending:
            if primary_status is None:
                try:
                    os.killpg(primary, sig)
                except ProcessLookupError:
                    pass
            for pid in owned:
                try:
                    if primary_status is not None or os.getpgid(pid) != primary:
                        os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        if cleanup_started is not None:
            elapsed = time.monotonic() - cleanup_started
            if elapsed >= GRACE_SECONDS:
                for pid in owned:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            if elapsed >= GRACE_SECONDS + KILL_SECONDS:
                print('eda-job-reaper: descendants did not terminate: {}'.format(owned), file=sys.stderr)
                return 125
        time.sleep(0.02)
    if os.WIFSIGNALED(primary_status):
        return 128 + os.WTERMSIG(primary_status)
    return os.WEXITSTATUS(primary_status)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
