#!/bin/sh
# mine-timing (opene902): state how many cell candidates post-synthesis left.
#
# Called as: sh miner.sh <root> <design>
#   <root>   the campaign workspace root (the dir that holds flow/)
#   <design> the design name, e.g. opene902
#
# Reads the post-synthesis qor report this flow writes
#   <root>/flow/results/<design>/syn/report/qor.rpt
# and writes the mining stage's candidates document to
#   <root>/flow/results/<design>/mine-timing/candidates.json
#
# Count:  the whole number of thousands of square microns of the "Cell Area:" line.
# Slack:  the "Critical Path Slack:" of the pass and path group the report names.

set -eu

PROG=$(basename "$0")
ROOT=${1:-}
DESIGN=${2:-}

if [ -z "$ROOT" ] || [ -z "$DESIGN" ]; then
    echo "usage: sh $PROG <root> <design>" >&2
    exit 2
fi

# --- locate the post-synthesis report -------------------------------------
RPT=${QOR_REPORT:-}
if [ -z "$RPT" ]; then
    for p in \
        "$ROOT/flow/results/$DESIGN/syn/report/qor.rpt" \
        "$ROOT/results/$DESIGN/syn/report/qor.rpt" \
        "$ROOT/$DESIGN/syn/report/qor.rpt" \
        "$ROOT/syn/report/qor.rpt"
    do
        if [ -f "$p" ]; then RPT=$p; break; fi
    done
fi

if [ -z "$RPT" ] || [ ! -f "$RPT" ]; then
    echo "$PROG: no qor report for design '$DESIGN' under '$ROOT'" >&2
    exit 1
fi

# --- the output lives beside the results the report belongs to -------------
# RPT is <results>/<design>/syn/report/qor.rpt
RPT_DIR=$(dirname "$RPT")
PASS_DIR=$(dirname "$RPT_DIR")            # <results>/<design>/syn
DESIGN_DIR=$(dirname "$PASS_DIR")         # <results>/<design>
PASS_NAME=$(basename "$PASS_DIR")         # e.g. syn
OUTDIR="$DESIGN_DIR/mine-timing"

# --- parse the report ------------------------------------------------------
parsed=$(awk '
    /Timing Path Group/ {
        g = $0
        sub(/.*Timing Path Group[ \t]*/, "", g)
        gsub(/[^A-Za-z0-9_.-]/, "", g)
        grp = g
    }
    /Critical Path Slack/ {
        s = $0
        sub(/.*Critical Path Slack[ \t]*:[ \t]*/, "", s)
        sub(/[ \t\r]+$/, "", s)
        slk = s
        grp_at = grp
    }
    /Cell Area/ {
        a = $0
        sub(/.*Cell Area[ \t]*:[ \t]*/, "", a)
        sub(/[ \t\r]+$/, "", a)
        area = a
    }
    END { printf "%s\t%s\t%s\n", grp_at, slk, area }
' "$RPT")

PATH_GROUP=$(printf '%s' "$parsed" | cut -f1)
SLACK=$(printf '%s' "$parsed" | cut -f2)
AREA=$(printf '%s' "$parsed" | cut -f3)

case "$AREA" in
    '' | *[!0-9.]*)
        echo "$PROG: no usable 'Cell Area:' line in $RPT" >&2
        exit 1
        ;;
esac

case "$SLACK" in
    '' | *[!0-9eE.+-]*)
        echo "$PROG: no usable 'Critical Path Slack:' line in $RPT" >&2
        exit 1
        ;;
esac

# whole number of thousands of square microns
COUNT=$(awk -v a="$AREA" 'BEGIN { printf "%d", int(a / 1000) }')

case "$COUNT" in
    '' | *[!0-9]*)
        echo "$PROG: could not derive a candidate count from Cell Area '$AREA'" >&2
        exit 1
        ;;
esac

# --- state it as the reader reads it ---------------------------------------
mkdir -p "$OUTDIR"
TMP="$OUTDIR/.candidates.json.$$"
trap 'rm -f "$TMP"' EXIT HUP INT TERM

{
    printf '{\n'
    printf '  "count": %s,\n' "$COUNT"
    printf '  "candidate_count": %s,\n' "$COUNT"
    printf '  "slack": %s,\n' "$SLACK"
    printf '  "candidate_slack": %s,\n' "$SLACK"
    printf '  "path_group": "%s",\n' "$PATH_GROUP"
    printf '  "pass": "%s"\n' "$PASS_NAME"
    printf '}\n'
} > "$TMP"

mv "$TMP" "$OUTDIR/candidates.json"
trap - EXIT HUP INT TERM

echo "$PROG: $DESIGN -> $OUTDIR/candidates.json (count=$COUNT, slack=$SLACK, pass=$PASS_NAME, path_group=$PATH_GROUP)"
