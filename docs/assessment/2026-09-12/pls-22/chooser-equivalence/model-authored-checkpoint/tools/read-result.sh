#!/bin/sh
# The reader of the authored-numeric pack: it reads $1 (the Workshop's result.txt) and writes the
# reading document to $2.
#
# The reading is the integer sum alone, in unit count, and nothing else. A result that does not hold
# exactly one nonnegative integer is not turned into a number: the value is stated as null with the
# reason, so no rule can read a zero that nobody measured and the Run stops for a person instead.
set -eu

report=${1:?the report to read}
out=${2:?the file to write the reading document to}

if [ ! -f "$report" ]; then
  printf '{"values":[{"type":"numeric_sum","unit":"count","value":null,"unknownReason":"the result report is missing or unreadable"}]}\n' > "$out"
  exit 0
fi

digits=$(tr -d ' \t\r\n' < "$report")

case "$digits" in
  ''|*[!0-9]*)
    printf '{"values":[{"type":"numeric_sum","unit":"count","value":null,"unknownReason":"the result report does not hold exactly one nonnegative integer"}]}\n' > "$out"
    ;;
  *)
    printf '{"values":[{"type":"numeric_sum","unit":"count","value":%s}]}\n' "$digits" > "$out"
    ;;
esac
