import pathlib
import sys
import tempfile
import textwrap
import unittest


MODULE_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_DIR))
sys.path.insert(0, str(MODULE_DIR.parent))

from liberty_timing import (  # noqa: E402
    LibertyTimingError,
    derive_timing_sense,
    analyze_mapped_netlist_reg2reg,
    evaluate_timing_arc,
    parse_liberty_timing,
    pin_load,
    propagate_reg2reg_path,
)


def table(name, rise):
    values = {
        "cell_rise": (rise, rise + 1.0, rise + 2.0, rise + 3.0),
        "cell_fall": (rise + 0.1, rise + 1.1, rise + 2.1, rise + 3.1),
        "rise_transition": (0.02, 0.04, 0.06, 0.08),
        "fall_transition": (0.03, 0.05, 0.07, 0.09),
    }[name]
    return f'''{name} (delay_template) {{
      values ("{values[0]}, {values[1]}", "{values[2]}, {values[3]}");
    }}'''


def cell(name="BUF", sense="positive_unate", rise=1.0, when=""):
    tables = "\n".join(table(name_, rise) for name_ in (
        "cell_rise", "cell_fall", "rise_transition", "fall_transition"
    ))
    return f'''cell ({name}) {{
      pin (A) {{ direction : input; capacitance : 0.02; }}
      pin (Y) {{
        direction : output;
        timing () {{
          related_pin : "A";
          timing_sense : {sense};
          {when}
          {tables}
        }}
      }}
    }}'''


def conditional_cell():
    def timing(condition, rise):
        tables = "\n".join(table(name, rise) for name in (
            "cell_rise", "cell_fall", "rise_transition", "fall_transition"
        ))
        return f'''timing () {{
          related_pin : "A";
          timing_sense : positive_unate;
          when : "{condition}";
          {tables}
        }}'''
    return f'''cell (COND) {{
      pin (A) {{ direction : input; capacitance : 0.02; }}
      pin (MODE) {{ direction : input; capacitance : 0.01; }}
      pin (Y) {{ direction : output;
        {timing("!MODE", 1.0)}
        {timing("MODE", 5.0)}
      }}
    }}'''


def derived_sense_cell(name, function):
    tables = "\n".join(table(table_name, 1.0) for table_name in (
        "cell_rise", "cell_fall", "rise_transition", "fall_transition"
    ))
    function_line = '' if function is None else f'function : "{function}";'
    return f'''cell ({name}) {{
      pin (A) {{ direction : input; capacitance : 0.02; }}
      pin (B) {{ direction : input; capacitance : 0.02; }}
      pin (Y) {{ direction : output; {function_line}
        timing () {{ related_pin : "A"; {tables} }}
      }}
    }}'''


def sequential_cell(name="DFF", kind="ff"):
    if kind == "ff":
        group = 'ff (IQ, IQN) { next_state : "D"; clocked_on : "CK"; }'
    else:
        group = 'latch (IQ, IQN) { data_in : "D"; enable : "CK"; }'
    return f'''cell ({name}) {{
      {group}
      pin (D) {{ direction : input; capacitance : 0.03; }}
      pin (CK) {{ direction : input; capacitance : 0.04; }}
      pin (Q) {{ direction : output; function : "IQ"; }}
      pin (QN) {{ direction : output; function : "IQN"; }}
    }}'''


def no_arc_cell():
    return '''cell (WIRE) {
      pin (A) { direction : input; capacitance : 0.02; }
      pin (Y) { direction : output; function : "A"; }
    }'''


def library(*cells):
    return '''library (unit_test) {
      time_unit : "1ns";
      capacitive_load_unit (1, pf);
      fanout_length(1, 0.0000)
      fanout_length(2, 0.1000);
      lu_table_template (one_dimensional_constraint) {
        variable_1 : related_pin_transition;
        index_1 ("0.01, 0.10");
      }
      lu_table_template (delay_template) {
        variable_1 : input_net_transition;
        variable_2 : total_output_net_capacitance;
        index_1 ("0.01, 0.10");
        index_2 ("0.10, 1.00");
      }
      %s
    }
    ''' % "\n".join(cells)


class LibertyTimingTests(unittest.TestCase):
    def parse(self, text, required=None):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / "fixture.lib"
            path.write_text(textwrap.dedent(text))
            return parse_liberty_timing(path, required)

    def test_public_timing_sense_derivation_is_exact_for_future_liberty_emission(self):
        self.assertEqual(derive_timing_sense("A * B", "A", ["A", "B"]), "positive_unate")
        self.assertEqual(derive_timing_sense("!(A * B)", "A", ["A", "B"]), "negative_unate")
        self.assertEqual(derive_timing_sense("A ^ B", "A", ["A", "B"]), "non_unate")
        with self.assertRaisesRegex(LibertyTimingError, "independent"):
            derive_timing_sense("B", "A", ["A", "B"])

    def test_parses_arc_pin_cap_and_bilinear_interpolation(self):
        model = self.parse(library(cell()), {"BUF"})
        self.assertEqual(model.time_unit, "1ns")
        self.assertEqual(model.capacitive_load_unit, "1pf")
        self.assertEqual(model.input_capacitance("BUF", "A"), 0.02)

        evaluated = evaluate_timing_arc(model, "BUF", "A", "Y", "rise", 0.055, 0.55)
        self.assertAlmostEqual(evaluated.delay.value, 2.5)
        self.assertAlmostEqual(evaluated.output_slew.value, 0.05)
        self.assertFalse(evaluated.delay.clamped)
        self.assertEqual(evaluated.output_transition, "rise")
        self.assertNotIn("conditional_policy", evaluated.as_dict())

    def test_required_cell_filter_skips_irrelevant_cell_bodies(self):
        irrelevant = '''cell (IRRELEVANT) {
          pin (A) { direction : input; capacitance : 0.1; }
          deliberately_unsupported { nested_group(foo) { value : 1; } }
        }'''
        model = self.parse(library(irrelevant, cell()), {"BUF"})
        self.assertEqual(list(model.cells), ["BUF"])

    def test_interpolation_clamps_each_axis_and_never_extrapolates(self):
        model = self.parse(library(cell()), {"BUF"})
        evaluated = evaluate_timing_arc(model, "BUF", "A", "Y", "rise", 0.001, 2.0)
        self.assertAlmostEqual(evaluated.delay.value, 2.0)
        self.assertEqual(evaluated.delay.clamped_slew, "low")
        self.assertEqual(evaluated.delay.clamped_load, "high")
        self.assertFalse(evaluated.delay.as_dict()["extrapolated"])
        with self.assertRaisesRegex(LibertyTimingError, "non-negative"):
            evaluate_timing_arc(model, "BUF", "A", "Y", "rise", 0.01, -0.1)

    def test_interpolation_uses_declared_axis_meaning_instead_of_position(self):
        swapped = library(cell()).replace(
            "variable_1 : input_net_transition;\n        variable_2 : total_output_net_capacitance;\n"
            "        index_1 (\"0.01, 0.10\");\n        index_2 (\"0.10, 1.00\");",
            "variable_1 : total_output_net_capacitance;\n        variable_2 : input_net_transition;\n"
            "        index_1 (\"0.10, 1.00\");\n        index_2 (\"0.01, 0.10\");",
        )
        model = self.parse(swapped, {"BUF"})
        evaluated = evaluate_timing_arc(model, "BUF", "A", "Y", "rise", 0.01, 1.0)
        self.assertAlmostEqual(evaluated.delay.value, 3.0)

    def test_parses_multiline_seven_by_seven_nldm_tables(self):
        axis = ", ".join(str(value / 100.0) for value in range(1, 8))
        rows = []
        for row in range(7):
            rows.append('"%s"' % ", ".join(str(row * 7 + column) for column in range(7)))
        values = ", \\\n+              ".join(rows)
        tables = "\n".join(
            f'''{name} (delay_template) {{ values ( \\\n+              {values}); }}'''
            for name in ("cell_rise", "cell_fall", "rise_transition", "fall_transition")
        )
        text = f'''library (unit_test) {{
          time_unit : "1ns";
          capacitive_load_unit (1, pf);
          lu_table_template (delay_template) {{
            variable_1 : input_net_transition;
            variable_2 : total_output_net_capacitance;
            index_1 ("{axis}"); index_2 ("{axis}");
          }}
          cell (BUF7) {{
            pin (A) {{ direction : input; capacitance : 0.01; }}
            pin (Y) {{ direction : output; timing () {{
              related_pin : "A"; timing_sense : positive_unate; {tables}
            }} }}
          }}
        }}'''
        model = self.parse(text, {"BUF7"})
        parsed = model.arc("BUF7", "A", "Y").tables["cell_rise"]
        self.assertEqual((len(parsed.index_1), len(parsed.index_2)), (7, 7))
        self.assertEqual(parsed.interpolate(0.04, 0.04).value, 24.0)

    def test_reg2reg_path_propagates_slew_transition_arrival_and_slack(self):
        model = self.parse(library(
            cell("INV", "negative_unate", 0.10),
            cell("BUF", "positive_unate", 0.20),
        ), {"INV", "BUF"})
        result = propagate_reg2reg_path(model, [
            {"instance": "u_inv", "cell": "INV", "related_pin": "A", "to_pin": "Y", "output_load": 0.10},
            {"instance": "u_buf", "cell": "BUF", "related_pin": "A", "to_pin": "Y", "output_load": 0.10},
        ], initial_transition="rise", initial_slew=0.01, required_time=1.0,
            uncertainty=0.1, launch_clock="clk", capture_clock="clk",
            endpoint_family="state_q->state_d")

        # INV fall delay is 0.2 at the first table point. Its 0.03 output
        # slew drives BUF between the first two slew rows, producing
        # 0.744444... delay at the minimum load.
        self.assertAlmostEqual(result["arrival"], 0.9444444444444444)
        self.assertAlmostEqual(result["required"], 0.9)
        self.assertAlmostEqual(result["slack"], -0.0444444444444444)
        self.assertEqual(result["output_transition"], "fall")
        self.assertEqual([row["instance"] for row in result["path"]], ["u_inv", "u_buf"])
        self.assertAlmostEqual(pin_load(model, [("INV", "A"), ("BUF", "A")], 0.01), 0.05)

    def test_mapped_netlist_sta_discovers_ff_boundaries_and_propagates_graph(self):
        model = self.parse(library(sequential_cell(), cell()), {"DFF", "BUF"})
        ff = model.cell("DFF")
        self.assertEqual(
            (ff.sequential_kind, ff.data_pin, ff.clock_pin, ff.clock_polarity, ff.sequential_outputs),
            ("ff", "D", "CK", "positive", ("Q", "QN")),
        )
        netlist = '''module top(input clk, seed, output observed);
          DFF launch (.D(seed), .CK(clk), .Q(q0));
          BUF logic0 (.A(q0), .Y(n0));
          DFF capture (.D(n0), .CK(clk), .Q(observed));
        endmodule
        '''
        result = analyze_mapped_netlist_reg2reg(
            model, netlist, "top", clock_period=1.0, uncertainty=0.1,
            initial_slew=0.01,
        )
        self.assertEqual(result["clock_net"], "clk")
        self.assertEqual(result["path_count"], 1)
        self.assertAlmostEqual(result["worst_delay"], 1.1)
        self.assertAlmostEqual(result["worst_slack"], -0.2)
        self.assertAlmostEqual(result["negative_slack_mass"], 0.2)
        self.assertAlmostEqual(result["negative_slack_by_endpoint_family"]["capture/D"], 0.2)
        self.assertEqual(result["paths"][0]["launchpoint"], "launch/Q")
        self.assertEqual(result["paths"][0]["endpoint"], "capture/D")
        self.assertEqual(result["paths"][0]["stages"][0]["instance"], "logic0")
        self.assertAlmostEqual(result["paths"][0]["stages"][0]["output_load"], 0.03)

    def test_mapped_netlist_sta_rejects_multiple_clocks_loops_and_unknown_cells(self):
        model = self.parse(library(sequential_cell(), cell()), {"DFF", "BUF"})
        two_clocks = '''module top(input clk_a,clk_b,seed,output q1);
          DFF launch(.D(seed),.CK(clk_a),.Q(q0));
          BUF logic0(.A(q0),.Y(n0));
          DFF capture(.D(n0),.CK(clk_b),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "one explicit clock net"):
            analyze_mapped_netlist_reg2reg(model, two_clocks, "top", clock_period=1.0)

        loop = '''module top(input clk,seed,output q1);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          BUF logic0(.A(n1),.Y(n0));
          BUF logic1(.A(n0),.Y(n1));
          DFF capture(.D(n0),.CK(clk),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "combinational loop"):
            analyze_mapped_netlist_reg2reg(model, loop, "top", clock_period=1.0)

        unknown = two_clocks.replace("BUF logic0", "UNKNOWN logic0").replace("clk_b", "clk")
        with self.assertRaisesRegex(LibertyTimingError, "unknown cell UNKNOWN"):
            analyze_mapped_netlist_reg2reg(model, unknown, "top", clock_period=1.0)

        ambiguous = '''module top(input clk,seed,output q1);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          BUF logic0(.A(q0),.Y(n0));
          BUF logic1(.A(q0),.Y(n0));
          DFF capture(.D(n0),.CK(clk),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "ambiguous drivers"):
            analyze_mapped_netlist_reg2reg(model, ambiguous, "top", clock_period=1.0)

        no_arc_model = self.parse(
            library(sequential_cell(), no_arc_cell()), {"DFF", "WIRE"}
        )
        no_arc = '''module top(input clk,seed,output q1);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          WIRE logic0(.A(q0),.Y(n0));
          DFF capture(.D(n0),.CK(clk),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "without timing arcs"):
            analyze_mapped_netlist_reg2reg(no_arc_model, no_arc, "top", clock_period=1.0)

    def test_simple_assign_alias_preserves_the_worst_two_buffer_path(self):
        model = self.parse(library(sequential_cell(), cell()), {"DFF", "BUF"})
        netlist = '''module top(input clk,seed,output q_fast,q_slow);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          BUF direct(.A(q0),.Y(fast));
          BUF first(.A(q0),.Y(alias_source));
          assign alias_sink = alias_source;
          BUF second(.A(alias_sink),.Y(slow));
          DFF capture_fast(.D(fast),.CK(clk),.Q(q_fast));
          DFF capture_slow(.D(slow),.CK(clk),.Q(q_slow));
        endmodule'''
        result = analyze_mapped_netlist_reg2reg(model, netlist, "top", clock_period=2.0)
        self.assertEqual(result["net_aliases"], [["alias_sink", "alias_source"]])
        self.assertEqual(result["path_count"], 2)
        self.assertEqual(result["paths"][0]["endpoint"], "capture_slow/D")
        self.assertEqual(
            [stage["instance"] for stage in result["paths"][0]["stages"]],
            ["first", "second"],
        )
        self.assertAlmostEqual(result["worst_delay"], 2.6444444444444444)

    def test_assign_cycles_expressions_and_driver_merges_fail_closed(self):
        model = self.parse(library(sequential_cell(), cell()), {"DFF", "BUF"})
        cycle = '''module top(input clk,seed,output q1);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          assign a = b;
          assign b = a;
          BUF logic0(.A(q0),.Y(n0));
          DFF capture(.D(n0),.CK(clk),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "alias cycle"):
            analyze_mapped_netlist_reg2reg(model, cycle, "top", clock_period=1.0)

        expression = cycle.replace("assign a = b;\n          assign b = a;", "assign a = b & q0;")
        with self.assertRaisesRegex(LibertyTimingError, "unsupported continuous assign"):
            analyze_mapped_netlist_reg2reg(model, expression, "top", clock_period=1.0)

        drivers = '''module top(input clk,seed,output q1);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          BUF logic0(.A(q0),.Y(n0));
          BUF logic1(.A(q0),.Y(n1));
          assign n0 = n1;
          DFF capture(.D(n0),.CK(clk),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "direct cell drivers"):
            analyze_mapped_netlist_reg2reg(model, drivers, "top", clock_period=1.0)

        assigned_lhs_driver = '''module top(input clk,seed,output q1);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          BUF logic0(.A(q0),.Y(n0));
          assign n0 = seed;
          DFF capture(.D(n0),.CK(clk),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "also have direct cell drivers"):
            analyze_mapped_netlist_reg2reg(model, assigned_lhs_driver, "top", clock_period=1.0)

    def test_latch_boundary_is_identified_but_time_borrowing_fails_closed(self):
        model = self.parse(library(sequential_cell("LAT", "latch"), cell()), {"LAT", "BUF"})
        latch = model.cell("LAT")
        self.assertEqual((latch.sequential_kind, latch.data_pin, latch.clock_pin), ("latch", "D", "CK"))
        netlist = '''module top(input gate,seed,output q1);
          LAT launch(.D(seed),.CK(gate),.Q(q0));
          BUF logic0(.A(q0),.Y(n0));
          LAT capture(.D(n0),.CK(gate),.Q(q1));
        endmodule'''
        with self.assertRaisesRegex(LibertyTimingError, "latch time borrowing"):
            analyze_mapped_netlist_reg2reg(model, netlist, "top", clock_period=1.0)

    def test_missing_arc_and_multi_clock_path_fail_closed(self):
        model = self.parse(library(cell()), {"BUF"})
        with self.assertRaisesRegex(LibertyTimingError, "no timing arc"):
            evaluate_timing_arc(model, "BUF", "B", "Y", "rise", 0.01, 0.1)
        with self.assertRaisesRegex(LibertyTimingError, "multi-clock"):
            propagate_reg2reg_path(model, [], initial_transition="rise", initial_slew=0.01,
                required_time=1.0, launch_clock="clk_a", capture_clock="clk_b")

    def test_conditional_arc_uses_reported_worst_case_without_sensitization_claim(self):
        model = self.parse(library(conditional_cell()), {"COND"})
        self.assertEqual(
            [arc.condition for arc in model.arcs("COND", "A", "Y")],
            ["!MODE", "MODE"],
        )
        evaluated = evaluate_timing_arc(model, "COND", "A", "Y", "rise", 0.01, 0.1)
        self.assertEqual(evaluated.delay.value, 5.0)
        self.assertEqual(evaluated.condition, "MODE")
        self.assertEqual(evaluated.conditional_policy, "worst_case_over_conditions")
        self.assertEqual(evaluated.alternative_conditions, ("!MODE", "MODE"))
        self.assertEqual(evaluated.as_dict()["condition"], "MODE")

        graph_model = self.parse(
            library(sequential_cell(), conditional_cell()), {"DFF", "COND"}
        )
        netlist = '''module top(input clk,seed,mode,output q1);
          DFF launch(.D(seed),.CK(clk),.Q(q0));
          COND logic0(.A(q0),.MODE(mode),.Y(n0));
          DFF capture(.D(n0),.CK(clk),.Q(q1));
        endmodule'''
        result = analyze_mapped_netlist_reg2reg(
            graph_model, netlist, "top", clock_period=10.0
        )
        stage = result["paths"][0]["stages"][0]
        self.assertEqual(stage["conditional_policy"], "worst_case_over_conditions")
        self.assertEqual(stage["condition"], "MODE")
        self.assertEqual(stage["alternative_conditions"], ["!MODE", "MODE"])

    def test_missing_timing_sense_is_derived_exactly_from_output_function(self):
        model = self.parse(library(
            derived_sense_cell("POS", "A + B"),
            derived_sense_cell("NEG", "!(A * B)"),
            derived_sense_cell("NON", "A ^ B"),
        ), {"POS", "NEG", "NON"})
        self.assertEqual(model.arc("POS", "A", "Y").timing_sense, "positive_unate")
        self.assertEqual(model.arc("NEG", "A", "Y").timing_sense, "negative_unate")
        self.assertEqual(model.arc("NON", "A", "Y").timing_sense, "non_unate")
        evaluated = evaluate_timing_arc(model, "POS", "A", "Y", "rise", 0.01, 0.1)
        self.assertEqual(evaluated.timing_sense_source, "derived_from_output_function")
        self.assertEqual(
            evaluated.as_dict()["timing_sense_source"],
            "derived_from_output_function",
        )
        declared = self.parse(library(cell()), {"BUF"})
        self.assertEqual(
            evaluate_timing_arc(declared, "BUF", "A", "Y", "rise", 0.01, 0.1)
            .timing_sense_source,
            "declared",
        )

    def test_timing_sense_derivation_fails_for_absent_unsupported_or_independent_function(self):
        cases = (
            (derived_sense_cell("ABSENT", None), "ABSENT", "function is absent"),
            (derived_sense_cell("UNSUPPORTED", "A ? B : 0"), "UNSUPPORTED", "unsupported output function"),
            (derived_sense_cell("INDEPENDENT", "B"), "INDEPENDENT", "independent of related pin"),
        )
        for cell_text, name, message in cases:
            with self.subTest(name=name):
                with self.assertRaisesRegex(LibertyTimingError, message):
                    self.parse(library(cell_text), {name})

    def test_malformed_table_fails_closed(self):
        malformed = library(cell()).replace(
            'values ("1.0, 2.0", "3.0, 4.0");',
            'values ("1.0, 2.0");',
            1,
        )
        with self.assertRaisesRegex(LibertyTimingError, "rows"):
            self.parse(malformed, {"BUF"})

    def test_required_cell_and_missing_pin_capacitance_fail_closed(self):
        with self.assertRaisesRegex(LibertyTimingError, "required Liberty cells are missing"):
            self.parse(library(cell()), {"BUF", "UNKNOWN"})
        missing_cap = library(cell()).replace("capacitance : 0.02;", "")
        with self.assertRaisesRegex(LibertyTimingError, "missing capacitance"):
            self.parse(missing_cap, {"BUF"})


if __name__ == "__main__":
    unittest.main()
