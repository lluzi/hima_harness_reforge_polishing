#!/usr/bin/env python3
"""Task 16: real-report corpus preflight for the `agentic-timing-closure-system` Pack.

Runs every Pack parser this Pack's tool tasks will actually feed (PT/StarRC/
Innovus report grammar in `flow/atcs/reports.py` and `flow/atcs/verification.py`,
the per-arc `parse_path_detail` and SPEF net-name extraction in
`flow/atcs/adapters.py`) against the complete set of real report files the
Pack will meet, streamed read-only over SSH from the linglong server, before
any real tool run. Never writes a byte of real report content into this
repository: every report is streamed straight into the in-process parser
(or, for the huge SPEF sources, a bounded server-side `grep` over just the
`*NAME_MAP`/`*D_NET` header lines) and only paths/sha256/sizes/parser
outcomes are ever printed or written to a local file.

Usage::

    python3 scripts/atcs-corpus-preflight.py [--json OUT.json]

Requires SSH key auth already set up for `luzi@192.168.50.41` (read-only:
this script only ever runs `cat`/`sed`/`grep`/`stat`/`sha256sum`/`ls` on the
remote host -- it never starts EDA, never runs edarun/eda/podman, never
writes on the server, never reads licence files).

Corpus (per `.superpowers/sdd/task-16-brief.md` and
`EDA_SERVER_TOOLS_AND_EVIDENCE_GUIDE.zh-CN.md` §8/§9):

- Foundation root `SIGNOFF/ROUND3/PT/reports/<scenario>/{global_timing,
  setup,hold,check_timing,constraints}.rpt` for all four required scenarios,
  `RPT/xtop_round2_eco_route/verify_{drc,connectivity}.rpt`, and the two
  StarRC extraction logs.
- The frozen old Pack's real B_lazy Run workspace
  (`xtop-timing-closure-runs/xtop-timing-closure-20260925-054133-cd2f`)
  `flow/iterations/g001`'s own PT reports and Innovus physical reports --
  read-only, per this Pack's own rule that `packs/xtop-timing-closure/` and
  its recorded runs are frozen reference material, never modified.
- The Foundation ROUND3 STARRC `.spef` files' `*NAME_MAP`/`*D_NET` header
  lines (bounded `grep`, never the full multi-GB parasitic body) for
  `adapters.parse_spef_net_names`.

Every `setup.rpt`/`hold.rpt` fetched here is also split into its individual
per-path blocks and fed through `adapters.parse_path_detail` (the same
per-arc grammar `pt-query.tcl`'s targeted `report_timing` output uses) --
this is the "use the ROUND3 setup.rpt/hold.rpt full-path reports as its
corpus" instruction in the task brief, since a real `pt-query.tcl` sample
was never captured in isolation.
"""
from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PACK_FLOW = REPO_ROOT / "packs" / "agentic-timing-closure-system" / "flow"
sys.path.insert(0, str(PACK_FLOW))

from atcs import core, reports, verification, adapters  # noqa: E402


SSH_HOST = "luzi@192.168.50.41"
SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20"]

FOUNDATION_ROOT = "/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation"
BLAZY_RUN_ROOT = (
    "/data/eda/project/hima_harness/xtop-timing-closure-runs/"
    "xtop-timing-closure-20260925-054133-cd2f"
)

REQUIRED_SCENARIOS = (
    "func_ssg_rcworst_m40",
    "func_ssg_rcworst_125",
    "func_ffg_cbest_m40",
    "func_ffg_cbest_125",
)
SCENARIO_CORNER = {
    "func_ssg_rcworst_m40": "cworst_T",
    "func_ssg_rcworst_125": "cworst_T",
    "func_ffg_cbest_m40": "cbest",
    "func_ffg_cbest_125": "cbest",
}

_STARTPOINT_SPLIT_RE = re.compile(r"(?m)^\s*Startpoint:\s*")
_MAX_PATHS_RE = re.compile(r"-max_paths\s+(\d+)")
_ERROR_LOG_RE = re.compile(r"(?m)^(?:\*\*)?(?:ERROR|Error|Fatal):")


class SshError(RuntimeError):
    pass


def ssh(remote_cmd, timeout=240):
    """Run one read-only command on the linglong server and return its stdout."""
    proc = subprocess.run(
        ["ssh"] + SSH_OPTS + [SSH_HOST, remote_cmd],
        capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise SshError(f"ssh command failed ({proc.returncode}): {remote_cmd}\n{proc.stderr}")
    return proc.stdout


def fetch_text(remote_path):
    return ssh(f"cat {shlex.quote(remote_path)}")


def remote_identity(remote_path):
    """`(sha256, size)` of a remote file, computed server-side (never downloaded twice)."""
    out = ssh(f"sha256sum {shlex.quote(remote_path)}; stat -c%s {shlex.quote(remote_path)}")
    lines = [line for line in out.splitlines() if line.strip()]
    sha256 = lines[0].split()[0]
    size = int(lines[1])
    return sha256, size


def fetch_bounded_spef_net_lines(remote_path):
    """Only the `*NAME_MAP` section and every `*D_NET` header line of a
    (potentially tens-of-MB) SPEF, via bounded server-side `sed`/`grep` --
    never the full parasitic body.

    Fix round 1 (Task 16 review, Important #3): the section is fetched
    *verbatim*, from the literal `*NAME_MAP` line up to (and including) the
    first `*D_NET` line, rather than just grepping every `^\*[0-9]+ ` line
    -- a real SPEF's `*PORTS` section (confirmed against a real Foundation
    SPEF) reuses that identical line shape for port directions, not names,
    and `atcs.adapters.parse_spef_net_names` now depends on seeing the real
    `*NAME_MAP`/`*PORTS` section headers themselves to bound where the name
    map actually ends; grepping only the digit-led lines (as an earlier
    version of this function did) silently dropped those headers and made
    every alias unresolvable. The stretch from `*NAME_MAP` to the first
    `*D_NET` is still bounded (~196k lines / ~10 MB here, out of an ~83 MB
    file) since it ends the moment the first real net begins; every other
    `*D_NET` line across the whole file is fetched separately (one short
    header line per net, never its `*CONN`/`*CAP`/`*RES` body).
    """
    name_map_region = ssh(
        f"sed -n '/^\\*NAME_MAP$/,/^\\*D_NET /p' {shlex.quote(remote_path)}",
        timeout=300,
    )
    all_d_net_lines = ssh(
        f"grep -E '^\\*D_NET ' {shlex.quote(remote_path)}",
        timeout=300,
    )
    return name_map_region + "\n" + all_d_net_lines


# ---------------------------------------------------------------------------
# Per-report-kind checks
# ---------------------------------------------------------------------------


def check_global_timing(text):
    result = reports.parse_global_timing(text)
    return {"parser": "reports.parse_global_timing", "parsed": result}


def check_check_timing(text):
    result = reports.parse_check_timing(text)
    return {"parser": "reports.parse_check_timing", "parsed": result}


def check_path_report(text, mode):
    raw_blocks = len(_STARTPOINT_SPLIT_RE.split(text)) - 1
    header_match = _MAX_PATHS_RE.search(text[:2000])
    max_paths = int(header_match.group(1)) if header_match else 10 ** 9
    outcome = {
        "parser": "reports.parse_path_report",
        "mode": mode,
        "rawStartpointBlocks": raw_blocks,
        "maxPathsFromHeader": max_paths if header_match else None,
    }
    try:
        result = reports.parse_path_report(text, mode, max_paths)
    except core.AtcsError as exc:
        outcome["refusal"] = {"code": exc.code, "detail": str(exc.detail)}
        return outcome
    outcome["uniqueEndpoints"] = len(result["paths"])
    outcome["complete"] = result["complete"]
    return outcome


def check_path_detail_corpus(text):
    """Split `text` (a `setup.rpt`/`hold.rpt`) into its raw per-path blocks and
    run `adapters.parse_path_detail` over each one -- the per-arc grammar a
    real `pt-query.tcl` targeted report uses (see module docstring)."""
    blocks = _STARTPOINT_SPLIT_RE.split(text)[1:]
    all_known = 0
    any_known = 0
    none_known = 0
    field_known_counts = {field: 0 for field in ("cellDelay", "netDelay", "slew", "fanout", "location")}
    for block in blocks:
        detail = adapters.parse_path_detail(block)
        known_flags = {field: core.is_known(measure) for field, measure in detail.items()}
        for field, is_known in known_flags.items():
            if is_known:
                field_known_counts[field] += 1
        if all(known_flags.values()):
            all_known += 1
        elif any(known_flags.values()):
            any_known += 1
        else:
            none_known += 1
    return {
        "parser": "adapters.parse_path_detail",
        "pathBlocksExercised": len(blocks),
        "blocksWithAllFieldsKnown": all_known,
        "blocksWithSomeFieldsKnown": any_known,
        "blocksWithNoFieldsKnown": none_known,
        "perFieldKnownCount": field_known_counts,
    }


def check_drc(text):
    result = verification.parse_drc_summary(text)
    outcome = {"parser": "verification.parse_drc_summary", "truncated": result["truncated"]}
    if result["truncated"]:
        outcome["total"] = result["total"]
    else:
        outcome["total"] = result["total"]
        outcome["identityCount"] = len(result["identities"])
    return outcome


def check_connectivity(text):
    result = verification.parse_connectivity_summary(text)
    outcome = {"parser": "verification.parse_connectivity_summary", "truncated": result["truncated"]}
    if result["truncated"]:
        outcome["total"] = result["total"]
    else:
        outcome["total"] = result["total"]
        outcome["identityCount"] = len(result["identities"])
    return outcome


def check_starrc_log(text):
    """No Pack parser owns StarRC log *content* -- `adapters.run_tool`'s generic
    ERROR/Fatal line detection is the only thing that ever looks at a tool
    log, so this just informally exercises that same regex (never asserted
    as a pass/fail parser outcome) for corpus completeness."""
    matches = _ERROR_LOG_RE.findall(text)
    return {
        "parser": "none (adapters.run_tool's generic ERROR/Fatal log check exercised informally)",
        "errorLikeLines": len(matches),
    }


def check_spef_net_names(bounded_text, full_sha256, full_size):
    names = adapters.parse_spef_net_names(bounded_text)
    return {
        "parser": "adapters.parse_spef_net_names",
        "fullSpefSha256": full_sha256,
        "fullSpefSize": full_size,
        "resolvedNetNameCount": len(names) if names is not None else None,
    }


# ---------------------------------------------------------------------------
# Corpus walk
# ---------------------------------------------------------------------------


def record_file(records, path, sha256, size, outcome):
    entry = {"path": path, "sha256": sha256, "size": size, "outcome": outcome}
    records.append(entry)
    status = outcome.get("refusal") or ("truncated" if outcome.get("truncated") else "ok")
    print(f"[{status}] {path}  sha256={sha256}  size={size}")
    print(f"         {json.dumps(outcome, default=str)}")
    return entry


def run_pt_scenario_reports(records, root, label):
    """Foundation ROUND3 / B_lazy g001 `PT/reports/<scenario>/*.rpt` (see module docstring)."""
    for scenario in REQUIRED_SCENARIOS:
        scenario_dir = f"{root}/{scenario}" if label == "blazy" else f"{root}/SIGNOFF/ROUND3/PT/reports/{scenario}"
        for kind in ("global_timing", "setup", "hold", "check_timing", "constraints"):
            remote_path = f"{scenario_dir}/{kind}.rpt"
            sha256, size = remote_identity(remote_path)
            text = fetch_text(remote_path)
            if kind == "global_timing":
                outcome = check_global_timing(text)
            elif kind == "check_timing":
                outcome = check_check_timing(text)
            elif kind in ("setup", "hold"):
                outcome = check_path_report(text, kind)
                outcome["pathDetailCorpus"] = check_path_detail_corpus(text)
            else:  # constraints.rpt -- no Pack parser consumes this report
                outcome = {"parser": None, "note": "no Pack parser consumes constraints.rpt; recorded for corpus completeness only"}
            record_file(records, remote_path, sha256, size, outcome)


def run_physical_reports(records, drc_path, connectivity_path):
    for remote_path, check_fn in ((drc_path, check_drc), (connectivity_path, check_connectivity)):
        sha256, size = remote_identity(remote_path)
        text = fetch_text(remote_path)
        outcome = check_fn(text)
        record_file(records, remote_path, sha256, size, outcome)


def run_starrc_logs(records):
    for corner in ("cbest", "cworst_T"):
        remote_path = f"{FOUNDATION_ROOT}/SIGNOFF/ROUND3/STARRC/{corner}.log"
        sha256, size = remote_identity(remote_path)
        text = fetch_text(remote_path)
        outcome = check_starrc_log(text)
        record_file(records, remote_path, sha256, size, outcome)


def run_spef_net_names(records):
    seen_corners = set()
    for corner in SCENARIO_CORNER.values():
        if corner in seen_corners:
            continue
        seen_corners.add(corner)
        remote_path = f"{FOUNDATION_ROOT}/SIGNOFF/ROUND3/STARRC/swerv_wrapper.{corner}.spef"
        full_sha256, full_size = remote_identity(remote_path)
        bounded_text = fetch_bounded_spef_net_lines(remote_path)
        outcome = check_spef_net_names(bounded_text, full_sha256, full_size)
        outcome["boundedExtractBytes"] = len(bounded_text.encode("utf-8"))
        # Record against the FULL spef's own identity (the real source), not
        # the bounded extract -- the extract is only this script's own
        # bandwidth-bounded read path, never a distinct corpus artifact.
        record_file(records, remote_path, full_sha256, full_size, outcome)


def main():
    records = []

    print("=== Foundation ROUND3 PT reports ===")
    run_pt_scenario_reports(records, FOUNDATION_ROOT, "foundation")

    print("\n=== Foundation ROUND3 physical (verify_drc / verify_connectivity) ===")
    run_physical_reports(
        records,
        f"{FOUNDATION_ROOT}/RPT/xtop_round2_eco_route/verify_drc.rpt",
        f"{FOUNDATION_ROOT}/RPT/xtop_round2_eco_route/verify_connectivity.rpt",
    )

    print("\n=== Foundation ROUND3 StarRC logs ===")
    run_starrc_logs(records)

    print("\n=== Foundation ROUND3 StarRC SPEF net names (bounded) ===")
    run_spef_net_names(records)

    print("\n=== B_lazy Run g001 PT reports ===")
    run_pt_scenario_reports(records, f"{BLAZY_RUN_ROOT}/flow/iterations/g001/PT/reports", "blazy")

    print("\n=== B_lazy Run g001 physical (verify_drc / verify_connectivity) ===")
    run_physical_reports(
        records,
        f"{BLAZY_RUN_ROOT}/flow/iterations/g001/INNOVUS/RPT/verify_drc.rpt",
        f"{BLAZY_RUN_ROOT}/flow/iterations/g001/INNOVUS/RPT/verify_connectivity.rpt",
    )

    refusals = [r for r in records if r["outcome"].get("refusal")]
    print(f"\n=== Summary: {len(records)} files checked, {len(refusals)} unhandled refusals ===")
    for entry in refusals:
        print(f"  REFUSAL {entry['path']}: {entry['outcome']['refusal']}")

    if "--json" in sys.argv:
        out_path = Path(sys.argv[sys.argv.index("--json") + 1])
        out_path.write_text(json.dumps(records, indent=2, default=str), encoding="utf-8")
        print(f"\nWrote {out_path}")

    return 1 if refusals else 0


if __name__ == "__main__":
    sys.exit(main())
