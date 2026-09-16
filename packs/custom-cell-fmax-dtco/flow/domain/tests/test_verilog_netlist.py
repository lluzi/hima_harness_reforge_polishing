#!/usr/bin/env python3

import sys
import unittest
from pathlib import Path


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))

from verilog_netlist import generic_arity_census, parse_modules  # noqa: E402


class YosysInternalCellTests(unittest.TestCase):
    def test_named_yosys_internal_gates_use_the_existing_generic_contract(self):
        text = r'''module top(input a,b,output y);
  \$_XOR_ u0 (.A(a), .B(b), .Y(n0));
  \$_NOT_ u1 (.A(n0), .Y(y));
  \$_DFF_P_ state (.C(clk), .D(y), .Q(q));
endmodule
'''
        modules = parse_modules(text)
        self.assertEqual(
            [(row.cell_type, row.name) for row in modules["top"]],
            [("GEN_xor2", "u0"), ("GEN_not1", "u1"), (r"\$_DFF_P_", "state")],
        )
        self.assertEqual(
            generic_arity_census(modules), {"GEN_not1": 1, "GEN_xor2": 1}
        )
        self.assertEqual(modules["top"][0].conns, {"A0": "a", "A1": "b", "Y": "n0"})


if __name__ == "__main__":
    unittest.main()
