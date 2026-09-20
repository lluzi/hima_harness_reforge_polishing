import re
from pathlib import Path

import yaml

PACK_ROOT = Path(__file__).resolve().parents[3]
HARNESS_BASE_SEMANTICS = PACK_ROOT.parents[1] / "packages" / "harness" / "semantics.yml"


def _emitted_value_kinds(read_stage_path):
    text = read_stage_path.read_text()
    kinds = set()
    for call in ("number", "unknown"):
        for match in re.finditer(r'%s\(\s*"([^"]+)"' % call, text):
            kinds.add(match.group(1))
    return kinds


def _declared_value_kinds():
    pack_semantics = yaml.safe_load((PACK_ROOT / "semantics.yml").read_text())
    base_semantics = yaml.safe_load(HARNESS_BASE_SEMANTICS.read_text())
    declared = set(pack_semantics["values"].keys())
    declared |= set(base_semantics["values"].keys())
    return declared


def test_every_emitted_value_kind_is_declared_in_semantics():
    declared = _declared_value_kinds()
    for candidate in ("flow/read-stage.py", "tools/read-stage.py"):
        emitted = _emitted_value_kinds(PACK_ROOT / candidate)
        undeclared = emitted - declared
        assert not undeclared, (
            "%s emits value type(s) %s that semantics.yml does not declare; "
            "the executor refuses these records at runtime" % (candidate, sorted(undeclared))
        )


def test_characterize_reader_manifest_declares_every_value_it_emits():
    manifest = (PACK_ROOT / "readers/read-characterize.yml").read_text()
    emitted = set(re.findall(r"(?m)^  - ([a-z_][a-z0-9_]*)$", manifest))
    assert {"predicted_cell_count", "cell_demand_count", "cell_demand_met_count",
            "cell_demand_unmet_count", "cell_demand_coverage_pct",
            "mock_liberty_calibration_accepted"} <= emitted, (
        "read-characterize.yml must declare every value emitted by the characterize branch"
    )


def test_flow_and_tools_read_stage_emit_the_same_value_kinds():
    flow_emitted = _emitted_value_kinds(PACK_ROOT / "flow/read-stage.py")
    tools_emitted = _emitted_value_kinds(PACK_ROOT / "tools/read-stage.py")
    assert flow_emitted == tools_emitted
