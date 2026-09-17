"""Isolated HAL admission probe; this adapter never publishes an ECO."""

import shutil


def availability():
    executable = shutil.which("hal") or shutil.which("hal_py")
    if executable is None:
        return {"available": False, "backend": "hal_v0",
                "reason": "HAL executable is not installed in the selected Pack environment"}
    return {"available": True, "backend": "hal_v0", "executable": executable,
            "reason": "HAL executable found; per-request semantic admission is still required"}
