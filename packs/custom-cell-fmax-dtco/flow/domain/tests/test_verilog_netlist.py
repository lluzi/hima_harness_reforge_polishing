#!/usr/bin/env python3

import sys
import unittest
from pathlib import Path


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))

from verilog_netlist import (  # noqa: E402
    build_named_net_graph,
    generic_arity_census,
    parse_modules,
    top_assign_aliases,
)


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

    def test_positional_primitives_share_escaped_net_identity_with_assign_aliases(self):
        text = r'''module top(input a,output y);
  and g0(\out.path [0], \in.path [0], a);
  assign \alias.path [0] = \out.path [0];
  buf g1(y, \alias.path [0]);
endmodule
'''
        modules = parse_modules(text)
        aliases = top_assign_aliases(text, "top")
        self.assertEqual(aliases, ((r"\alias.path [0]", r"\out.path [0]"),))
        graph = build_named_net_graph(modules["top"], {
            "GEN_and2": {"A0": "input", "A1": "input", "Y": "output"},
            "GEN_buf1": {"A0": "input", "Y": "output"},
        }, aliases)
        self.assertEqual(
            graph.instances["g0"].conns["Y"],
            graph.instances["g1"].conns["A0"],
        )


if __name__ == "__main__":
    unittest.main()
