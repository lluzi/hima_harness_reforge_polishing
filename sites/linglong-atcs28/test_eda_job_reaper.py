"""No-licence Linux process probe. Outer test subreaper prevents RED polluting PID1."""
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

REAPER = Path(__file__).with_name('eda-job-reaper.py')
ORPHAN = '''import os,sys,time,json
if os.fork():
    sys.exit(7)
os.setsid()
time.sleep(.15)
with open(sys.argv[1], 'w') as f:
    json.dump({'pid':os.getpid(),'ppid':os.getppid()}, f)
time.sleep(float(sys.argv[2]))
'''


@unittest.skipUnless(sys.platform == 'linux', 'Linux Site process semantics')
class ReaperProbe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) == 0

    def reap_outer(self):
        adopted = []
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return adopted
            if pid:
                adopted.append(pid)
            else:
                time.sleep(.02)
        self.fail('probe descendants remained')

    def orphan(self, wrapped, linger):
        with tempfile.TemporaryDirectory() as root:
            receipt = Path(root) / 'orphan.json'
            argv = [sys.executable, '-c', ORPHAN, str(receipt), str(linger)]
            if wrapped:
                argv = [sys.executable, str(REAPER)] + argv
            process = subprocess.Popen(argv)
            status = process.wait(timeout=10)
            adopted = self.reap_outer()
            return process.pid, status, json.loads(receipt.read_text()), adopted

    def test_red_plain_orphan_escapes_job_and_is_adopted_by_outer(self):
        _, status, receipt, adopted = self.orphan(False, .05)
        self.assertEqual(status, 7)
        self.assertEqual(receipt['ppid'], os.getpid())
        self.assertIn(receipt['pid'], adopted)

    def test_green_reaps_orphan_and_preserves_primary_status(self):
        pid, status, receipt, adopted = self.orphan(True, .05)
        self.assertEqual(status, 7)
        self.assertEqual(receipt['ppid'], pid)
        self.assertEqual(adopted, [])

    def test_green_bounds_detached_lingering_child_cleanup(self):
        pid, status, receipt, adopted = self.orphan(True, 60)
        self.assertEqual(status, 7)
        self.assertEqual(receipt['ppid'], pid)
        self.assertEqual(adopted, [])
        self.assertFalse(Path('/proc/{}'.format(receipt['pid'])).exists())

    def test_stdio_and_exit(self):
        result = subprocess.run([sys.executable, str(REAPER), 'bash', '-lc', 'read value; echo "$value"; echo err >&2; exit 9'], input=b'hello\n', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (9, b'hello\n', b'err\n'))

    def test_signals_forward_and_unrelated_process_survives(self):
        sibling = subprocess.Popen(['sleep', '60'])
        try:
            for sig in (signal.SIGHUP, signal.SIGTERM):
                process = subprocess.Popen([sys.executable, str(REAPER), sys.executable, '-c', 'import time; print("ready",flush=True); time.sleep(60)'], stdout=subprocess.PIPE)
                self.assertEqual(process.stdout.readline(), b'ready\n')
                process.send_signal(sig)
                self.assertEqual(process.wait(timeout=10), 128 + sig)
                process.stdout.close()
                self.assertIsNone(sibling.poll())
        finally:
            sibling.terminate()
            sibling.wait(timeout=5)
        self.assertEqual(self.reap_outer(), [])

    def test_one_signal_is_delivered_once_during_graceful_shutdown(self):
        code = '''import signal,time
count = [0]
def stop(sig, frame):
    count[0] += 1
signal.signal(signal.SIGTERM, stop)
print('ready', flush=True)
while not count[0]: time.sleep(.02)
time.sleep(.2)
print(count[0], flush=True)
'''
        process = subprocess.Popen([sys.executable, str(REAPER), sys.executable, '-c', code], stdout=subprocess.PIPE)
        self.assertEqual(process.stdout.readline(), b'ready\n')
        process.send_signal(signal.SIGTERM)
        out, _ = process.communicate(timeout=5)
        self.assertEqual((process.returncode, out), (0, b'1\n'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
