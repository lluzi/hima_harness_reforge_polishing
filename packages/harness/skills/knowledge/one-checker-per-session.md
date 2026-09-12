# One verification tool per session

A count belongs to one tool and one option set. Run two verification tools in one session and the
violation count that comes out belongs to neither: you cannot say which tool found what, you cannot
compare the number against a run of either tool alone, and you cannot re-run half of it.

**So a session runs one verification tool.** Not one *kind* of tool — one tool. If the business needs
two, that is two act nodes, two sessions, two reports and two typed values.

## What this means for a pack you are authoring

- **One act node per verification tool.** Each node launches its own session, produces its own
  report, and its report is read by its own reader into its own named value. The node's name says
  which tool it is.
- **Name the values after what produced them.** Two values both called "violations" will be compared
  by somebody. Give each the tool's name in its own name, and its unit and meaning in the pack's
  `Semantics`.
- **Do not sum across tools.** A total over two tools' counts is a number with no unit and no owner.
  If the business wants one verdict, the judge takes it from a rule over the two named values, and
  the rule says in words how the two combine.
- **Fork rather than fold.** Two verification tools that can run at once are two branches of a fork
  that converge into a judge node — that is what fork and join are for, and it keeps each count
  attached to the session that produced it.
- **One session, one option set.** The companion rule is in `assert-the-checker-options.md`: a
  session whose options were not asserted has verified nothing, and a session running two tools
  cannot have one asserted option set at all.

## The failure this prevents

A single session runs two tools to save a licence checkout; the report carries one count; six months
later a person asks which tool found the seventeen violations and no record can answer. The Campaign
ended in a number rather than in facts.

## Citing it

When this file shaped a decision, cite it by name and say what it changed — "split the one
verification node into two, one per tool, each with its own reader and its own named count, joined at
a judge node".
