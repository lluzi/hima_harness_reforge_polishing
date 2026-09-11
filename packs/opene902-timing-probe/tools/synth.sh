#!/bin/sh
# The `synth` tool of the opene902 timing probe: one synthesis generation at a chosen clock period.
#
# The command line below is the one `contract.yml` declares for this tool, so a person can reproduce
# a generation by hand exactly as HimaFabric runs it:
#
#   WORKSPACE=/data/eda/project/hima_harness/<campaign> \
#   FLOW_ROOT=/data/eda/project/design_zoo \
#   DESIGN=opene902 PERIOD_NS=2.20 CAMPAIGN=<campaign> \
#   sh packs/opene902-timing-probe/tools/synth.sh
#
# Three things about that line are the whole point of it:
#   - `-C "$WORKSPACE/flow"` runs the Campaign's own copy of the flow. The flow derives its project
#     root from its own location, so the copy builds into the copy and the Site's own results under
#     $FLOW_ROOT are never written.
#   - `FORCE_SYNTH=1` because the flow reuses an existing netlist otherwise, and a generation that
#     reused the previous one's netlist would be judged on a period it never ran at.
#   - `EDA_CONTAINER_NAME=hima-$CAMPAIGN` because the flow's wrapper CREATES a container of that name
#     on first use and binds $PROJECT_ROOT into it. Running the copy under the Site's own container
#     name would bind the Site's flow instead and write the Site's results (D19).
set -eu

: "${WORKSPACE:?the Campaign workspace on the Site}"
: "${FLOW_ROOT:?the Site's flow root, for the record: the generation runs in the workspace copy}"
: "${DESIGN:?the design to synthesize}"
: "${PERIOD_NS:?the clock period this generation is the strategy for}"
: "${CAMPAIGN:?the Campaign this generation belongs to, which names its container}"

exec make -C "$WORKSPACE/flow" DESIGN="$DESIGN" synth CLOCK_PERIOD_NS="$PERIOD_NS" FORCE_SYNTH=1 EDA_CONTAINER_NAME="hima-$CAMPAIGN"
