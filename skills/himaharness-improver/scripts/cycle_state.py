#!/usr/bin/env python3
"""Atomic compact-resistant state for the HimaHarness improver/tester loop."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_ROOT = Path("/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/improver-tester")
PHASES = {"PREPARING", "DISPATCHED", "RUNNING", "HANDOFF_READY", "FIXING", "RELEASED", "COMPLETE", "PAUSED"}
TERMINAL = {"COMPLETE", "PAUSED"}


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


def absolute(value: str, label: str) -> str:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise SystemExit(f"{label} must be an absolute path")
    return str(path.resolve())


def current() -> dict:
    path = root() / "cycle.json"
    if not path.is_file():
        raise SystemExit("no active cycle; run init first")
    document = read(path)
    if document.get("schema") != "hima.improver-cycle/1" or document.get("phase") not in PHASES:
        raise SystemExit("cycle.json has an unsupported schema or phase")
    return document


def command_init(args) -> None:
    path = root() / "cycle.json"
    if path.exists() and read(path).get("phase") not in TERMINAL:
        raise SystemExit("an unfinished cycle already exists")
    document = {
        "schema": "hima.improver-cycle/1", "cycleId": args.cycle_id,
        "phase": "PREPARING", "createdAt": now(), "updatedAt": now(),
        "mainSha": args.main_sha, "packVersion": args.pack_version,
        "packDigest": args.pack_digest, "releaseUrl": args.release_url,
        "manualPath": absolute(args.manual, "manual"),
        "claudeSession": args.claude_session,
        "testerWorktree": absolute(args.tester_worktree, "tester worktree"),
        "testerBranch": args.tester_branch,
        "campaignId": None, "runId": None, "reportPath": None,
        "lastNote": "cycle initialized",
    }
    atomic(path, document)
    print(json.dumps(document, indent=2, sort_keys=True))


def command_show(_args) -> None:
    base = root()
    result = {"root": str(base), "cycle": None, "checkpoint": None, "handoff": None}
    for name, key in (("cycle.json", "cycle"), ("tester-checkpoint.json", "checkpoint"),
                      ("tester-handoff.json", "handoff")):
        path = base / name
        if path.is_file():
            result[key] = read(path)
    print(json.dumps(result, indent=2, sort_keys=True))


def command_update(args) -> None:
    document = current()
    if args.phase and args.phase not in PHASES:
        raise SystemExit("unknown phase")
    mapping = {"phase": args.phase, "campaignId": args.campaign_id,
               "runId": args.run_id,
               "reportPath": absolute(args.report, "report") if args.report else None,
               "lastNote": args.note}
    for key, value in mapping.items():
        if value is not None:
            document[key] = value
    document["updatedAt"] = now()
    atomic(root() / "cycle.json", document)
    print(json.dumps(document, indent=2, sort_keys=True))


def command_consume(args) -> None:
    document = current()
    handoff_path = Path(args.handoff).expanduser().resolve() if args.handoff else root() / "tester-handoff.json"
    handoff = read(handoff_path)
    if handoff.get("schema") != "hima.tester-handoff/1":
        raise SystemExit("handoff has an unsupported schema")
    if handoff.get("cycleId") != document["cycleId"]:
        raise SystemExit("handoff belongs to a different cycle")
    report = Path(absolute(handoff.get("reportPath", ""), "report"))
    if not report.is_file() or hashlib.sha256(report.read_bytes()).hexdigest() != handoff.get("reportSha256"):
        raise SystemExit("handoff report is missing or changed")
    history = root() / "history"
    history.mkdir(parents=True, exist_ok=True)
    destination = history / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-handoff.json")
    shutil.copy2(handoff_path, destination)
    document.update({"phase": "HANDOFF_READY", "updatedAt": now(),
                     "campaignId": handoff.get("campaignId"), "runId": handoff.get("runId"),
                     "reportPath": str(report), "handoffPath": str(destination),
                     "lastNote": handoff.get("summary")})
    atomic(root() / "cycle.json", document)
    print(json.dumps(document, indent=2, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    i = sub.add_parser("init")
    for name in ("cycle-id", "main-sha", "pack-version", "pack-digest", "release-url",
                 "manual", "claude-session", "tester-worktree", "tester-branch"):
        i.add_argument("--" + name, required=True)
    i.set_defaults(func=command_init)
    s = sub.add_parser("show"); s.set_defaults(func=command_show)
    u = sub.add_parser("update")
    u.add_argument("--phase", choices=sorted(PHASES)); u.add_argument("--campaign-id")
    u.add_argument("--run-id"); u.add_argument("--report"); u.add_argument("--note")
    u.set_defaults(func=command_update)
    c = sub.add_parser("consume-handoff"); c.add_argument("--handoff"); c.set_defaults(func=command_consume)
    return p


if __name__ == "__main__":
    args = parser().parse_args()
    args.func(args)
