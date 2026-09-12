#!/bin/sh
set -eu
awk -v scale="$3" '{ sum += $1 } END { print sum * scale }' "$2/flow/numbers.txt" > "$1/result.txt"
