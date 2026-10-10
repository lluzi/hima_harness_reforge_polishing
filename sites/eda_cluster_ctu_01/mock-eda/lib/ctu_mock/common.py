"""Shared plumbing of the mock EDA command-line tools: banners, log lines, pacing, files."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHARE = ROOT / "share"
SITE_NAME = "eda_cluster_ctu_01"
SITE_NOTE = "Installed on %s." % SITE_NAME

VERSIONS = {
    "sapr": ("Synthesis and APR", "sapr", "2026.09-SP1"),
    "himatime": ("HimaTime static timing analysis", "himatime", "4.2.0"),
    "qualib": ("Qualib library analysis and cell screen", "qualib", "3.1.2"),
    "andescell": ("AndesCell standard-cell generation", "andescell", "2.4.0"),
    "xtop": ("XTop timing ECO", "xtop", "2026.06"),
}


class ToolError(Exception):
    """A user-facing refusal: printed as one ERROR line, exit status 2."""


def version_line(tool):
    title, name, version = VERSIONS[tool]
    return "%s (%s) version %s, linux64" % (title, name, version)


def banner(tool, out=sys.stdout):
    title, name, version = VERSIONS[tool]
    rule = "*" * 78
    lines = [rule, "  %s" % title, "  %s version %s (build %d, linux64)" % (name, version, 4400 + len(name) * 13),
             "  %s" % SITE_NOTE, rule]
    out.write("\n".join(lines) + "\n")
    out.flush()


def time_scale():
    try:
        return max(0.0, float(os.environ.get("CTU_MOCK_TIME_SCALE", "1")))
    except ValueError:
        return 1.0


class Log:
    """Prints `[HH:MM:SS] TOOL-CODE: text` lines to stdout and, when given, a log file."""

    def __init__(self, prefix, path=None, quiet=False):
        self.prefix = prefix
        self.quiet = quiet
        self.stream = None
        self.started = time.time()
        if path is not None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self.stream = open(path, "w")

    def __call__(self, code, text):
        line = "[%s] %s-%s: %s" % (time.strftime("%H:%M:%S"), self.prefix, code, text)
        if not self.quiet:
            print(line, flush=True)
        if self.stream:
            self.stream.write(line + "\n")
            self.stream.flush()

    def raw(self, text):
        if not self.quiet:
            print(text, flush=True)
        if self.stream:
            self.stream.write(text + "\n")
            self.stream.flush()

    def phase(self, code, name, seconds, steps=4, detail=None):
        """One flow phase that takes `seconds` (scaled), with progress lines."""
        self(code, "%s ..." % name)
        scaled = seconds * time_scale()
        for k in range(1, steps + 1):
            if scaled > 0:
                time.sleep(scaled / steps)
            pct = int(100 * k / steps)
            note = detail(k, steps) if detail else None
            self(code, "  %s %3d%%%s" % (name, pct, "  " + note if note else ""))

    def elapsed(self):
        return round(time.time() - self.started, 1)

    def close(self):
        if self.stream:
            self.stream.close()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, path)


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def read_json(path, what):
    try:
        with open(path) as stream:
            return json.load(stream)
    except FileNotFoundError:
        raise ToolError("%s not found: %s" % (what, path))
    except ValueError as error:
        raise ToolError("%s is not valid JSON (%s): %s" % (what, error, path))


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def run_main(tool, handler, argv):
    """Common entry: -version / -help, refusals as one ERROR line and exit 2."""
    if argv and argv[0] in ("-version", "--version", "-v"):
        print(version_line(tool))
        return 0
    try:
        return handler(argv) or 0
    except ToolError as error:
        title, name, _ = VERSIONS[tool]
        print("Error: %s: %s" % (name, error), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
