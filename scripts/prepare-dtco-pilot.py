#!/usr/bin/env python3
"""Stage and verify the fixed PLS-18 flow without starting a model or EDA tool."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import tarfile
import tempfile
from pathlib import Path
from sys import stderr
from typing import Any


REPO = Path(__file__).resolve().parent.parent
FLOW = REPO / "packs/aes-tsmc28-dtco/flow"
INPUTS = REPO / ".hima-tmp/pls-frontier/dtco-inputs.json"
HOST = "luzi@192.168.50.41"
REMOTE_ROOT = "/data/eda/project/hima_harness/polishing-inputs"
SSH_OPTIONS = ("BatchMode=yes", "ConnectTimeout=8", "ControlPath=none")
DESTINATION_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            value.update(part)
    return value.hexdigest()


def inventory(root: Path) -> dict[str, Path]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("the Pack flow must be a plain directory")
    found: dict[str, Path] = {}
    for item in sorted(root.rglob("*")):
        if item.is_symlink():
            raise ValueError(f"symlink refused: {item}")
        if item.is_file():
            found[item.relative_to(root).as_posix()] = item
        elif not item.is_dir():
            raise ValueError(f"non-file input refused: {item}")
    if not found:
        raise ValueError("the Pack flow is empty")
    return found


def current_files() -> tuple[dict[str, Path], dict[str, str]]:
    if INPUTS.is_symlink() or not INPUTS.is_file():
        raise ValueError("private dtco-inputs.json is unavailable or unsafe")
    source = inventory(FLOW)
    hashes = {name: digest(item) for name, item in source.items()}
    hashes["inputs.json"] = digest(INPUTS)
    return source, hashes


def inventory_digest(hashes: dict[str, str]) -> str:
    raw = json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def manifest_for(name: str, hashes: dict[str, str], status: str) -> dict[str, Any]:
    if not DESTINATION_NAME.fullmatch(name):
        raise ValueError("destination must match [a-z0-9][a-z0-9._-]{0,79}")
    return {
        "schema": 1,
        "status": status,
        "host": HOST,
        "sshOptions": list(SSH_OPTIONS),
        "sourceFlow": "packs/aes-tsmc28-dtco/flow",
        "sourceInputs": ".hima-tmp/pls-frontier/dtco-inputs.json",
        "destinationName": name,
        "destination": f"{REMOTE_ROOT}/{name}",
        "files": hashes,
        "inventorySha256": inventory_digest(hashes),
    }


def load_manifest(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("staging manifest must be a plain file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("staging manifest is unreadable") from error
    if not isinstance(value, dict):
        raise ValueError("staging manifest must contain one object")
    return value


def ssh_command(command: str, *, input_file: Any = None) -> subprocess.CompletedProcess:
    argv = ["ssh"]
    for option in SSH_OPTIONS:
        argv.extend(("-o", option))
    argv.extend((HOST, command))
    return subprocess.run(
        argv,
        stdin=input_file,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=input_file is None,
        check=False,
        timeout=120,
    )


REMOTE_INVENTORY = """\
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
if root.is_symlink() or not root.is_dir():
    raise SystemExit(2)
found = {}
for item in sorted(root.rglob('*')):
    if item.is_symlink():
        raise SystemExit(3)
    if item.is_file():
        value = hashlib.sha256()
        with item.open('rb') as source:
            for part in iter(lambda: source.read(1024 * 1024), b''):
                value.update(part)
        found[item.relative_to(root).as_posix()] = value.hexdigest()
    elif not item.is_dir():
        raise SystemExit(4)
print(json.dumps(found, sort_keys=True, separators=(',', ':')))
"""


def verify_remote(remote: str, expected: dict[str, str]) -> None:
    command = shlex.join(("/usr/bin/python3", "-c", REMOTE_INVENTORY, remote))
    checked = ssh_command(command)
    if checked.returncode != 0:
        raise RuntimeError("remote inventory could not be verified")
    try:
        actual = json.loads(checked.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("remote inventory returned invalid JSON") from error
    if actual != expected:
        raise RuntimeError("remote inventory differs from the complete local inventory")


def verify_manifest(path: Path) -> dict[str, Any]:
    held = load_manifest(path)
    name = held.get("destinationName")
    if not isinstance(name, str) or not DESTINATION_NAME.fullmatch(name):
        raise ValueError("staging manifest has an invalid destination name")
    _, hashes = current_files()
    expected = manifest_for(name, hashes, "staged")
    if held != expected:
        raise ValueError("staging manifest does not match the current fixed sources")
    verify_remote(expected["destination"], hashes)
    return expected


def stage(name: str, out: Path) -> dict[str, Any]:
    source, hashes = current_files()
    manifest = manifest_for(name, hashes, "staged")
    remote = manifest["destination"]
    if out.exists() or out.is_symlink():
        raise ValueError(f"local manifest exists: {out}")

    absent = ssh_command(shlex.join(("test", "!", "-e", remote)))
    if absent.returncode != 0:
        raise ValueError("remote destination exists or is inaccessible")

    with tempfile.TemporaryDirectory(prefix="hima-dtco-stage-") as temporary:
        archive = Path(temporary) / "flow.tar"
        with tarfile.open(archive, "w") as payload:
            for relative, item in source.items():
                payload.add(item, arcname=relative, recursive=False)
            payload.add(INPUTS, arcname="inputs.json", recursive=False)
        remote_setup = (
            "set -eu; umask 077; "
            f"mkdir -- {shlex.quote(remote)}; "
            f"tar -x -f - -C {shlex.quote(remote)}"
        )
        with archive.open("rb") as payload:
            copied = ssh_command(remote_setup, input_file=payload)
        if copied.returncode != 0:
            raise RuntimeError("remote copy failed; the incomplete destination was retained")

    verify_remote(remote, hashes)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", help="fresh child name under polishing-inputs")
    parser.add_argument("--out", help="fresh local staging manifest")
    parser.add_argument("--manifest", help="existing staging manifest for remote verification")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()

    if args.verify_only:
        if args.manifest is None or args.destination is not None or args.out is not None or args.preflight_only:
            raise ValueError("--verify-only requires only --manifest")
        verified = verify_manifest(Path(args.manifest).resolve())
        print(json.dumps({
            "status": "verified",
            "destination": verified["destination"],
            "fileCount": len(verified["files"]),
            "inventorySha256": verified["inventorySha256"],
        }, indent=2))
        return 0

    if args.destination is None or args.manifest is not None:
        raise ValueError("--destination is required for staging or preflight")
    _, hashes = current_files()
    if args.preflight_only:
        if args.out is not None:
            raise ValueError("--preflight-only does not write --out")
        manifest = manifest_for(args.destination, hashes, "staged")
        print(json.dumps({
            "status": "preflight-passed",
            "scope": "local inventory only; no SSH, model, Host, desktop, or EDA",
            "fileCount": len(hashes),
            "manifest": manifest,
        }, indent=2))
        return 0
    if args.out is None:
        raise ValueError("--out is required when staging")
    written = stage(args.destination, Path(args.out).resolve())
    print(json.dumps({
        "status": "staged",
        "manifest": str(Path(args.out).resolve()),
        "destination": written["destination"],
        "fileCount": len(written["files"]),
        "inventorySha256": written["inventorySha256"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"prepare-dtco-pilot: {error}", file=stderr)
        raise SystemExit(2)
