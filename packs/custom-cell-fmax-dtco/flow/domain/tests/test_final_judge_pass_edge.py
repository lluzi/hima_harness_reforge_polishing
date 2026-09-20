from pathlib import Path

import yaml

PACK_ROOT = Path(__file__).resolve().parents[3]


def test_final_judge_has_a_pass_edge():
    graph = yaml.safe_load((PACK_ROOT / "graph.yml").read_text())
    edges = [e for e in graph["edges"] if e["from"] == "final-judge"]
    outcomes = {e.get("outcome") for e in edges}
    assert "PASS" in outcomes, (
        "final-judge has no PASS edge in graph.yml, so a Run whose final-judge "
        "rules all PASS falls through the engine's edgeFrom/endRun default and "
        "is wrongly recorded as status 'ended-goal-not-met' instead of "
        "'ended-goal-met' (see packages/harness/src/fabric.ts endRun/ENDED_BY, "
        "and packs/aes-tsmc28-dtco/graph.yml for the reference pattern: PASS "
        "and FAIL both route to next-research, whose research-next chooser "
        "holds the goalMet: true rule for {constraint: PASS, goal: PASS})"
    )
