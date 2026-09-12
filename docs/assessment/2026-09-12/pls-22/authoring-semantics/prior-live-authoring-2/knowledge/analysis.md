# The analysis rule of authored-numeric

This is the declared analysis knowledge of this pack. The Workshop authors its script from it, and
rule `sum-correct` cites it for the exact sum a generation's result is held against.

## The rule

The measured input is a list of nonnegative integers, one per line. The analysis sums **only the
values strictly greater than the bound** — a value equal to the bound is **excluded**. The sum is the
whole output.

The bound is the scalar `LIMIT` the Workshop is handed, bound from the run's strategy `limit`. The
result is written to `result.txt` **alone**: the integer and nothing else — no label, no count of the
values included, no second line.

Worked state, as an example of the rule and not as a constant of this pack: the Golden Flow's 12
inputs against the default bound of 11 sum to 119.

## The option record

Because a sum obtained under some other bound, or with equality wrongly included, answers a question
this pack never asked, the authored script writes what it actually applied beside its result, in
`options.txt` in the same directory:

```
limit=<the bound the script applied, as an integer>
comparison=gt
input=$1/flow/measured.txt
output=$1/result.txt
```

`comparison=gt` is the strict comparison: greater than, equality excluded. The reader holds this
record against the declared options before the count is accepted, and a run that states anything else
has no verdict. The declaration is the script's own statement of what it did, written where the
result is; it is never inferred from the result, because a clean result is equally consistent with a
different bound having been applied.

## The acceptance bound is not the answer

`goal.minimum` is an acceptance bound. The script must write the sum it actually computed. Writing
the bound, or a number chosen to satisfy it, is the one failure this method exists to detect: rule
`sum-correct` holds the measured sum against the exact sum the input and the bound require.
