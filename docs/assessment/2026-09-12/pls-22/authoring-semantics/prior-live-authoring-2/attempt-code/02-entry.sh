#!/bin/sh
# The analysis of authored-numeric, authored for this Run from the declared measured input
# (flow/measured.txt, 12 nonnegative integers) and the declared analysis knowledge
# (knowledge/analysis.md).
#
# The rule: sum only the values strictly greater than the bound; a value equal to the bound is
# excluded; write the integer alone to result.txt.
#
# Launched as `sh entry.sh <workshop> <limit>`, so $1 is this execution's private directory and $2 is
# the bound. The measured input is not inside it: the Workshop's declared read is
# `<workspace>/flow/measured.txt`, and `<workshop>` is
# `<workspace>/research/analysis/.executions/<execution>`, so the workspace root is three levels up
# from the private directory. The judged result and its option record are written at the workspace
# root, where the contract declares them.
set -eu

workshop="${1:?the workshop directory}"
limit="${2:?the bound the analysis applies}"

up3=$(dirname "$(dirname "$(dirname "$workshop")")")
workspace=$(dirname "$up3")

input="$workspace/flow/measured.txt"
result="$workspace/result.txt"
options="$workspace/options.txt"

[ -f "$input" ] || {
  printf 'the declared measured input is not there: %s\n' "$input" >&2
  exit 2
}

# The measured values strictly greater than the bound, summed. The comparison is strict, so a value
# equal to LIMIT contributes nothing.
sum=$(awk -v limit="$limit" '$1 + 0 > limit { total += $1 + 0 } END { print total + 0 }' "$input")

# result.txt holds the integer alone.
printf '%s\n' "$sum" > "$result"

# The option record this analysis actually applied, written beside its result.
{
  printf 'limit=%s\n' "$limit"
  printf 'comparison=gt\n'
  printf 'input=%s\n' "$input"
  printf 'output=%s\n' "$result"
} > "$options"

printf 'authored-numeric analysis: sum of values > %s over %s is %s\n' "$limit" "$input" "$sum"
