"""Synthetic 2x2-die case generator used by every later test in this Pack.

`make_case()` writes a complete, self-consistent MAGE case (rule, pblock,
block, target table, request order, start/incumbent PLA states, manifest and
consumer context) under `<root>/case/`. No customer data: every name,
dimension and coordinate here is invented for this fixture. It mirrors the
vendor file *shapes* seen in the read-only P23 reference material (command
forms only — never data), so the Pack's readers/writers get exercised
against genuinely vendor-shaped text without ever embedding real values.

Frame geometry: `dbuPerUm 10000`, 2 cols x 2 rows, die 1000 x 800 um, scribe
60 um -> frame `scribe + cols*(die + scribe)` = 2180 x 1780 um.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core  # noqa: E402


DBU_PER_UM = 10000
FRAME_WIDTH_UM = "2180"
FRAME_HEIGHT_UM = "1780"

# (groupName, partName, target, lengthUm, locXUm, locYUm)
TARGET_ROWS = [
    ("G1", "OVL_A", "T1", "135", "-900", "-860"),
    ("G1", "OVL_B", "T2", "135", "200", "-860"),
    ("G2", "AL_X", "T3", "180", "-1090", "-200"),
]

# CT point (frame-centre offset (1090, 890)) per target row, in display order.
TARGET_CT_UM = {
    "T1": ("190", "30"),
    "T2": ("1290", "30"),
    "T3": ("0", "690"),
}


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _rule_tcl():
    lines = [
        "smShot shot -setArea {0 0 2180 1780}",
        "smShot shot -setExtScribe -min {60 60 60 60} -olap {-1 -1}",
        "",
        "smFlow -addItem F_LC_BL -parent frame -itemType SLFIX",
        "smSLFit F_LC_BL -setBlock F_LC_BL -entityType Block -bindBlkType N/A \\",
        "    -setProp -merge 1 -turnable 0 -pri 0 -pri2 -1 \\",
        "    -setFixed -xFix CENTER -yFix CENTER -alignForce 1",
        "",
        "smFlow -addItem OVL_A -parent frame -itemType SLFIT",
        "smSLFit OVL_A -setBlock OVL_A -entityType Block -bindBlkType OVL \\",
        "    -setProp -merge 1 -turnable 0 -pri 10 -pri2 -1 \\",
        "    -setScribe -inc HORIZ -exc NONE \\",
        "    -setGrid -gridX 0.010000 -gridY 0.010000 \\",
        "    -setSpace -xSpcType BOUND -xSpc 0.000000 \\",
        "    -ySpcType BOUND -ySpc 0.000000 -spcWithRot 0 \\",
        "    -setNum 0 -setNumMin 1 -setNumMax 1",
        "",
        "smFlow -addItem OVL_B -parent frame -itemType SLFIT",
        "smSLFit OVL_B -setBlock OVL_B -entityType Block -bindBlkType OVL \\",
        "    -setProp -merge 1 -turnable 0 -pri 10 -pri2 -1 \\",
        "    -setScribe -inc HORIZ -exc NONE \\",
        "    -setGrid -gridX 0.010000 -gridY 0.010000 \\",
        "    -setSpace -xSpcType BOUND -xSpc 0.000000 \\",
        "    -ySpcType BOUND -ySpc 0.000000 -spcWithRot 0 \\",
        "    -setNum 0 -setNumMin 1 -setNumMax 1",
        "",
        "smFlow -addItem AL_X -parent frame -itemType SLFIT",
        "smSLFit AL_X -setBlock AL_X -entityType Block -bindBlkType ASML_AL \\",
        "    -setProp -merge 1 -turnable 0 -pri 20 -pri2 -1 \\",
        "    -setScribe -inc VERT -exc NONE \\",
        "    -setGrid -gridX 0.010000 -gridY 0.010000 \\",
        "    -setSpace -xSpcType BOUND -xSpc 0.000000 \\",
        "    -ySpcType BOUND -ySpc 0.000000 -spcWithRot 0 \\",
        "    -setNum 0 -setNumMin 1 -setNumMax 1",
        "",
        "smFlow -addItem OVL_F -parent frame -itemType SLFIT",
        "smSLFit OVL_F -setBlock OVL_F -entityType Block -bindBlkType OVL \\",
        "    -setProp -merge 1 -turnable 0 -pri 50 -pri2 -1 \\",
        "    -setScribe -inc HORIZ -exc NONE \\",
        "    -setGrid -gridX 0.010000 -gridY 0.010000 \\",
        "    -setSpace -xSpcType BOUND -xSpc 0.000000 \\",
        "    -ySpcType BOUND -ySpc 0.000000 -spcWithRot 0 \\",
        "    -setNum 0 -setNumMin 2 -setNumMax 1",
        "",
        "smFlow -addItem KEY_V -parent frame -itemType SLFIT",
        "smSLFit KEY_V -setBlock KEY_V -entityType Block -bindBlkType TSK/MPAD \\",
        "    -setProp -merge 1 -turnable 0 -pri 90 -pri2 -1 \\",
        "    -setScribe -inc VERT -exc NONE \\",
        "    -setZone -by PCT -xPos CENTER -xPct 50 -xTgt BOUND \\",
        "    -setGrid -gridX 0.010000 -gridY 0.010000 \\",
        "    -setSpace -xSpcType BOUND -xSpc 0.000000 \\",
        "    -ySpcType BOUND -ySpc 0.000000 -spcWithRot 0 \\",
        "    -setNum 0 -setNumMin 1 -setNumMax 1",
        "",
        "smFlow -addItem G1 -parent frame -itemType GROUP",
        "smFlow -addItem G2 -parent frame -itemType GROUP",
        "",
    ]
    return "\n".join(lines) + "\n"


def _pblock_tcl():
    return (
        "smBlockMgr -def mainchip -blkType N/A -bbox (0,0,1000,800) -noCheck 1 "
        "-gds ./out.gds -cell mainchip\n"
    )


# (name, blockType, widthUm, heightUm)
BLOCK_ITEMS = [
    ("F_LC_BL", "N/A", "16.9", "16.9"),
    ("OVL_A", "OVL", "135", "56"),
    ("OVL_B", "OVL", "135", "56"),
    ("AL_X", "ASML_AL", "180", "50"),
    ("OVL_F", "OVL", "100", "56"),
    ("KEY_V", "TSK/MPAD", "900", "60"),
]


def _block_tcl():
    lines = []
    for name, blk_type, width, height in BLOCK_ITEMS:
        lines.append(
            f"smBlockMgr -def {name} -blkType {blk_type} -bbox (0,0,{width},{height}) "
            f"-noCheck 1 -gds ./{name}.gds -cell {name}"
        )
    return "\n".join(lines) + "\n"


def _targets_csv():
    header = "﻿Group Name,Part/Cluster Name,Target,Part/Cluster Length(um),LOC X,LOC Y\n"
    rows = ",".join
    body = "\n".join(rows(row) for row in TARGET_ROWS)
    return header + body + "\n"


def _request_t():
    lines = []
    for row in TARGET_ROWS:
        group_name, _part, target, *_rest = row
        x, y = TARGET_CT_UM[target]
        lines.append(
            f"smPFlow -placeGroup -groupItem {group_name} -groupTargetPoint ({x},{y}) -groupPlaceType CT"
        )
    return "\n".join(lines) + "\n"


def _fixinsts_block():
    return "set fixinsts {\n\tF_LC_BL.F_LC_BL 0 0 0 21.55 21.55 38.45 38.45\n}\n"


def _pinst_group_block():
    rows = [
        "G1 G1_1 190 30 0",
        "G1 G1_2 1290 30 0",
        "G2 G2_1 0 690 1",
    ]
    body = "\n".join(f"\t{row}" for row in rows)
    return "set pinstGroupProperty {\n" + body + "\n}\n"


def _fitinsts_block(include_filler=False):
    rows = [
        'OVL_A.OVL_A 122.5 2 257.5 58 NULL "" OVL_A.OVL_A_1 "G1_1"',
        'OVL_B.OVL_B 1372.5 2 1507.5 58 NULL "" OVL_B.OVL_B_1 "G1_2"',
        'AL_X.AL_X -90 665 90 715 NULL "" AL_X.AL_X_1 "G2_1"',
    ]
    if include_filler:
        rows.extend(
            [
                'OVL_F.OVL_F 550 2 650 58 NULL "" OVL_F.OVL_F_1 ""',
                'OVL_F.OVL_F 1550 2 1650 58 NULL "" OVL_F.OVL_F_2 ""',
                # Auto-Refine-placed filler: the vendor `inst` token itself carries a
                # suffix (not just the `pinstFit` id), exercising the case where `inst`
                # is not simply `base` repeated around the dot.
                'OVL_F.OVL_F_7 2000 2 2100 58 NULL "" OVL_F.OVL_F_7_1 ""',
            ]
        )
    body = "\n".join(f"\t{row}" for row in rows)
    return "set fitinsts {\n" + body + "\n}\n"


def _drop_fit_insts_block():
    row = 'KEY_V.KEY_V 0 0 900 60 NULL 0 "" KEY_V.KEY_V ""'
    return "set dropFitInsts {\n\t" + row + "\n}\n"


FIXINSTS_FOREACH = (
    "foreach {inst id col row l b r t} $fixinsts {\n"
    "\tsmPInstMgr -addInstFix -inst $inst -id $id -col $col -row $row -umBox ($l,$b,$r,$t) -plaCheckSize\n"
    "}\n"
)

PINST_GROUP_FOREACH = (
    "foreach {groupItem pinstGroup targetPointLeft targetPointBottom vertSL} $pinstGroupProperty {\n"
    "\tsmPInstMgr -addGroup -pinstGroup $pinstGroup -groupItem $groupItem "
    "-targetPoint ($targetPointLeft,$targetPointBottom) -vertSL $vertSL\n"
    "}\n"
)

FITINSTS_FOREACH = (
    "foreach {inst l b r t pinstFitExtraRot pf pinstFit inGroup} $fitinsts {\n"
    '\tsmPInstMgr -addInstFit -inst $inst -umBox ($l,$b,$r,$t) -pinstFitExtraRot $pinstFitExtraRot '
    '-postfix "$pf" -pinstFit $pinstFit -inGroup "$inGroup" -plaCheckSize\n'
    "}\n"
)

DROP_FIT_INSTS_FOREACH = (
    "foreach {inst l b r t pinstFitExtraRot placed pf pinstFit inGroup} $dropFitInsts {\n"
    '\tsmPInstMgr -addDropInstFit -inst $inst -umBox ($l,$b,$r,$t) -pinstFitExtraRot $pinstFitExtraRot '
    '-placed $placed -postfix "$pf" -pinstFit $pinstFit -inGroup "$inGroup" -plaCheckSize\n'
    "}\n"
)


def _start_pla():
    return (
        "############# For placed fix instances #############\n"
        + _fixinsts_block()
        + "\n"
        + FIXINSTS_FOREACH
        + "\n############# For group instances #############\n"
        + _pinst_group_block()
        + "\n"
        + PINST_GROUP_FOREACH
        + "\n############# For placed fit instances #############\n"
        + _fitinsts_block(include_filler=False)
        + "\n"
        + FITINSTS_FOREACH
    )


def _incumbent_pla():
    return (
        "############# For placed fix instances #############\n"
        + _fixinsts_block()
        + "\n"
        + FIXINSTS_FOREACH
        + "\n############# For group instances #############\n"
        + _pinst_group_block()
        + "\n"
        + PINST_GROUP_FOREACH
        + "\n############# For placed fit instances #############\n"
        + _fitinsts_block(include_filler=True)
        + "\n"
        + FITINSTS_FOREACH
        + "\n############# For dropped fit instances #############\n"
        + _drop_fit_insts_block()
        + "\n"
        + DROP_FIT_INSTS_FOREACH
    )


def _file_ref(path):
    return {"path": str(path), "sha256": core.file_sha256(path)}


def make_case(root, mage_executable=""):
    """Write a synthetic 2x2-die MAGE case under `<root>/case/`.

    Returns `{'root', 'manifest', 'consumerContext', 'files': {...}}` with
    absolute paths. `mage_executable` may be a string or a list of strings;
    it is stored verbatim under `manifest['mage']['executable']`.
    """
    case_dir = Path(root) / "case"
    case_dir.mkdir(parents=True, exist_ok=True)

    rule_path = _write(case_dir / "rule.tcl", _rule_tcl())
    pblock_path = _write(case_dir / "pblock.tcl", _pblock_tcl())
    block_path = _write(case_dir / "block.tcl", _block_tcl())
    target_table_path = _write(case_dir / "targets.csv", _targets_csv())
    request_order_path = _write(case_dir / "request.t", _request_t())
    start_state_path = _write(case_dir / "start.pla", _start_pla())
    incumbent_state_path = _write(case_dir / "incumbent.pla", _incumbent_pla())

    frb_path = _write(case_dir / "synthetic.frb", "# synthetic frame-rule binding placeholder\n")
    prj_path = _write(case_dir / "synthetic.prj", "# synthetic project placeholder\n")
    cluster_tcl_path = _write(case_dir / "cluster.tcl", "# synthetic cluster placeholder\n")

    manifest = core.stamp(
        "case-manifest",
        {
            "frb": _file_ref(frb_path),
            "prj": _file_ref(prj_path),
            "rule": _file_ref(rule_path),
            "pblock": _file_ref(pblock_path),
            "block": _file_ref(block_path),
            "clusterTcl": [_file_ref(cluster_tcl_path)],
            "targetTable": _file_ref(target_table_path),
            "requestOrder": _file_ref(request_order_path),
            "startState": _file_ref(start_state_path),
            "incumbentState": _file_ref(incumbent_state_path),
            "frameSizeUm": [FRAME_WIDTH_UM, FRAME_HEIGHT_UM],
            "dbuPerUm": DBU_PER_UM,
            "partitionRule": {"toleranceUm": "2"},
            "groupPlaceCommandForm": (
                "smPFlow -placeGroup -groupItem {g} -groupTargetPoint ({x},{y}) -groupPlaceType CT"
            ),
            "mage": {"executable": mage_executable, "setupScript": "", "buildBanner": "synthetic"},
        },
    )
    manifest_path = case_dir / "manifest.json"
    core.write_artifact(manifest_path, manifest)

    consumer_context = core.stamp(
        "consumer-context",
        {
            "stage": "npi",
            "limitHardness": "preference",
            "wat": {
                "pad_pitch_um": {
                    "value": "100",
                    "source": "assumption",
                    "confirmedBy": "fixture",
                    "confirmedAt": "2026-10-12",
                }
            },
        },
    )
    consumer_context_path = case_dir / "consumer-context.json"
    core.write_artifact(consumer_context_path, consumer_context)

    return {
        "root": str(Path(root).resolve()),
        "manifest": manifest,
        "consumerContext": consumer_context,
        "files": {
            "rule": str(rule_path),
            "pblock": str(pblock_path),
            "block": str(block_path),
            "targetTable": str(target_table_path),
            "requestOrder": str(request_order_path),
            "startState": str(start_state_path),
            "incumbentState": str(incumbent_state_path),
            "manifest": str(manifest_path),
            "consumerContext": str(consumer_context_path),
        },
    }


def make_site_capabilities(root, mage_executable):
    """Write `<root>/case/site-capabilities.json` and return its path."""
    case_dir = Path(root) / "case"
    case_dir.mkdir(parents=True, exist_ok=True)
    doc = {
        "schema": "mage.site-capabilities/1",
        "mage": {"executable": mage_executable, "setupScript": "", "env": {}},
    }
    path = case_dir / "site-capabilities.json"
    core.write_artifact(path, doc)
    return str(path)
