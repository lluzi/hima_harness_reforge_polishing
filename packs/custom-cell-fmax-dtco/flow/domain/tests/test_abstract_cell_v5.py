#!/usr/bin/env python3
"""V5 abstract Cell pin-access policy without invoking layout generation."""

import sys
import types
import unittest
from pathlib import Path


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))
sys.modules.setdefault("mock_char", types.SimpleNamespace())

from abstract_cell import select_staggered_pin_tracks  # noqa: E402


class AbstractCellV5Tests(unittest.TestCase):
    def test_pin_tracks_are_spread_low_middle_high_and_deterministic(self):
        tracks = list(range(100, 900, 100))
        selected = select_staggered_pin_tracks(tracks, 170, 50, 850, 50)
        self.assertEqual([200, 500, 700], selected)
        self.assertEqual(selected, select_staggered_pin_tracks(tracks, 170, 50, 850, 50))

    def test_pin_tracks_fail_when_pg_rails_leave_no_legal_access(self):
        with self.assertRaisesRegex(ValueError, "no M1 track"):
            select_staggered_pin_tracks([100, 200], 190, 50, 250, 80)


if __name__ == "__main__":
    unittest.main()
