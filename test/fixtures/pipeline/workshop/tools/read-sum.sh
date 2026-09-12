#!/bin/sh
set -eu
value=$(cat "$1")
case "$value" in ''|*[!0-9]*) exit 2;; esac
printf '{"values":[{"type":"scaled_sum","unit":"count","value":%s}]}\n' "$value" > "$2"
