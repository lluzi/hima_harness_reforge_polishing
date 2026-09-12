#!/bin/sh
# analyze.sh -- sum the actual measured values strictly greater than LIMIT.
# argv: $1 = WORKSPACE, $2 = LIMIT
set -eu

WORKSPACE=$1
LIMIT=$2
INPUT="$WORKSPACE/flow/measured.txt"
OUTPUT="$WORKSPACE/result.txt"

# Compute from the actual file; one integer per line.
sum=0
while IFS= read -r value || [ -n "$value" ]; do
    [ -z "$value" ] && continue
    if [ "$value" -gt "$LIMIT" ]; then
        sum=$((sum + value))
    fi
done < "$INPUT"

# Declared contract: sleep 60 seconds before publishing the result so the
# engineer can intervene while this Job is active.
sleep 60

printf '%s\n' "$sum" > "$OUTPUT"
