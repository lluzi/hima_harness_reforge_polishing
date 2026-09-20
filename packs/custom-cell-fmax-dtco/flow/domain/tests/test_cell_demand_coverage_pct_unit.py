import re
from pathlib import Path

import yaml

PACK_ROOT = Path(__file__).resolve().parents[3]


def _declared_unit(kind):
    semantics = yaml.safe_load((PACK_ROOT / "semantics.yml").read_text())
    return semantics["values"][kind]["unit"]


def _emitted_unit(read_stage_path, kind):
    text = read_stage_path.read_text()
    match = re.search(r'number\(\s*"%s"\s*,\s*[^,]*(?:,\s*"([a-z_]+)")?' % kind, text)
    assert match, "no number(%r, ...) call found in %s" % (kind, read_stage_path)
    return match.group(1) or "count"


def test_cell_demand_coverage_pct_is_emitted_in_percent():
    declared = _declared_unit("cell_demand_coverage_pct")
    assert declared == "percent"
    for candidate in ("flow/read-stage.py", "tools/read-stage.py"):
        emitted = _emitted_unit(PACK_ROOT / candidate, "cell_demand_coverage_pct")
        assert emitted == declared, (
            "%s emits cell_demand_coverage_pct in unit %r but semantics.yml declares %r; "
            "the executor refuses the record at runtime" % (candidate, emitted, declared)
        )
