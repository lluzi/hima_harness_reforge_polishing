"""Every Pack Python module compiles with warnings as errors (Issue #64 Task 7 fix round 1).

On the Site's Python 3.12 an invalid escape in a docstring (`\\``) printed a SyntaxWarning before the
XTop Operator's READY line on every wrapper start; a later Python makes it an error.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FLOW_DIR = Path(__file__).resolve().parent.parent
PACK_DIR = FLOW_DIR.parent
SOURCES = sorted([FLOW_DIR / "atcs_cli.py", *(FLOW_DIR / "atcs").glob("*.py"), *(FLOW_DIR / "tests").glob("*.py"),
                  *(PACK_DIR / "tools").glob("*.py")])

COMPILE = (
    "import py_compile, sys\n"
    "for i, path in enumerate(sys.argv[2:]):\n"
    "    py_compile.compile(path, cfile=f'{sys.argv[1]}/{i}.pyc', doraise=True)\n"
)


class SourceWarningTest(unittest.TestCase):
    def test_every_module_compiles_with_warnings_as_errors(self):
        self.assertGreater(len(SOURCES), 30)
        with tempfile.TemporaryDirectory() as out:
            result = subprocess.run([sys.executable, "-W", "error", "-c", COMPILE, out, *map(str, SOURCES)],
                                    capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
