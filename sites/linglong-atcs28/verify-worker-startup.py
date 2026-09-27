#!/usr/bin/env python3
"""Administrator-owned prelaunch verification. Import only a fresh, verified source snapshot."""
import argparse
import glob
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

def plain(path, root=None):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError("sensitive path contains a symlink")
    resolved = path.resolve(strict=True)
    if root is not None and not resolved.is_relative_to(Path(root).resolve(strict=True)):
        raise ValueError("sensitive path escapes its qualified root")
    return resolved

def file_hash(path):
    return hashlib.sha256(plain(path).read_bytes()).hexdigest()

def flow_hash(flow):
    flow = plain(flow)
    entries = []
    for rel in ("atcs_cli.py", "atcs", "templates"):
        root = plain(flow / rel, flow)
        paths = [root] if root.is_file() else sorted(root.rglob("*"))
        for entry in paths:
            plain(entry, flow)
            if entry.is_file() and "__pycache__" not in entry.parts and entry.suffix not in (".pyc", ".pyo"):
                entries.append({"path": entry.relative_to(flow).as_posix(), "size": entry.stat().st_size,
                                "sha256": file_hash(entry)})
    entries.sort(key=lambda item: item["path"])
    canonical = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(canonical).hexdigest()

def verify_database_tree(directory, workspace, write_root, read_roots):
    """Vendor checkpoints may link read-only LEF data; executable/control paths never use this exception."""
    for path in directory.rglob("*"):
        if path.is_symlink():
            target = plain(path.resolve(strict=True))
            if (not target.is_file() or target.is_relative_to(write_root)
                    or not any(target.is_relative_to(root) for root in (workspace, *read_roots))):
                raise ValueError("database data link escapes qualified read-only roots")
        else:
            plain(path, workspace)

def verify(workspace, slot, expected_flow, profile_path, profile_hash, admin_root):
    workspace = plain(workspace)
    if slot not in ("w01", "w02", "w03"):
        raise ValueError("unknown slot")
    profile_path = plain(profile_path)
    if profile_path.is_relative_to(workspace) or file_hash(profile_path) != profile_hash:
        raise ValueError("Site profile must be pinned outside the Campaign write root")
    profile = json.loads(profile_path.read_text())
    roots = [plain(root) for root in profile["qualifiedReadRoots"]]
    if plain(admin_root).is_relative_to(workspace):
        raise ValueError("administrator snapshot root must be outside the Campaign")
    flow = plain(workspace / "flow", workspace)
    if flow_hash(flow) != expected_flow:
        raise ValueError("flow bytes differ from the qualified source")
    snapshot = Path(tempfile.mkdtemp(prefix="bootstrap-", dir=plain(admin_root)))
    trusted = snapshot / "flow"
    trusted.mkdir()
    shutil.copy2(flow / "atcs_cli.py", trusted / "atcs_cli.py")
    for name in ("atcs", "templates"):
        shutil.copytree(flow / name, trusted / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"))
    if flow_hash(trusted) != expected_flow:
        raise ValueError("source changed while preparing the trusted snapshot")
    sys.path.insert(0, str(trusted))
    import atcs_cli as cli
    from atcs import core, adapters, workspaces
    base = cli._read_declared(plain(workspace / "state/working-state.json", workspace), "design-state")
    if base["top"] != profile["design"]:
        raise ValueError("base design differs from the administrator Site profile")
    workers = json.loads(plain(workspace / "state/workers.json", workspace).read_text())
    entry = workers["workers"][slot]
    manifest = entry["workspaceManifest"]
    package = entry["workPackage"]
    revision = manifest.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError("invalid worker revision")
    root = plain(workspace / "workspaces" / slot / ("r" + str(revision)), workspace)
    prefix = "atcs_" + slot + "_r" + str(revision) + "_"
    if (manifest.get("taskId") != slot or package.get("taskId") != slot
            or manifest.get("root") != str(root.relative_to(workspace)) + "/"
            or entry.get("root") != manifest["root"] or manifest.get("namePrefix") != prefix
            or entry.get("namePrefix") != prefix or manifest.get("baseStateId") != base["id"]
            or package.get("baseStateId") != base["id"] or manifest.get("workPackageId") != package.get("id")
            or entry.get("workPackageId") != package.get("id") or entry.get("manifestId") != manifest.get("id")
            or manifest.get("readOnly") != workspaces._base_sources(base)):
        raise ValueError("worker slot/manifest/base identity mismatch")
    for kind, value in (("workspace-manifest", manifest), ("work-package", package)):
        body = {key: item for key, item in value.items() if key not in ("schema", "id")}
        if core.stamp(kind, body) != value:
            raise ValueError("worker artifact identity mismatch")
    if core.read_artifact(plain(root / "manifest.json", root), "workspace-manifest") != manifest:
        raise ValueError("worker manifest differs from its prepared revision")
    workspaces.validate_work_package({key: item for key, item in package.items() if key not in ("schema", "id")}, base, profile)
    for ref in (base["database"], base["netlist"], base["def"], *base.get("sdc", []), *base.get("spef", {}).values()):
        path = plain(workspace / ref["path"], workspace)
        if path.is_relative_to(root):
            raise ValueError("base input lies in the writable worker slot")
        if file_hash(path) != ref["sha256"]:
            raise ValueError("base input bytes changed")
    database_data = plain(workspace / (base["database"]["path"] + ".dat"), workspace)
    if database_data.is_relative_to(root):
        raise ValueError("base database data lies in the writable worker slot")
    verify_database_tree(database_data, workspace, root, roots)
    if core.tree_digest(database_data) != base["database"]["datDigest"]:
        raise ValueError("base database data changed")
    for pattern in (profile["techLef"], profile["cellLefGlob"]):
        matches = glob.glob(pattern)
        if not matches:
            raise ValueError("missing physical library input")
        for match in matches:
            path = plain(match)
            if not any(path.is_relative_to(read_root) for read_root in roots):
                raise ValueError("library input escapes qualified read roots")
    context_record = json.loads(plain(workspace / "state/xtop-context.json", workspace).read_text())
    for key in ("libraryTcl", "staData"):
        target = plain(workspace / context_record[key]["path"], workspace / "research/observe")
        for path in target.rglob("*") if target.is_dir() else [target]:
            plain(path, workspace / "research/observe")
    context = cli._verified_xtop_context(workspace, base["id"], profile)
    for refs in context["libraryFiles"].values():
        for ref in refs:
            path = plain(ref["path"])
            if not any(path.is_relative_to(read_root) for read_root in roots):
                raise ValueError("timing library escapes qualified read roots")
    operator = adapters.compile_xtop_operator_task(manifest, profile["design"], profile["techLef"],
        profile["cellLefGlob"], str(workspace / base["netlist"]["path"]),
        str(workspace / base["def"]["path"]), str(root), context)
    operator_path = plain(root / "operator.tcl", root)
    manual_path = plain(root / "xtop-analysis-manual.tcl", root)
    ops = root / "ops.jsonl"
    if entry.get("opsLog") != str(ops) or entry.get("sessionTcl") != str(manual_path):
        raise ValueError("worker output/startup path mismatch")
    manual = adapters.compile_xtop_analysis_manual_task(manifest, package["editDomain"], operator_path, ops)
    if (operator_path.read_text() != operator["tcl"] or manual_path.read_text() != manual["tcl"]
            or file_hash(manual_path) != entry.get("sessionTclSha256")):
        raise ValueError("generated Tcl differs from independent regeneration")
    for path in root.rglob("*"):
        plain(path, root)
        if path.is_file() and path.stat().st_nlink != 1:
            raise ValueError("writable slot contains a multiply linked file")
    trusted_operator = snapshot / "operator.tcl"
    trusted_operator.write_text(operator["tcl"])
    trusted_manual = snapshot / "startup.tcl"
    trusted_manual.write_text(adapters.compile_xtop_analysis_manual_task(
        manifest, package["editDomain"], trusted_operator, ops)["tcl"])
    print(json.dumps({"startup": str(trusted_manual), "slotRoot": str(root), "flow": expected_flow}), flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("workspace", "slot", "flow", "profile", "profile-hash", "admin-root"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    verify(args.workspace, args.slot, args.flow, args.profile, args.profile_hash, args.admin_root)
