"""main #63 exact-target regression retained at the current Pack Reader seam.

The resident production graph does not produce next-decision documents. The shared
legacy Reader still does: targets copied from observation must remain exact,
including reserved async path-group keys. This uses current executable code.
"""
import json
import tempfile
import unittest
from pathlib import Path

from test_readers import read_atcs

ASYNC_KEY = "fast|hold|u_dbg/reg_0_@**async_default**"
PLAIN_KEY = "slow|setup|u_core/reg_0_"


class CurrentReaderTargetKeysTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = Path(self.tmp.name)

    def _problems(self, targets):
        found = read_atcs._collect_next_decision_problems({"action": "stop", "targets": targets}, self.workspace)
        return [text for text in found if text.startswith("targets[")]

    def _observe(self, keys):
        path = self.workspace / "state/observation.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"checks": {key: {} for key in keys}}))

    def test_exact_observation_keys_including_async_group_are_admitted(self):
        self._observe([ASYNC_KEY, PLAIN_KEY])
        self.assertEqual(self._problems([ASYNC_KEY, PLAIN_KEY]), [])

    def test_unobserved_keys_and_wildcards_are_counted_separately(self):
        self._observe([ASYNC_KEY])
        found = self._problems([ASYNC_KEY, PLAIN_KEY, "slow|setup|*"])
        self.assertEqual(len(found), 2)
        self.assertTrue(found[0].startswith("targets[1]"))
        self.assertTrue(found[1].startswith("targets[2]"))
        self.assertIn("is not a check key of state/observation.json", found[0])

    def test_without_observation_exact_key_form_has_a_success_path(self):
        self.assertEqual(self._problems([PLAIN_KEY, ASYNC_KEY]), [])
        self.assertEqual(len(self._problems(["slow", "slow|setup|*", "one failed endpoint"])), 3)
