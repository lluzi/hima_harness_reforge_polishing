#!/usr/bin/env python3
"""Tester checkpoint and evidence handoff for HimaHarness trials."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_ROOT = Path("/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/improver-tester")


def root() -> Path:
    return Path(os.environ.get("HIMA_COORDINATION_ROOT", DEFAULT_ROOT)).expanduser().resolve()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read(path: Path):
    return json.loads(path.read_text())


def atomic(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def cycle(cycle_id: str) -> dict:
    path = root() / "cycle.json"
    if not path.is_file():
        raise SystemExit("improver cycle.json is absent")
    document = read(path)
    if document.get("schema") != "hima.improver-cycle/1" or document.get("cycleId") != cycle_id:
        raise SystemExit("tester cycle identity disagrees with improver cycle")
    return document


def absolute(value: str, label: str) -> str:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise SystemExit(f"{label} must be an absolute path")
    return str(path.resolve())


def show(_args) -> None:
    result = {}
    for name in ("cycle.json", "tester-checkpoint.json", "tester-handoff.json"):
        path = root() / name
        result[name] = read(path) if path.is_file() else None
    print(json.dumps(result, indent=2, sort_keys=True))


def checkpoint(args) -> None:
    assigned = cycle(args.cycle_id)
    document = {
        "schema": "hima.tester-checkpoint/1", "cycleId": args.cycle_id,
        "updatedAt": now(), "status": args.status,
        "packVersion": assigned["packVersion"], "packDigest": assigned["packDigest"],
        "campaignId": args.campaign_id, "runId": args.run_id,
        "ownerSession": args.owner_session, "workspace": args.workspace,
        "currentNode": args.current_node, "runningJob": args.running_job,
        "lastEvidence": args.last_evidence, "nextAction": args.next_action,
        "nextCheck": args.next_check, "reportPath": absolute(args.report, "report") if args.report else None,
        "testerWorktree": assigned["testerWorktree"], "testerBranch": assigned["testerBranch"],
    }
    atomic(root() / "tester-checkpoint.json", document)
    print(json.dumps(document, indent=2, sort_keys=True))


def handoff(args) -> None:
    assigned = cycle(args.cycle_id)
    checkpoint_path = root() / "tester-checkpoint.json"
    if not checkpoint_path.is_file():
        raise SystemExit("write a tester checkpoint before handoff")
    latest = read(checkpoint_path)
    if latest.get("cycleId") != args.cycle_id:
        raise SystemExit("checkpoint belongs to a different cycle")
    report = Path(absolute(args.report, "report"))
    if not report.is_file():
        raise SystemExit("report does not exist")
    document = {
        "schema": "hima.tester-handoff/1", "cycleId": args.cycle_id,
        "createdAt": now(), "status": args.status,
        "packVersion": assigned["packVersion"], "packDigest": assigned["packDigest"],
        "campaignId": latest.get("campaignId"), "runId": latest.get("runId"),
        "reportPath": str(report), "reportSha256": hashlib.sha256(report.read_bytes()).hexdigest(),
        "testerWorktree": assigned["testerWorktree"], "testerBranch": assigned["testerBranch"],
        "fixCommit": args.fix_commit, "summary": args.summary,
    }
    atomic(root() / "tester-handoff.json", document)
    print("CODEX_HANDOFF_READY: " + str(report))


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    s = sub.add_parser("show"); s.set_defaults(func=show)
    c = sub.add_parser("checkpoint")
    c.add_argument("--cycle-id", required=True); c.add_argument("--status", required=True,
        choices=("PREPARING", "RUNNING", "WAITING", "PAUSED", "BLOCKED", "COMPLETE"))
    for name in ("campaign-id", "run-id", "owner-session", "workspace", "current-node",
                 "running-job", "last-evidence", "next-action", "next-check", "report"):
        c.add_argument("--" + name)
    c.set_defaults(func=checkpoint)
    h = sub.add_parser("handoff")
    h.add_argument("--cycle-id", required=True); h.add_argument("--status", required=True,
        choices=("BLOCKED", "COMPLETE", "DECISION")); h.add_argument("--report", required=True)
    h.add_argument("--summary", required=True); h.add_argument("--fix-commit")
    h.set_defaults(func=handoff)
    return p


if __name__ == "__main__":
    args = parser().parse_args()
    args.func(args)
