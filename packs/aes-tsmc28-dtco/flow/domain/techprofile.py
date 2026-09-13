"""Technology profile: the one place that knows a PDK's names and conventions.

Before this existed the flow was bound to sky130 in six functional places -- the device-model prefix
in compose_netlist.py and derive_cell.py, the power/bulk rail names, the tapless assumption, the
lclayout tech file, and the default library profile in mine_patterns.py. Porting to a second
technology meant editing all of them, so the package could only ever target one PDK.

A profile is data, not code: flow/config/tech/<name>.json. Select with XSPACE_TECH (default
sky130hd) so existing sky130 runs are unchanged by this refactor.

The fields that actually differ between the two shipped technologies are the device-model prefix
and names, the rail and bulk pin names, the tap-cell name and the tapless flag, the drive-strength
and threshold-voltage naming, and the drawn gate length.

For the open PDK those values are public and the shipped profile carries them. For the proprietary
one it carries NONE of them: every identifier is null in the packaged template and the run binds a
filled profile. What the package does own is the SHAPE of a profile and the facts that are not
anybody's data - that the proprietary library is not tapless, so a tap cell must be placed before
placement, and that the device envelope bounds the search.
"""

import json
import os

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config", "tech")
_CACHE = {}


class TechProfileError(RuntimeError):
    pass


def available():
    """Names of every shipped technology profile."""
    try:
        return sorted(f[:-5] for f in os.listdir(_DIR) if f.endswith(".json"))
    except OSError:
        return []


def load(name=None):
    """Load a profile. `name` defaults to $XSPACE_TECH, then sky130hd."""
    name = name or os.environ.get("XSPACE_TECH") or "sky130hd"
    if name in _CACHE:
        return _CACHE[name]
    path = os.path.join(_DIR, name + ".json")
    if not os.path.exists(path):
        raise TechProfileError(
            "unknown technology %r; available: %s" % (name, ", ".join(available()) or "(none)")
        )
    with open(path) as fh:
        prof = json.load(fh)
    missing = [k for k in ("name", "nmos_device", "pmos_device", "power_pin", "ground_pin") if k not in prof]
    if missing:
        raise TechProfileError("profile %s is missing required key(s): %s" % (name, ", ".join(missing)))
    _CACHE[name] = prof
    return prof


def device_name(prof, kind):
    """Fully-qualified SPICE model name for 'n' or 'p', prefix included."""
    key = "nmos_device" if kind == "n" else "pmos_device"
    return "%s%s" % (prof.get("foundry_prefix", ""), prof[key])


def rails(prof):
    """(power, ground, bulk_p, bulk_n) -- bulk entries are None where the PDK has no bulk pins."""
    return prof["power_pin"], prof["ground_pin"], prof.get("bulk_p_pin"), prof.get("bulk_n_pin")


if __name__ == "__main__":
    import sys
    p = load(sys.argv[1] if len(sys.argv) > 1 else None)
    print("technology : %s" % p["name"])
    print("devices    : %s / %s" % (device_name(p, "n"), device_name(p, "p")))
    print("rails      : %s / %s  bulk: %s / %s" % rails(p))
    print("tapless    : %s%s" % (p.get("tapless"), "" if p.get("tapless") else "  (tap cell: %s)" % p.get("tap_cell")))
    print("envelope   : %s devices" % p.get("device_envelope"))
    print("available  : %s" % ", ".join(available()))
