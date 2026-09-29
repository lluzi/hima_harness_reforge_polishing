#!/usr/bin/env python3
"""Administrator-owned: every Operator attempt of a worker slot starts in a slot holding no earlier attempt.

`prepare-workers` (the Pack's `workspaces.prepare`) picks a slot's round directory
`workspaces/<slot>/r<N>` once per plan and bakes it into `state/workers.json` and the slot's session
Tcl; the Harness retries the operate node with the same argv (`<wrapper> <workspace> <slot>`), so
every attempt of one plan lands in the same `r<N>`. #64 treatment attempt 1, slot w02: attempt 1's
XTop left its workspaces (`swerv_wrapper_operator/`, `..._operator_baseline/`) and 44 hard-linked
`.exclusive.cdslck*` files there; the verifier refused attempts 2 and 5 ("writable slot contains a
multiply linked file") and attempt 4's XTop stopped at `save_workspace` ("Directory exists").

Before the verifier, this moves every entry of `r<N>` except the three files `prepare-workers` wrote
(`manifest.json`, `operator.tcl`, `xtop-analysis-manual.tcl`) into a new sibling
`workspaces/<slot>/r<N>.attempt-<k>/` (the first free `k`), by rename on the same file system.
Nothing is deleted: the earlier attempt's outputs stay beside the slot as evidence, outside the
writable root the verifier checks and the container mounts. A slot holding only its prepared
files is left alone. It never ends a process: an attempt whose XTop survived its close (the
Harness records `process-survived`) still needs a person to end that wrapper's container.
"""
import argparse
import json
import os
from pathlib import Path

PREPARED = ("manifest.json", "operator.tcl", "xtop-analysis-manual.tcl")
SLOTS = ("w01", "w02", "w03", "w04", "w05", "w06")


def plain(path, root=None):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError("sensitive path contains a symlink")
    resolved = path.resolve(strict=True)
    if root is not None and not resolved.is_relative_to(Path(root).resolve(strict=True)):
        raise ValueError("sensitive path escapes its qualified root")
    return resolved


def fresh_slot(workspace, slot):
    """`{"slotRoot", "retired", "moved"}`: the slot's round directory and what left it, if anything."""
    workspace = plain(workspace)
    if slot not in SLOTS:
        raise ValueError("unknown slot")
    workers = json.loads(plain(workspace / "state/workers.json", workspace).read_text())
    entry = workers["workers"][slot]
    if entry.get("parked") is not None or (entry.get("workPackage") or {}).get("parked") is True:
        raise ValueError("slot is parked: its plan runs no XTop session there")
    revision = (entry.get("workspaceManifest") or {}).get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError("invalid worker revision")
    slot_dir = plain(workspace / "workspaces" / slot, workspace)
    root = plain(slot_dir / ("r" + str(revision)), workspace)
    leftovers = sorted(path.name for path in root.iterdir() if path.name not in PREPARED)
    if not leftovers:
        return {"slotRoot": str(root), "retired": None, "moved": []}
    attempt = 1
    while (slot_dir / f"r{revision}.attempt-{attempt}").exists():
        attempt += 1
    retired = slot_dir / f"r{revision}.attempt-{attempt}"
    retired.mkdir()
    for name in leftovers:
        os.rename(root / name, retired / name)
    return {"slotRoot": str(root), "retired": str(retired), "moved": leftovers}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--slot", required=True)
    args = parser.parse_args()
    print(json.dumps(fresh_slot(args.workspace, args.slot)), flush=True)
