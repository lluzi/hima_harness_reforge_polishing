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
    VerilogNetlistError,
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

    def test_escaped_vector_tieoff_expands_to_bounded_constant_sources(self):
        text = r'''module top(output y);
  assign \register.file [31:0] = 32'd0;
  buf g0(y, \register.file [0]);
endmodule
'''
        modules = parse_modules(text)
        aliases = top_assign_aliases(text, "top")
        self.assertEqual(len(aliases), 32)
        self.assertEqual(aliases[0], (r"\register.file [31]", "1'b0"))
        self.assertEqual(aliases[-1], (r"\register.file [0]", "1'b0"))
        graph = build_named_net_graph(modules["top"], {
            "GEN_buf1": {"A0": "input", "Y": "output"},
        }, aliases)
        self.assertEqual(graph.instances["g0"].conns["A0"], "1'b0")
        primitive = parse_modules("""module primitive(input a, output y);
  and g0(y, 1'b0, a);
endmodule
""")["primitive"][0]
        self.assertEqual(primitive.conns["A0"], "1'b0")

        pattern = text.replace(
            r"\register.file [31:0] = 32'd0",
            r"\register.file [3:0] = 4'hA",
        )
        self.assertEqual(top_assign_aliases(pattern, "top"), (
            (r"\register.file [3]", "1'b1"),
            (r"\register.file [2]", "1'b0"),
            (r"\register.file [1]", "1'b1"),
            (r"\register.file [0]", "1'b0"),
        ))

        ascending = pattern.replace(
            r"\register.file [3:0] = 4'hA",
            r"\register.file [0:3] = 4'b1010",
        )
        self.assertEqual(top_assign_aliases(ascending, "top"), (
            (r"\register.file [0]", "1'b1"),
            (r"\register.file [1]", "1'b0"),
            (r"\register.file [2]", "1'b1"),
            (r"\register.file [3]", "1'b0"),
        ))

        direct_driver = text.replace(
            r"buf g0(y, \register.file [0]);",
            r"buf g0(\register.file [0], y);",
        )
        with self.assertRaisesRegex(
            VerilogNetlistError, "continuous assign nets also have direct cell drivers"
        ):
            build_named_net_graph(
                parse_modules(direct_driver)["top"],
                {"GEN_buf1": {"A0": "input", "Y": "output"}},
                top_assign_aliases(direct_driver, "top"),
            )

        overlap = text.replace(
            "endmodule",
            r"assign \register.file [1:0] = 2'd0;" + "\nendmodule",
        )
        with self.assertRaisesRegex(
            VerilogNetlistError, "multiple assign drivers"
        ):
            top_assign_aliases(overlap, "top")

        for statement in (
            r"assign \register.file [3:0] = 3'd0;",
            r"assign \register.file [3:0] = 4'd16;",
            r"assign \register.file [3:0] = 4'b00x0;",
            r"assign \register.file [3:0] = 0;",
            r"assign \register.file [3:0] = 4'sd0;",
            r"assign register_file = 1'b0;",
        ):
            with self.subTest(statement=statement):
                rejected = text.replace(
                    r"assign \register.file [31:0] = 32'd0;", statement
                )
                with self.assertRaisesRegex(
                    VerilogNetlistError, "unsupported continuous assign"
                ):
                    top_assign_aliases(rejected, "top")

    def test_bare_constant_lhs_requires_an_explicit_scalar_declaration(self):
        scalar = """module top(output alert_major_o);
  assign alert_major_o = 1'h0;
endmodule
"""
        self.assertEqual(
            top_assign_aliases(scalar, "top"), (("alert_major_o", "1'b0"),)
        )
        declared_later = """module top();
  output logic alert_minor_o;
  assign alert_minor_o = 1'b1;
endmodule
"""
        self.assertEqual(
            top_assign_aliases(declared_later, "top"), (("alert_minor_o", "1'b1"),)
        )
        for text in (
            """module top(output [3:0] bus);
  assign bus = 1'b0;
endmodule
""",
            """module top();
  assign implicit_net = 1'b0;
endmodule
""",
            """module top(output conflict);
  wire [3:0] conflict;
  assign conflict = 1'b0;
endmodule
""",
        ):
            with self.subTest(text=text):
                with self.assertRaisesRegex(
                    VerilogNetlistError, "unsupported continuous assign"
                ):
                    top_assign_aliases(text, "top")


if __name__ == "__main__":
    unittest.main()
