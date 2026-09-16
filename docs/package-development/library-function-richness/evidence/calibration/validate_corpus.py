#!/usr/bin/env python3
"""Validate the identity-only LFR calibration corpus manifest.

The manifest deliberately contains locators, hashes and compact facts.  Raw Site
inputs and commercial-tool outputs remain outside Git.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Mapping


SCHEMA = "hima.library-richness.calibration-corpus/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_TRIALS = {"first-clean-low-gain", "corrected-pressure-negative"}
REQUIRED_EVIDENCE = {
    "predicted-liberty",
    "dc-adoption",
    "generated-route-record",
    "final-route-timing",
    "final-route-census",
    "matched-comparison",
}


class CorpusError(ValueError):
    """The calibration manifest violates the frozen corpus contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CorpusError(message)


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None


def canonical_identity(document: Mapping[str, Any]) -> str:
    """Return the manifest identity with its self-hash removed."""

    payload = copy.deepcopy(dict(document))
    payload.pop("corpusIdentitySha256", None)
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def rtl_set_identity(rtl: list[Mapping[str, Any]]) -> str:
    rows = [{"path": item["path"], "sha256": item["sha256"]} for item in rtl]
    encoded = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_locator(locator: Mapping[str, Any], label: str) -> None:
    _require(isinstance(locator.get("path"), str) and locator["path"], f"{label}: path")
    _require(_is_sha256(locator.get("sha256")), f"{label}: sha256")
    _require(locator.get("committed") is False, f"{label}: raw payload must not be committed")
    _require(
        locator.get("storage") in {"site-only", "local-private-retained"},
        f"{label}: storage",
    )
    if "bytes" in locator:
        _require(
            isinstance(locator["bytes"], int) and locator["bytes"] > 0,
            f"{label}: bytes",
        )


def validate_manifest(document: Mapping[str, Any]) -> None:
    """Validate stable identities, trial separation and evidence coverage."""

    _require(document.get("schema") == SCHEMA, "unsupported schema")
    _require(document.get("corpusId") == "aes-tsmc28-47cell-commercial-v1", "corpusId")
    _require(
        _is_sha256(document.get("corpusIdentitySha256")), "corpusIdentitySha256"
    )
    _require(
        document["corpusIdentitySha256"] == canonical_identity(document),
        "corpus identity mismatch",
    )

    handling = document.get("handling")
    _require(isinstance(handling, dict), "handling")
    _require(handling.get("rawPayloadsCommitted") is False, "raw payload policy")
    _require(handling.get("siteDeletionAllowed") is False, "Site deletion policy")

    design = document.get("design")
    _require(isinstance(design, dict), "design")
    _require(design.get("top") == "aes_cipher_top", "calibration top")
    rtl = design.get("rtl")
    _require(isinstance(rtl, list) and len(rtl) == 7, "seven-file AES RTL identity")
    for index, item in enumerate(rtl):
        _validate_locator(item, f"design.rtl[{index}]")
    _require(
        any(item["path"].endswith("/aes_cipher_top.v") for item in rtl),
        "top RTL is absent",
    )

    constraints = document.get("constraints")
    _require(isinstance(constraints, dict), "constraints")
    _validate_locator(constraints.get("source", {}), "constraints.source")
    _validate_locator(constraints.get("equivalentSource", {}), "constraints.equivalentSource")
    summary = constraints.get("summary")
    _require(isinstance(summary, dict), "constraints.summary")
    _require(summary.get("clockName") == "clk", "clock identity")
    _require(summary.get("clockPeriodNs") == 0.5, "clock period")
    _require(summary.get("dcUncertaintyNs") == 0.25, "DC uncertainty")
    _require(summary.get("pathGroups", {}).get("reg2reg", {}).get("weight") == 10, "reg2reg weight")

    libraries = document.get("libraries")
    _require(isinstance(libraries, dict), "libraries")
    for key in ("foundryLiberty", "foundryDb", "predicted47CellLiberty"):
        _validate_locator(libraries.get(key, {}), f"libraries.{key}")
    _require(
        libraries["predicted47CellLiberty"].get("cellCount") == 47,
        "predicted Library cell count",
    )

    trials = document.get("trials")
    _require(isinstance(trials, list) and len(trials) == 2, "two calibration trials")
    _require({trial.get("id") for trial in trials} == REQUIRED_TRIALS, "trial identities")
    shared = document.get("sharedIdentity")
    _require(isinstance(shared, dict), "sharedIdentity")
    _require(shared.get("rtlSetSha256") == rtl_set_identity(rtl), "RTL set identity")
    for trial in trials:
        for key, expected in shared.items():
            _require(trial.get("sharedIdentity", {}).get(key) == expected, f"{trial['id']}: {key}")
        evidence = trial.get("evidence")
        _require(isinstance(evidence, list), f"{trial['id']}: evidence")
        _require({item.get("kind") for item in evidence} == REQUIRED_EVIDENCE, f"{trial['id']}: evidence kinds")
        for index, item in enumerate(evidence):
            _validate_locator(item, f"{trial['id']}.evidence[{index}]")
        _validate_locator(trial.get("retainedIndex", {}), f"{trial['id']}.retainedIndex")
        facts = trial.get("facts")
        _require(isinstance(facts, dict), f"{trial['id']}: facts")
        _require(facts.get("dcAdoptedCandidateCount") == 21, f"{trial['id']}: adoption candidates")
        _require(facts.get("dcAdoptedInstanceCount") == 307, f"{trial['id']}: adoption instances")
        _require(facts.get("comparisonValid") is True, f"{trial['id']}: comparison validity")

    by_id = {trial["id"]: trial for trial in trials}
    first = by_id["first-clean-low-gain"]
    corrected = by_id["corrected-pressure-negative"]
    _require(first["conditions"]["routeUncertaintyNs"] == 0.125, "first route pressure")
    _require(corrected["conditions"]["routeUncertaintyNs"] == 0.175, "corrected route pressure")
    _require(first["conditions"]["ctsPolicy"] != corrected["conditions"]["ctsPolicy"], "CTS conditions must differ")
    _require(first["facts"]["routeCustomInstanceCount"] == 250, "first route census")
    _require(corrected["facts"]["routeCustomInstanceCount"] == 222, "corrected route census")
    _require(first["facts"]["fmaxImprovementPct"] > 0, "first trial sign")
    _require(corrected["facts"]["fmaxImprovementPct"] < 0, "corrected trial sign")

    gaps = document.get("knownGaps")
    _require(isinstance(gaps, list) and gaps, "known evidence gaps")
    _require(all(isinstance(gap, dict) and gap.get("id") and gap.get("impact") for gap in gaps), "gap shape")


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as stream:
        document = json.load(stream)
    _require(isinstance(document, dict), "manifest root")
    return document


def verify_local_retained(document: Mapping[str, Any], repository: Path) -> None:
    """Verify ignored local evidence indexes when the current workspace retains them."""

    for trial in document["trials"]:
        locator = trial["retainedIndex"]
        path = repository / locator["path"]
        _require(path.is_file(), f"{trial['id']}: retained index is unavailable: {path}")
        _require(path.stat().st_size == locator["bytes"], f"{trial['id']}: retained bytes")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        _require(digest.hexdigest() == locator["sha256"], f"{trial['id']}: retained sha256")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "manifest",
        nargs="?",
        type=Path,
        default=Path(__file__).with_name("corpus.v1.json"),
    )
    parser.add_argument("--print-identity", action="store_true")
    parser.add_argument(
        "--verify-local-retained",
        action="store_true",
        help="strictly hash the ignored local evidence indexes named by the manifest",
    )
    args = parser.parse_args()
    document = load_manifest(args.manifest)
    validate_manifest(document)
    if args.verify_local_retained:
        repository = Path(__file__).resolve().parents[5]
        verify_local_retained(document, repository)
    if args.print_identity:
        print(canonical_identity(document))
    else:
        print(f"PASS {document['corpusId']} {document['corpusIdentitySha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
