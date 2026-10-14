"""Launch a numeric (``num-*``) subcommand in the EDA container (stdlib only).

The numeric method (numpy/SciPy/Shapely/gdstk) runs in the Site's pinned venv
inside the EDA container, reached through the ``siteCapabilities`` launcher.
:func:`run` builds the argv, runs it, and returns the subcommand's single
last-line JSON object. A non-zero exit raises :class:`PixelError` carrying the
``{"code","detail"}`` the subcommand wrote to stderr.

This module runs on the Site host's ``python3`` and imports nothing outside
the standard library.
"""
from __future__ import annotations

import json
import os
import subprocess

from .core import PixelError

__all__ = ["run"]


def _direct(sitecaps):
    """True when commands run directly (empty launcher, or the resident
    sandbox's ``PIXELOPT_DIRECT=1``, which already is the EDA image)."""
    launcher = (sitecaps or {}).get("launcher", {}) or {}
    argv = launcher.get("argv", []) or []
    return (not argv) or os.environ.get("PIXELOPT_DIRECT") == "1"


def _last_json_line(text):
    """The last stdout line that parses as a JSON object."""
    last = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        last = parsed
    return last


def run(sitecaps, workspace, subcommand, args, timeout):
    """Run ``pixel_cli.py <subcommand> <workspace> *args`` in the container.

    Builds ``[launcher.argv..., sitecaps.python, <ws>/flow/pixel_cli.py,
    subcommand, ws, *args]`` with ``launcher.env`` layered onto the process
    environment, or runs directly with ``sitecaps.python`` when the launcher
    is empty or ``PIXELOPT_DIRECT=1``. Returns the subcommand's last stdout
    JSON object; raises :class:`PixelError` on a non-zero exit, with the code
    and detail the subcommand wrote to stderr.
    """
    workspace = os.path.abspath(workspace)
    python = (sitecaps or {}).get("python") or "python3"
    cli = os.path.join(workspace, "flow", "pixel_cli.py")

    env = dict(os.environ)
    launcher = (sitecaps or {}).get("launcher", {}) or {}
    if _direct(sitecaps):
        argv = [python, cli, subcommand, workspace] + [str(a) for a in (args or [])]
    else:
        argv = list(launcher.get("argv", [])) + [python, cli, subcommand, workspace] \
            + [str(a) for a in (args or [])]
    for k, v in (launcher.get("env", {}) or {}).items():
        env[str(k)] = str(v)

    try:
        proc = subprocess.run(
            argv, cwd=workspace, env=env, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise PixelError("tool-failed", "%s timed out after %ss" % (subcommand, timeout))
    except OSError as exc:
        raise PixelError("tool-failed", "cannot launch %s: %s" % (subcommand, exc))

    stdout = proc.stdout.decode("utf-8", "replace") if proc.stdout else ""
    stderr = proc.stderr.decode("utf-8", "replace") if proc.stderr else ""

    if proc.returncode != 0:
        detail = stderr.strip()
        code = "tool-failed"
        err = _last_json_line(stderr)
        if isinstance(err, dict):
            code = err.get("code", code)
            detail = err.get("detail", detail)
        raise PixelError(code, "%s: %s" % (subcommand, detail))

    result = _last_json_line(stdout)
    if result is None:
        raise PixelError("tool-failed",
                         "%s printed no JSON result line" % subcommand)
    return result
