# The strict-bound sum

This is the declared analysis knowledge the Workshop is given at run time. It states the rule the
generated script must implement and the exact interface it must speak. It names no stage and adds
none; it establishes no measured fact about any particular input.

## The rule, symbolically

Given a finite list of nonnegative integers `v1 … vn` and a threshold `LIMIT`, the result is

```
result = sum of every vi where vi > LIMIT
```

The comparison is **strict**. A value equal to `LIMIT` is excluded, so `LIMIT` itself is never added,
and an empty selection sums to `0`. `LIMIT` is a nonnegative integer; the values are nonnegative
integers and are read in the order the file lists them.

## The interface, exactly

- **Input:** `$1/flow/measured.txt`, where `$1` is the Campaign workspace the entry script is given.
  One nonnegative integer per line. Read the actual file; never substitute a value of your own.
- **Parameter:** `$2` is `LIMIT`, the threshold the Run's strategy bound for this generation.
- **Output:** write the integer sum **alone** — its digits, then a newline — to
  `$1/result.txt`, where `$1` is the same Campaign workspace. No label, no unit, no other text, no
  second number, and no acceptance bound written out in place of the sum.

The script is written by the Workshop during the Run, from the actual input and this file. It is not
held in the pack, and it is not copied from the Golden Flow.

## What is not stated here

The correct total for any particular `measured.txt` is a measured fact about that file, established
by running the rule over it and reading the result. It is not a constant of this method: nothing here
predicts it, and no example total is given, because a number copied from another dataset would not be
this dataset's answer. Do not invent a sample total and do not carry one forward.
