#!/bin/sh
# The `prepare` tool of the authored-numeric pack: the Golden Flow's one preparation stage, run
# inside the Campaign's own copy of the flow.
#
# The command line below is the one `contract.yml` declares for this tool, so a person can reproduce
# a generation by hand exactly as HimaFabric runs it:
#
#   WORKSPACE=<the Campaign workspace> sh packs/authored-numeric/tools/prepare.sh
#
# The Golden Flow's own build file shows the stage as `sh prepare.sh <flow-directory>`; it runs there
# (`cd "$1"`) and copies numbers.txt to measured.txt in that directory. This script runs the flow's
# stage inside the Campaign's copy, never in the Site's read-only flow root.
set -eu

: "${WORKSPACE:?the Campaign workspace on the Site}"

exec sh "$WORKSPACE/flow/prepare.sh" "$WORKSPACE/flow"
