"""Tests of the tools' openc910 mode (python3 -m unittest): every command against the synthetic
fixture bundle tests/fixtures/openc910-mini (invented names and numbers, the real bundle's schema),
and one smoke run against the Site's installed bundle when it is present."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "bin"
FIXTURE = ROOT / "tests" / "fixtures" / "openc910-mini"
REAL = ROOT / "share" / "designs" / "openc910"
BASE_ENV = {k: v for k, v in os.environ.items() if k != "CTU_OPENC910_DATA"}
FX_ENV = dict(BASE_ENV, CTU_MOCK_TIME_SCALE="0", CTU_OPENC910_DATA=str(FIXTURE))
REAL_ENV = dict(BASE_ENV, CTU_MOCK_TIME_SCALE="0")

A1, A2, A3, A4, A5, A6, A7, A8 = ("ND2D2X_A1_ZN_fall", "ND2D2X_A1_ZN_rise", "INVD4X_I_ZN_rise", "INVD4X_I_ZN_fall", "AOI21D1X_B_ZN_rise",
                                  "BUFFD8X_I_Z_fall", "XOR2D1X_A1_Z_rise", "XOR2D1X_A2_Z_fall")


def run(*argv, env=FX_ENV):
    return subprocess.run([str(BIN / argv[0]), *[str(a) for a in argv[1:]]], capture_output=True, text=True, env=env)


def ok(test, *argv, env=FX_ENV):
    out = run(*argv, env=env)
    test.assertEqual(out.returncode, 0, "%s\n%s" % (" ".join(map(str, argv)), out.stderr))
    return out


def load(path):
    return json.loads(Path(path).read_text())


def arcs_file(path, names):
    rows = []
    for n in names:
        cell, frm, to, edge = n.split("_")
        rows.append({"cell": cell, "from": frm, "to": to, "edge": edge})
    Path(path).write_text(json.dumps({"arcs": rows}))
    return path


def flow(test, t, env=FX_ENV):
    """The whole openc910 sequence: reference build, HimaTime, Qualib, AndesCell, cell check,
    screen of the kept cells, rebuild with them."""
    ok(test, "sapr", "run", "--design", "openc910", "--out", t / "ref", "--quiet", env=env)
    ok(test, "himatime", "load", "--db", t / "ref", "--out", t / "ht", "--quiet", env=env)
    ok(test, "himatime", "highvalue", "--db", t / "ref", "--out", t / "hv", "--quiet", env=env)
    out = ok(test, "himatime", "whatif", "--db", t / "ref", "--scale", "0.9", "--out", t / "wi", "--json", env=env)
    wi = json.loads(out.stdout)
    ok(test, "qualib", "analyze", "--db", t / "ref", "--arcs", t / "wi" / "whatif.json", "--out", t / "ql", "--quiet", env=env)
    (t / "arcs.json").write_text(json.dumps({"arcs": [{k: a[k] for k in ("cell", "from", "to", "edge")} for a in wi["merged"]]}))
    ok(test, "andescell", "generate", "--arcs", t / "arcs.json", "--round", "1", "--iterations", "50", "--scale", "0.9", "--out", t / "gen", "--quiet", env=env)
    ok(test, "himatime", "verify", "--cells", t / "gen", "--db", t / "ref", "--out", t / "vf", "--quiet", env=env)
    ok(test, "qualib", "screen", "--cells", t / "vf" / "kept", "--out", t / "sc", "--quiet", env=env)
    ok(test, "sapr", "run", "--design", "openc910", "--extra-lib", t / "vf" / "kept", "--out", t / "b1", "--quiet", env=env)
    return wi


class Fixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.t = Path(cls.tmp.name)
        cls.wi = flow(unittest.TestCase(), cls.t)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_reference_build_is_the_full_flow_at_route(self):
        s = load(self.t / "ref" / "sapr_summary.json")
        self.assertEqual((s["schema"], s["design"], s["build"], s["stage"], s["group"], s["clock"], s["clockPeriodNs"]),
                         ("ctu-sapr-summary/2", "openc910", "reference", "route", "reg2reg", "CORE_CLK", 0.4))
        self.assertEqual((s["wnsNs"], s["tnsNs"], s["nvp"], s["allPaths"]), (-0.03, -6.0, 150, 4800))
        self.assertEqual([(x["stage"], x["label"], x["wnsNs"]) for x in s["stages"]],
                         [("prePlace", "prePlace", -0.012), ("place_opt", "place_opt", -0.05), ("cts", "CTS", -0.036), ("route", "route", -0.03)])
        self.assertEqual([g["group"] for g in s["pathGroups"]], ["all", "reg2reg", "reg2cgate", "in2reg", "reg2out", "in2out", "default"])
        self.assertEqual(s["pathGroups"][5]["wnsNs"], None)
        self.assertEqual(s["groups"]["reg2out"]["wnsNs"], -0.08)
        self.assertEqual(s["clockTree"], dict(buffers=40, inverters=2, icgs=12, sinks=600, clockWireUm=1500.5))
        self.assertEqual((s["customCells"], s["customCellsPct"], s["basis"], s["instances"], s["power"]["totalMw"]), (0, 0.0, None, None, 15.1))
        self.assertEqual([p["endShort"] for p in s["worstPaths"]], ["dout_reg_7_", "dout_reg_9_", "dout_reg_3_"])
        names = sorted(p.name for p in (self.t / "ref" / "reports").iterdir())
        self.assertEqual(names, sorted(["prePlace.summary.rpt", "place.summary.rpt", "cts.summary.rpt", "route.summary.rpt", "place_reg2reg.tarpt",
                                        "cts_reg2reg.tarpt", "route_reg2reg.tarpt", "cts.sum.rpt", "place.power.rpt", "route.power.rpt",
                                        "place.congestion.rpt", "route.congestion.rpt", "flow_summary.rpt"]))
        flow_rpt = (self.t / "ref" / "reports" / "flow_summary.rpt").read_text()
        for word in ("prePlace", "place_opt", "CTS", "route"):
            self.assertIn(word, flow_rpt)
        self.assertEqual(run("sapr", "run", "--design", "openc910", "--out", self.t / "ref").returncode, 2, "non-empty out refused")

    def test_custom_build_takes_cts_and_route_from_the_carried_forward_data(self):
        r, c = load(self.t / "ref" / "sapr_summary.json"), load(self.t / "b1" / "sapr_summary.json")
        self.assertEqual((c["build"], c["wnsNs"], c["tnsNs"], c["nvp"], c["customCells"], c["customCellsPct"]), ("custom", -0.025, -4.32, 105, 440, 8.8))
        self.assertEqual([x["wnsNs"] for x in c["stages"]], [-0.012, -0.046, -0.032, -0.025])
        self.assertTrue(c["basis"])
        self.assertIsNone(c["overflowPct"])
        self.assertEqual(c["clockTree"]["buffers"], 38)
        self.assertEqual([(p["slackNs"], p["referenceSlackNs"]) for p in c["worstPaths"]], [(-0.025, -0.03), (-0.023, -0.028), (-0.022, -0.027)])
        self.assertEqual(round(100 * (c["wnsNs"] - r["wnsNs"]) / r["clockPeriodNs"], 3), 1.25)
        rep = self.t / "b1" / "reports"
        self.assertFalse((rep / "route.congestion.rpt").exists(), "no data, no report")
        route = (rep / "route.summary.rpt").read_text()
        self.assertIn("|           WNS (ns):|", route)
        self.assertIn(" -0.025  ", route)
        self.assertIn("|view_ss_m40c        |", route)
        self.assertIn("#  Command:           optDesign -postRoute", route)
        self.assertIn("= Slack Time         -0.025", (rep / "route_reg2reg.tarpt").read_text())
        for p in rep.iterdir():
            text = p.read_text()
            self.assertNotIn("OTHER EXPERIMENT", text, p.name)
            self.assertNotIn("mock", text.lower(), p.name)
            self.assertNotIn("model", text.lower(), p.name)

    def test_rebuild_needs_exactly_the_kept_set(self):
        out = run("sapr", "run", "--design", "openc910", "--extra-lib", self.t / "gen", "--out", self.t / "bx")
        self.assertEqual(out.returncode, 2)
        self.assertIn("no build data for this custom-cell set on this Site (5 cells; the Site has data for the 4-cell set)", out.stderr)
        out = run("sapr", "run", "--design", "openc910", "--dont-use", "X", "--out", self.t / "bx")
        self.assertIn("--dont-use is not supported", out.stderr)
        self.assertIn("not an AndesCell delivery", run("sapr", "run", "--design", "openc910", "--extra-lib", self.t / "ht", "--out", self.t / "bx").stderr)

    def test_load_and_report(self):
        s = load(self.t / "ht" / "timing_summary.json")
        self.assertEqual((s["schema"], s["stage"], s["wnsNs"], s["nvp"], len(s["paths"])), ("ctu-himatime-timing/2", "route", -0.03, 150, 3))
        p = s["paths"][0]
        self.assertEqual((p["rank"], p["endShort"], p["beginShort"], p["clockNs"], p["sramNs"]), (1, "dout_reg_7_", "u_sram_1", 0.12, 0.19))
        self.assertAlmostEqual(p["clockNs"] + p["sramNs"] + p["cellNs"] + p["netNs"], p["arrivalNs"], places=6)
        self.assertEqual([b["part"] for b in s["breakdown"]], ["SRAM access", "INV", "ND2", "AOI21", "nets"])
        self.assertAlmostEqual(sum(b["ns"] for b in s["breakdown"]), p["arrivalNs"] - p["clockNs"], places=6)
        rpt = (self.t / "ht" / "report_timing.rpt").read_text()
        self.assertIn("Path 3:", rpt)
        self.assertNotIn("Path 4:", rpt, "only the summary's worst paths")
        self.assertIn("launch clock latency", (self.t / "ht" / "stage_breakdown.rpt").read_text())
        rep = json.loads(ok(self, "himatime", "report", "--db", self.t / "ref", "--json").stdout)
        self.assertEqual((rep["breakdown"], rep["wnsNs"]), (s["breakdown"], s["wnsNs"]))
        self.assertIn("violating paths 150", ok(self, "himatime", "report", "--db", self.t / "ref").stdout)
        # the custom build's route paths have no stage detail: summary rows only
        ok(self, "himatime", "load", "--db", self.t / "b1", "--out", self.t / "ht1", "--quiet")
        c = load(self.t / "ht1" / "timing_summary.json")
        self.assertEqual((c["wnsNs"], c["breakdown"], c["paths"][0]["referenceSlackNs"]), (-0.025, [], -0.03))
        self.assertIn("= Slack Time", (self.t / "ht1" / "report_timing.rpt").read_text())

    def test_highvalue(self):
        r = load(self.t / "hv" / "high_value.json")
        self.assertEqual((r["design_cells"], r["top_per_rank"], r["high_value_instances"], r["lib_cells"], r["listed_cells"]), (5000, 250, 900, 40, 5))
        self.assertEqual(r["families"][0], dict(family="ND2", count=2))
        self.assertEqual(len(r["rank_types"]), 5)
        self.assertTrue((self.t / "hv" / "high_value_cells.rpt").read_text().startswith("Info: Cells in current design"))
        j = json.loads(ok(self, "himatime", "highvalue", "--db", self.t / "ref", "--json", "--top-families", "2").stdout)
        self.assertEqual([f["family"] for f in j["families"]], ["ND2", "INV"])
        self.assertIn("900 high-value instances", ok(self, "himatime", "highvalue", "--db", self.t / "ref").stdout)

    def test_whatif_merge(self):
        wi = self.wi
        self.assertEqual((wi["scale"], wi["top_n"], wi["merged_count"], len(wi["rankings"])), (0.9, 3, 8, 7))
        self.assertEqual(["%s_%s_%s_%s" % (a["cell"], a["from"], a["to"], a["edge"]) for a in wi["merged"]], [A1, A2, A3, A4, A5, A6, A7, A8])
        self.assertEqual(len(wi["merged"][0]["rankedBy"]), 7)
        self.assertEqual(load(self.t / "wi" / "whatif.json")["merged"], wi["merged"])
        self.assertEqual(len(list((self.t / "wi").glob("cell_what_if_sort_by_*.rpt"))), 7)
        one = json.loads(ok(self, "himatime", "whatif", "--db", self.t / "ref", "--scale", "0.9", "--sort", "TNS", "--json").stdout)
        self.assertEqual((list(one["rankings"]), one["merged_count"]), (["TNS"], 3))
        bad = run("himatime", "whatif", "--db", self.t / "ref", "--scale", "0.8")
        self.assertEqual(bad.returncode, 2)
        self.assertIn("the Site has what-if data for scale 0.9, top 3", bad.stderr)
        self.assertEqual(run("himatime", "whatif", "--db", self.t / "ref", "--scale", "0.9", "--top", "50").returncode, 2)
        self.assertIn("unknown --sort", run("himatime", "whatif", "--db", self.t / "ref", "--scale", "0.9", "--sort", "AREA").stderr)

    def test_qualib_list_and_analyze(self):
        r = load(self.t / "ql" / "library_analysis.json")
        self.assertEqual((r["arcs"], r["cells"]), (8, 5))
        self.assertEqual(r["vt"]["ulvt_fastest_count"], 7)
        self.assertEqual(r["vt"]["lvt_slower_median_pct"], 10.0)
        self.assertEqual(r["vt"]["svt_slower_median_pct"], 25.0)
        self.assertEqual(r["constraints"], dict(footprint="same area and pins as the stock cell", inputCapMaxRatio=1.3, lvs="match"))
        self.assertEqual(r["families"][0], dict(family="INV", arcs=2, cells=1))
        self.assertIn("ULVT is the fastest Vt on 7 of 8 arcs", (self.t / "ql" / "library_analysis.rpt").read_text())
        lst = json.loads(ok(self, "qualib", "list", "--cells", "ND2D2X", "--json").stdout)
        self.assertEqual([a["arc"] for a in lst["arcs"]], [A1, A2])
        self.assertEqual(set(lst["arcs"][0]), {"arc", "cell", "from", "to", "edge", "family", "fastestVt", "ulvt", "lvt", "svt"})
        f = arcs_file(self.t / "two.json", [A7, A1])
        self.assertEqual([a["arc"] for a in json.loads(ok(self, "qualib", "list", "--arcs", f, "--json").stdout)["arcs"]], [A7, A1])
        self.assertIn(A7, ok(self, "qualib", "list", "--arcs", f).stdout)
        self.assertIn("not in the stock arc data", run("qualib", "list", "--cells", "NOPE").stderr)
        bad = arcs_file(self.t / "bad.json", ["ND9D9X_A_Z_rise"])
        out = run("qualib", "analyze", "--db", self.t / "ref", "--arcs", bad, "--out", self.t / "qx")
        self.assertEqual(out.returncode, 2)
        self.assertIn("ND9D9X_A_Z_rise", out.stderr)

    def test_generation(self):
        g = load(self.t / "gen" / "generation.json")
        self.assertEqual((g["schema"], g["requested"], g["generated"], g["failed"], g["failedKnown"], g["delivered"]),
                         ("ctu-andescell-generation/2", 8, 6, 2, [A8], []))
        self.assertEqual((g["iterations"], g["scale"], g["round"]), (50, 0.9, 1))
        self.assertEqual([a["arc"] for a in g["arcs"]], [A1, A2, A3, A5, A6])
        self.assertEqual(sorted(p.stem for p in (self.t / "gen" / "cells").glob("*.lib")), sorted([A1, A2, A3, A5, A6]))
        self.assertIn("custom cell, version 7", (self.t / "gen" / "cells" / (A1 + ".lib")).read_text())
        sub = arcs_file(self.t / "sub.json", [A1, A8])
        dry = ok(self, "andescell", "generate", "--arcs", sub, "--round", "1", "--dry-run").stdout
        self.assertIn("2 arc(s) requested", dry)
        self.assertIn("1 generated, 1 failed", dry)
        out = run("andescell", "generate", "--arcs", arcs_file(self.t / "x.json", [A1, "ND9D9X_A_Z_rise"]), "--round", "1", "--dry-run")
        self.assertEqual(out.returncode, 2)
        self.assertIn("ND9D9X_A_Z_rise", out.stderr)
        out = run("andescell", "generate", "--arcs", sub, "--round", "1", "--iterations", "20", "--dry-run")
        self.assertIn("generation data for 50 iterations at scale 0.9", out.stderr)
        self.assertNotIn("mock", (self.t / "gen" / "generation.rpt").read_text().lower())

    def test_cell_check_and_screen(self):
        v = load(self.t / "vf" / "verify.json")
        self.assertEqual((v["schema"], v["generated"], v["kept"], v["dropped"]), ("ctu-himatime-cellcheck/1", 6, 4, 2))
        self.assertEqual([(c["arc"], c["kept"]) for c in v["cells"]], [(A5, True), (A6, False), (A3, True), (A1, True), (A2, True)])
        nd2 = next(c for c in v["cells"] if c["arc"] == A1)
        self.assertEqual((nd2["bestVersion"], nd2["inputCapChangePct"], nd2["delta"]), (7, -6.7, 1.05))
        self.assertEqual(v["keptByFamily"], [dict(family="ND2", count=2), dict(family="AOI21", count=1), dict(family="INV", count=1)])
        self.assertEqual(sorted(p.stem for p in (self.t / "vf" / "kept" / "cells").glob("*.lib")), sorted([A1, A2, A3, A5]))
        self.assertIn("Δ", (self.t / "vf" / "verify.rpt").read_text())
        j = json.loads(ok(self, "himatime", "verify", "--cells", self.t / "gen", "--db", self.t / "ref", "--json").stdout)
        self.assertEqual((j["kept"], j["cells"]), (v["kept"], v["cells"]))
        s = load(self.t / "sc" / "screen.json")
        self.assertEqual((s["schema"], s["passed"], s["failed"]), ("ctu-qualib-screen/2", 4, 0))
        aoi = next(r for r in s["cells"] if r["arc"] == A5)
        self.assertEqual((aoi["areaRatio"], aoi["inputCapRatio"], aoi["lvs"], aoi["status"]), (1.0, 1.2, "match", "PASS"))
        self.assertIn("4 of 4 cell(s) pass", (self.t / "sc" / "cell_screen.rpt").read_text())
        all_gen = json.loads(ok(self, "qualib", "screen", "--cells", self.t / "gen", "--json").stdout)
        self.assertEqual((all_gen["passed"], all_gen["failed"]), (4, 1))

    def test_missing_bundle(self):
        env = dict(FX_ENV, CTU_OPENC910_DATA=str(self.t / "nowhere"))
        out = run("sapr", "run", "--design", "openc910", "--out", self.t / "nb", env=env)
        self.assertEqual(out.returncode, 2)
        self.assertIn("design data openc910 is not installed on this Site", out.stderr)


@unittest.skipUnless((REAL / "pr" / "pr.json").is_file(), "the Site's openc910 design data is not installed here")
class RealBundle(unittest.TestCase):
    """The installed data: the tools' numbers equal the bundle's, and the headline counts hold."""

    def test_full_sequence(self):
        pr = json.loads((REAL / "pr" / "pr.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            wi = flow(self, t, env=REAL_ENV)
            r, c = load(t / "ref" / "sapr_summary.json"), load(t / "b1" / "sapr_summary.json")
            ref, cus = pr["reference"]["route"], pr["custom_model"]["stages"]["route"]
            for s, src in ((r, ref), (c, cus)):
                self.assertEqual((s["wnsNs"], s["tnsNs"], s["nvp"]), (src["wns_ns"]["reg2reg"], src["tns_ns"]["reg2reg"], round(src["nvp"]["reg2reg"])))
                self.assertEqual(s["customCells"], src["power"]["custom_cells"])
            self.assertEqual(r["customCells"], 0)
            self.assertGreater(c["customCells"], 0)
            self.assertEqual(round(100 * (c["wnsNs"] - r["wnsNs"]) / r["clockPeriodNs"], 1), 1.2)
            self.assertEqual(wi["merged_count"], 245)
            g = load(t / "gen" / "generation.json")
            self.assertEqual((g["requested"], g["generated"]), (245, 237))
            v = load(t / "vf" / "verify.json")
            self.assertEqual((v["generated"], v["kept"]), (237, 118))
            s = load(t / "sc" / "screen.json")
            self.assertEqual((s["passed"], s["failed"]), (118, 0))
            ts = load(t / "ht" / "timing_summary.json")
            self.assertEqual(len(ts["paths"]), 8)
            self.assertAlmostEqual(sum(b["ns"] for b in ts["breakdown"]), ts["paths"][0]["arrivalNs"] - ts["paths"][0]["clockNs"], places=3)
            self.assertEqual(load(t / "ref" / "sapr_summary.json")["ioBudget"]["outputDelayPorts"], json.loads((REAL / "pr" / "io_budget.json").read_text())["output_delay_ports"])
            for d in ("ref", "b1"):
                for p in (t / d / "reports").iterdir():
                    text = p.read_text().lower()
                    self.assertNotIn("mock", text, p.name)


if __name__ == "__main__":
    unittest.main()
