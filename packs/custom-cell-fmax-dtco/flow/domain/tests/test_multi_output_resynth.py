#!/usr/bin/env python3

import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))

from multi_output_resynth.netlist_eco import rollback_text  # noqa: E402
from multi_output_resynth.proof import write_cell_models  # noqa: E402
from multi_output_resynth.service import run_request  # noqa: E402
from innovus_ccei import build_ccei_plan, render_apply_tcl, render_rollback_tcl  # noqa: E402
from cell_need_miner.liberty import parse_skeleton  # noqa: E402


LIBERTY = '''library(test) {
cell (XOR2) {
  area : 1.0;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(Y) {
    direction : output;
    function : "A ^ B";
  }
}
cell (AND2) {
  area : 1.0;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(Y) {
    direction : output;
    function : "A * B";
  }
}
cell (OR2) {
  area : 1.0;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(Y) {
    direction : output;
    function : "A + B";
  }
}
cell (MO_HA) {
  area : 1.5;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(S) {
    direction : output;
    function : "A ^ B";
  }
  pin(C) {
    direction : output;
    function : "A * B";
  }
}
cell (MO_ANDOR) {
  area : 1.5;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(P) {
    direction : output;
    function : "A * B";
  }
  pin(Q) {
    direction : output;
    function : "A + B";
  }
}
cell (INV) {
  area : 0.5;
  pin(A) {
    direction : input;
  }
  pin(Y) {
    direction : output;
    function : "!A";
  }
}
cell (XOR3) {
  area : 2.0;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(C) {
    direction : input;
  }
  pin(Y) {
    direction : output;
    function : "A ^ B ^ C";
  }
}
cell (MAJ3) {
  area : 2.0;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(C) {
    direction : input;
  }
  pin(Y) {
    direction : output;
    function : "A * B + A * C + B * C";
  }
}
cell (MO_FA) {
  area : 3.0;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(CI) {
    direction : input;
  }
  pin(S) {
    direction : output;
    function : "A ^ B ^ CI";
  }
  pin(CO) {
    direction : output;
    function : "A * B + A * CI + B * CI";
  }
}
cell (MO_THREE) {
  area : 2.0;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(P) {
    direction : output;
    function : "A * B";
  }
  pin(Q) {
    direction : output;
    function : "A + B";
  }
  pin(R) {
    direction : output;
    function : "A ^ B";
  }
}
cell (MO_DEEP) {
  area : 2.5;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(C) {
    direction : input;
  }
  pin(P) {
    direction : output;
    function : "(A * B) ^ C";
  }
  pin(Q) {
    direction : output;
    function : "(A + B) * C";
  }
}
cell (MO4) {
  area : 3.5;
  pin(A) {
    direction : input;
  }
  pin(B) {
    direction : input;
  }
  pin(C) {
    direction : input;
  }
  pin(D) {
    direction : input;
  }
  pin(P) {
    direction : output;
    function : "A * B * C * D";
  }
  pin(Q) {
    direction : output;
    function : "!(A * B * C * D)";
  }
}
cell (DFF) {
  ff (IQ, IQN) {
    next_state : "D";
    clocked_on : "CK";
  }
  pin(D) {
    direction : input;
  }
  pin(CK) {
    direction : input;
  }
  pin(Q) {
    direction : output;
  }
}
}
'''


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Workspace:
    def __init__(self, case, netlist, allowed=("MO_HA",), operation="directed", action="analyze"):
        self.case = case
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.netlist = self.root / "input.v"
        self.liberty = self.root / "cells.lib"
        self.request = self.root / "request.json"
        self.result = self.root / "result.json"
        self.netlist.write_text(netlist)
        self.liberty.write_text(LIBERTY)
        request = {
            "schema": "hima.multi-output-resynthesis-request/1",
            "operation": operation,
            "action": action,
            "top": "top",
            "netlist": {"path": "input.v", "sha256": digest(self.netlist)},
            "library": {
                "liberty": {"path": "cells.lib", "sha256": digest(self.liberty)},
                "allowedMultiOutputMasters": list(allowed),
            },
            "scope": {
                "maxInputs": 3,
                "maxOutputs": 2,
                "maxReplacements": 50,
                "maxBucketSize": 256,
                "preserveRegisters": True,
                "preservePorts": True,
                "preserveHierarchy": True,
            },
            "targets": [],
            "physicalContext": {"def": None},
            "tools": {},
            "outputDir": "out",
        }
        self.data = request

    def write(self):
        self.request.write_text(json.dumps(self.data, indent=2))
        return run_request(self.request, self.result)

    def close(self):
        self.temp.cleanup()


HA = '''module top(input a, input b, output sum, output carry);
  XOR2 u_sum (.A(a), .B(b), .Y(sum));
  AND2 u_carry (.A(a), .B(b), .Y(carry));
endmodule
'''


class MultiOutputResynthTests(unittest.TestCase):
    def test_anchored_rediscovers_renamed_function_and_excludes_outside_decoy(self):
        netlist = '''module top(input a, input b, output sum, output carry, output p, output q);
  XOR2 renamed_sum (.A(a), .B(b), .Y(sum));
  AND2 renamed_carry (.A(a), .B(b), .Y(carry));
  XOR2 decoy_sum (.A(a), .B(b), .Y(p));
  AND2 decoy_carry (.A(a), .B(b), .Y(q));
endmodule
'''
        work = Workspace(self, netlist, operation="anchored")
        self.addCleanup(work.close)
        work.data["anchorHints"] = [{
            "module": "top", "seedInstances": ["old_sum", "old_carry"],
            "stableNets": ["sum", "carry"], "maxTraceHops": 1,
            "postrouteOpportunityId": "post-opp-1",
            "candidateRegionHimaIds": ["hima:region-1"],
        }]
        result = work.write()
        self.assertEqual(result["status"], "succeeded", result)
        self.assertEqual(result["backend"]["actual"], "native_v1")
        selected = result["selectedReplacements"]
        self.assertEqual(len(selected), 1)
        self.assertEqual(set(selected[0]["sourceInstances"]), {"renamed_sum", "renamed_carry"})
        self.assertTrue(selected[0]["anchorEvidence"]["reboundInPlaceState"])

        plan = build_ccei_plan(
            netlist_text=netlist, top="top", checkpoint="place.enc.dat",
            output_checkpoint="ccei.enc", opportunities=selected,
            place_instances={
                "renamed_sum": {"x": 10.0, "y": 20.0, "orientation": "R0"},
                "renamed_carry": {"x": 14.0, "y": 20.0, "orientation": "R0"},
            }, power_net="VDD", ground_net="VSS", power_pin="VDD", ground_pin="VSS",
        )
        apply = render_apply_tcl(plan, "apply.place.rpt")
        rollback = render_rollback_tcl(plan, "rollback.enc", "rollback.place.rpt")
        self.assertIn("-loc {12.000000 20.000000}", apply)
        self.assertIn("deleteInst {renamed_sum}", apply)
        self.assertIn("attachTerm {HIMA_MO_", apply)
        self.assertIn("ecoPlace -fixPlacedInsts true", apply)
        self.assertIn("addInst -cell {XOR2} -inst {renamed_sum}", rollback)

    def test_hal_fallback_is_explicit_and_absent_anchor_fails_closed(self):
        work = Workspace(self, HA, operation="anchored")
        self.addCleanup(work.close)
        work.data["backend"] = "hal_v0"
        work.data["allowNativeFallback"] = True
        work.data["anchorHints"] = [{"module": "top", "seedInstances": ["u_sum"],
                                     "stableNets": ["sum", "carry"], "maxTraceHops": 1}]
        with mock.patch("multi_output_resynth.hal_backend.shutil.which", return_value=None):
            result = work.write()
        self.assertEqual(result["status"], "succeeded", result)
        self.assertEqual(result["backend"]["requested"], "hal_v0")
        self.assertEqual(result["backend"]["actual"], "native_v1")
        self.assertFalse(result["backend"]["fallback"]["available"])

        missed = Workspace(self, HA, operation="anchored")
        self.addCleanup(missed.close)
        missed.data["anchorHints"] = [{"module": "top", "seedInstances": ["gone"],
                                       "stableNets": ["missing"], "maxTraceHops": 1}]
        refusal = missed.write()
        self.assertEqual(refusal["status"], "refused")
        self.assertEqual(refusal["refusal"]["code"], "anchor-rebind-miss")

    def test_directed_four_input_vector_is_supported(self):
        netlist = '''module top(input a, input b, input c, input d, output p, output q);
  AND2 u0 (.A(a), .B(b), .Y(n0));
  AND2 u1 (.A(c), .B(d), .Y(n1));
  AND2 u2 (.A(n0), .B(n1), .Y(p));
  INV u3 (.A(p), .Y(q));
endmodule
'''
        work = Workspace(self, netlist, allowed=("MO4",))
        self.addCleanup(work.close)
        work.data["scope"]["maxInputs"] = 4
        work.data["targets"] = [{
            "module": "top", "instances": ["u0", "u1", "u2", "u3"],
            "expectedBoundaryInputs": ["a", "b", "c", "d"],
            "expectedBoundaryOutputs": ["p", "q"],
        }]
        result = work.write()
        self.assertEqual("succeeded", result["status"], result)
        self.assertEqual("MO4", result["selectedReplacements"][0]["master"])

    def test_directed_non_fa_vector_is_matched_from_library_functions(self):
        netlist = '''module top(input a, input b, output p, output q);
  AND2 u0 (.A(a), .B(b), .Y(p));
  OR2 u1 (.A(a), .B(b), .Y(q));
endmodule
'''
        work = Workspace(self, netlist, allowed=("MO_ANDOR",))
        self.addCleanup(work.close)
        work.data["targets"] = [{
            "module": "top", "instances": ["u0", "u1"],
            "expectedBoundaryInputs": ["a", "b"],
            "expectedBoundaryOutputs": ["p", "q"],
        }]
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["selectedReplacements"][0]["master"], "MO_ANDOR")
        self.assertEqual(result["selectedReplacements"][0]["windowProof"]["status"], "proved")
        self.assertFalse(result["claimLimits"]["fmaxImprovement"])

    def test_truth_vector_tamper_is_refused(self):
        work = Workspace(self, HA, allowed=("MO_ANDOR",))
        self.addCleanup(work.close)
        work.data["targets"] = [{
            "module": "top", "instances": ["u_sum", "u_carry"],
            "expectedBoundaryInputs": ["a", "b"],
            "expectedBoundaryOutputs": ["carry", "sum"],
        }]
        result = work.write()
        self.assertEqual(result["status"], "refused")
        self.assertEqual(result["refusal"]["code"], "no-library-vector-match")
        self.assertIsNone(result["rewrittenNetlist"])

    @mock.patch("multi_output_resynth.service.prove_top_equivalence")
    def test_rewrite_is_allowed_only_after_top_proof_and_rolls_back_exactly(self, proof):
        proof.return_value = {
            "schema": "hima.multi-output-equivalence-proof/1",
            "backend": "test-double-for-yosys-adapter",
            "status": "proved",
        }
        work = Workspace(self, HA, action="rewrite")
        self.addCleanup(work.close)
        work.data["targets"] = [{
            "module": "top", "instances": ["u_sum", "u_carry"],
            "expectedBoundaryInputs": ["a", "b"],
            "expectedBoundaryOutputs": ["carry", "sum"],
        }]
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        rewritten = Path(result["rewrittenNetlist"]["path"]).read_text()
        self.assertIn("MO_HA HIMA_MO_", rewritten)
        self.assertNotIn("XOR2 u_sum", rewritten)
        manifest = json.loads(Path(result["patchManifest"]["path"]).read_text())
        self.assertEqual(rollback_text(rewritten, manifest), HA)
        proof.assert_called_once()

    def test_missing_yosys_refuses_changed_rewrite_without_publishing_it(self):
        work = Workspace(self, HA, action="rewrite")
        self.addCleanup(work.close)
        work.data["tools"]["yosys"] = str(work.root / "absent-yosys")
        work.data["targets"] = [{
            "module": "top", "instances": ["u_sum", "u_carry"],
            "expectedBoundaryInputs": ["a", "b"],
            "expectedBoundaryOutputs": ["carry", "sum"],
        }]
        result = work.write()
        self.assertEqual(result["status"], "refused")
        self.assertEqual(result["refusal"]["code"], "ProofError")
        self.assertIsNone(result["rewrittenNetlist"])

    def test_no_multioutput_library_produces_identity_rewrite(self):
        work = Workspace(self, HA, allowed=(), operation="discover", action="rewrite")
        self.addCleanup(work.close)
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["rewrittenNetlist"]["sha256"], digest(work.netlist))
        proof = json.loads(Path(result["equivalenceProof"]["path"]).read_text())
        self.assertEqual(proof["backend"], "identity-sha256")

    def test_discovery_uses_library_function_hash_join(self):
        def exercise(count):
            ports = ["input a%d, input b%d, output s%d, output c%d" % (i, i, i, i) for i in range(count)]
            instances = []
            for i in range(count):
                instances.extend([
                    "  XOR2 sx%d (.A(a%d), .B(b%d), .Y(s%d));" % (i, i, i, i),
                    "  AND2 cy%d (.A(a%d), .B(b%d), .Y(c%d));" % (i, i, i, i),
                ])
            netlist = "module top(%s);\n%s\nendmodule\n" % (", ".join(ports), "\n".join(instances))
            work = Workspace(self, netlist, operation="discover")
            self.addCleanup(work.close)
            return work.write()

        small = exercise(2)
        large = exercise(20)
        self.assertEqual(small["status"], "succeeded")
        self.assertEqual(large["status"], "succeeded")
        self.assertEqual(len(large["opportunities"]), 20)
        self.assertEqual(large["mapping"]["pairChecks"], 10 * small["mapping"]["pairChecks"])
        self.assertEqual(large["mapping"]["hashHits"], 10 * small["mapping"]["hashHits"])

    def test_discovery_composes_bounded_multi_level_cuts(self):
        netlist = '''module top(input a, input b, input c, output p, output q);
  AND2 a0 (.A(a), .B(b), .Y(n0));
  XOR2 a1 (.A(n0), .B(c), .Y(p));
  OR2 b0 (.A(a), .B(b), .Y(n1));
  AND2 b1 (.A(n1), .B(c), .Y(q));
endmodule
'''
        work = Workspace(self, netlist, allowed=("MO_DEEP",), operation="discover")
        self.addCleanup(work.close)
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(len(result["selectedReplacements"]), 1)
        replacement = result["selectedReplacements"][0]
        self.assertEqual(replacement["master"], "MO_DEEP")
        self.assertEqual(set(replacement["sourceInstances"]), {"a0", "a1", "b0", "b1"})
        self.assertEqual(replacement["orderedLeaves"], ["a", "b", "c"])

    def test_eight_bit_ripple_fixture_selects_eight_multioutput_full_adders(self):
        ports = ["input cin", "output cout"]
        ports.extend("input a%d, input b%d, output s%d" % (i, i, i) for i in range(8))
        instances = []
        for i in range(8):
            carry_in = "cin" if i == 0 else "c%d" % i
            carry_out = "cout" if i == 7 else "c%d" % (i + 1)
            instances.extend([
                "  XOR3 sx%d (.A(a%d), .B(b%d), .C(%s), .Y(s%d));" % (i, i, i, carry_in, i),
                "  MAJ3 cy%d (.A(a%d), .B(b%d), .C(%s), .Y(%s));" % (i, i, i, carry_in, carry_out),
            ])
        netlist = "module top(%s);\n%s\nendmodule\n" % (", ".join(ports), "\n".join(instances))
        work = Workspace(self, netlist, allowed=("MO_FA",), operation="discover")
        self.addCleanup(work.close)
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(len(result["selectedReplacements"]), 8)
        self.assertTrue(all(row["master"] == "MO_FA" for row in result["selectedReplacements"]))

    def test_bucket_overflow_is_recorded_without_pair_enumeration(self):
        work = Workspace(self, HA, operation="discover")
        self.addCleanup(work.close)
        work.data["scope"]["maxBucketSize"] = 1
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["mapping"]["pairChecks"], 0)
        self.assertTrue(result["mapping"]["bucketOverflows"])
        self.assertEqual(result["selectedReplacements"], [])

    def test_directed_three_output_window_is_exactly_matched(self):
        netlist = '''module top(input a, input b, output p, output q, output r);
  AND2 u0 (.A(a), .B(b), .Y(p));
  OR2 u1 (.A(a), .B(b), .Y(q));
  XOR2 u2 (.A(a), .B(b), .Y(r));
endmodule
'''
        work = Workspace(self, netlist, allowed=("MO_THREE",))
        self.addCleanup(work.close)
        work.data["scope"]["maxOutputs"] = 3
        work.data["targets"] = [{
            "module": "top", "instances": ["u0", "u1", "u2"],
            "expectedBoundaryInputs": ["a", "b"],
            "expectedBoundaryOutputs": ["p", "q", "r"],
        }]
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        row = result["selectedReplacements"][0]
        self.assertEqual(row["master"], "MO_THREE")
        self.assertEqual(len(row["outputPinToNet"]), 3)
        self.assertEqual(row["windowProof"]["assignments"], 4)

    def test_input_hash_drift_refuses_before_parsing(self):
        work = Workspace(self, HA, operation="discover")
        self.addCleanup(work.close)
        work.data["netlist"]["sha256"] = "0" * 64
        result = work.write()
        self.assertEqual(result["status"], "refused")
        self.assertEqual(result["refusal"]["code"], "input-hash-mismatch")

    def test_sequential_cells_become_formal_boundaries_in_yosys_models(self):
        work = Workspace(self, HA, operation="discover")
        self.addCleanup(work.close)
        cells = parse_skeleton(work.liberty)
        models = work.root / "models.v"
        write_cell_models(cells, models)
        text = models.read_text()
        self.assertIn("(* blackbox *) module DFF(D, CK, Q);", text)
        self.assertIn("input D, CK;", text)
        self.assertIn("output Q;", text)

    def test_hierarchical_target_module_is_distinct_from_proof_top(self):
        netlist = '''module leaf(input a, input b, output sum, output carry);
  XOR2 u_sum (.A(a), .B(b), .Y(sum));
  AND2 u_carry (.A(a), .B(b), .Y(carry));
endmodule
module top(input a, input b, output sum, output carry);
  leaf child (.a(a), .b(b), .sum(sum), .carry(carry));
endmodule
'''
        work = Workspace(self, netlist)
        self.addCleanup(work.close)
        work.data["targets"] = [{
            "module": "leaf", "instances": ["u_sum", "u_carry"],
            "expectedBoundaryInputs": ["a", "b"],
            "expectedBoundaryOutputs": ["carry", "sum"],
        }]
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["selectedReplacements"][0]["module"], "leaf")

    @mock.patch("multi_output_resynth.service.prove_hierarchical_equivalence")
    def test_one_rewrite_can_patch_two_leaf_modules_and_roll_back(self, proof):
        proof.return_value = {
            "schema": "hima.multi-output-equivalence-proof/1",
            "backend": "test-double-for-yosys-adapter",
            "status": "proved",
        }
        netlist = '''module leaf0(input a, input b, output sum, output carry);
  XOR2 x0 (.A(a), .B(b), .Y(sum));
  AND2 y0 (.A(a), .B(b), .Y(carry));
endmodule
module leaf1(input a, input b, output sum, output carry);
  XOR2 x0 (.A(a), .B(b), .Y(sum));
  AND2 y0 (.A(a), .B(b), .Y(carry));
endmodule
module top(input a, input b, output s0, output c0, output s1, output c1);
  leaf0 u0 (.a(a), .b(b), .sum(s0), .carry(c0));
  leaf1 u1 (.a(a), .b(b), .sum(s1), .carry(c1));
endmodule
'''
        work = Workspace(self, netlist, action="rewrite")
        self.addCleanup(work.close)
        work.data["targets"] = [
            {"module": "leaf0", "instances": ["x0", "y0"],
             "expectedBoundaryInputs": ["a", "b"],
             "expectedBoundaryOutputs": ["carry", "sum"]},
            {"module": "leaf1", "instances": ["x0", "y0"],
             "expectedBoundaryInputs": ["a", "b"],
             "expectedBoundaryOutputs": ["carry", "sum"]},
        ]
        result = work.write()
        self.assertEqual(result["status"], "succeeded")
        rewritten = Path(result["rewrittenNetlist"]["path"]).read_text()
        self.assertEqual(rewritten.count("MO_HA HIMA_MO_"), 2)
        manifest = json.loads(Path(result["patchManifest"]["path"]).read_text())
        self.assertEqual(manifest["modules"], ["leaf0", "leaf1"])
        self.assertEqual(rollback_text(rewritten, manifest), netlist)


if __name__ == "__main__":
    unittest.main()
