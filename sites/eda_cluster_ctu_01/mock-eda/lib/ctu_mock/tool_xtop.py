"""xtop: XTop timing ECO (mock). Installed on the Site; not a step of the andes-cell-fmax flow."""
import sys

from .common import ToolError, run_main

HELP = """\
usage: xtop [-version] [-help] [-batch SCRIPT.tcl]

XTop timing ECO: reads a routed design and its timing, sizes and buffers cells on violating
paths, and writes an ECO change list for the place-and-route tool.

  -version         print the version and exit
  -batch FILE      run a Tcl ECO script (not available on this demo Site)
"""


def handler(argv):
    if not argv or argv[0] in ("-h", "-help", "--help"):
        print(HELP)
        return 0
    if argv[0] == "-batch":
        raise ToolError("timing ECO sessions are not enabled on the demo Site eda_cluster_ctu_01 (XTop is installed, "
                        "but the andes-cell-fmax flow gains Fmax with new cells, not ECO)")
    raise ToolError("unknown option %r (try: xtop -help)" % argv[0])


def main(argv):
    return run_main("xtop", handler, argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
