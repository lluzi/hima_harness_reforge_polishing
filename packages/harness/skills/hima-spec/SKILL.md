# hima-spec

You turn a pack intent record into a pack spec: one human-readable file that states the method
completely enough for the next stage to compile it, in the pack's own words.

You write exactly one file: `SPEC.md`, in the session's working directory. That directory is the
pack folder, and it is the only place you write. You edit no other file — `INTENT.md` included.

## Before you write anything

1. **Read `INTENT.md` in this folder.** If it is not there, say so and tell the author to run
   `/hima-grill` first. Do not invent one.
2. **Check it holds all five of its sections** — `Business`, `Golden Flow`, `Answers`,
   `Ambiguities resolved`, `Knowledge applied` — and that each says something. If one is missing or
   empty, refuse in words, name the section, and tell the author to run `/hima-grill` again. Never
   fill a gap yourself and never overwrite a record a person has edited.
3. **Read the Golden Flow at the pointers the record gives you**, where it lies. Read it, never copy
   it.
4. **Read the six knowledge files**, relative to this skill's base directory:
   - `knowledge/over-constrain-and-read-the-violation.md`
   - `knowledge/end-honestly-in-more-than-one-way.md`
   - `knowledge/assert-the-checker-options.md`
   - `knowledge/one-checker-per-session.md`
   - `knowledge/attribute-by-database-relation.md`
   - `knowledge/what-a-golden-flow-is.md`

## What you write

One file, `SPEC.md`, with exactly these sections, in this order, and no other heading. A spec that
holds a heading of its own, holds one of these twice, or puts them in another order does not
validate, and the stage that compiles it refuses it. Every section is in the pack's
own words — the author's vocabulary for this business, not generic prose — and every section says
which knowledge file shaped it, by file name. A section no knowledge shaped says so plainly.

- `## Goal template` — the primary target and its parameters, each with its unit and what it means.
- `## Constraints` — every constraint the Goal carries, typed and checkable, with the options the
  measurement was made under.
- `## Run contract` — inputs, outputs, wrappers, tools and budget: what a Site must bind and allow,
  which source identity each input has, and what bounds new attempts or generations.
- `## Semantics` — every typed value the readers will produce: name, unit, source and what it
  measures. One entry per value, its zero/absence meaning, and no value the readers do not produce.
- `## Judge rules` — the rules over those values that decide how a node continues, and what each
  verdict cites.
- `## Choosers` — each chooser, what it reads, what it sets, and the knowledge behind the move it
  makes.
- `## Endings` — every way a Campaign of this pack ends, in words. Goal met, converged, and the
  endings this pack declares for itself.
- `## Workshops` — where the AI may write code at run time: the purpose, the inputs it is given, and
  the semantics of what it must produce.
- `## Knowledge` — the pack's own knowledge files to write, by name and purpose. These are the files
  that will sit in the pack folder's `knowledge/` and be named by its contract; they are the domain
  knowledge a Model moment may read.

## Hold the spec against itself before you write it

The stage that compiles this spec holds it against **six ways a spec can contradict itself**, and
refuses the whole file naming the section and quoting the line when it finds one. So hold your own
draft against those same six first, in these words, and rewrite it until it passes. A spec that fails
its own check is never handed on.

- A value a `Judge rules` entry or a `Choosers` entry reads that `Semantics` does not declare.
- An `Endings` entry no judge rule's outcome and no chooser's decision can reach.
- A tool the `Run contract` names with no wrapper that section declares.
- A `Workshops` entry whose output is not one of the values `Semantics` declares.
- A `Knowledge` file the spec declares and no section of it names as being for anything.
- A tool line that runs a stage of the Golden Flow whose own inputs nothing produces: no earlier tool
  of this pack runs the stage that writes them, and the flow's copy into the campaign workspace does
  not carry them either.

Two of those six are where a spec fails in practice, so check them by walking the sections rather
than by reading over them:

**Every ending is reached by something.** Take each `Endings` entry and name, in the spec itself,
what reaches it. There are exactly three shapes, and an ending with none of them is an ending a
Campaign can never end at:

- **goal met** — a `Choosers` entry with a clause that states the goal is met, on the PASS of the
  rule that judges the goal. An `Endings` section that says "the goal is met when the period closes"
  while no chooser clause ever says so is a campaign that runs to its generation limit instead.
- **converged** — the explore node's own converge block, which the `Choosers` entry declares: which
  of that chooser's reads is watched, how close two generations must be to count as not moving, and
  over how many generations.
- **a blocker this pack declares** — a judge rule whose FAIL routes to the wait node, which is where
  a Campaign stops for a person. Name the rule.

**Every value a rule or a chooser reads is declared.** Take each name in `Judge rules` and `Choosers`
and find it in `Semantics`. A rule that reads a value nothing declares is the contradiction the next
stage refuses first, and it is always a `Semantics` section written before the rules rather than with
them.

If holding the draft up this way shows a gap — an ending nothing reaches, a value nothing produces —
the fix is the spec, not a note about the spec: rewrite the section so what it states is reachable,
or drop the ending the author never needed. Where the gap is something only the author can settle,
say so in one line and do not write the file.

Then say, in one short message, that it is written.

## The business bounds the spec

Everything above is bounded by one thing: what the author said this pack is for. The record's
`Business` and `Answers` sections are that, in their words, and they are the only source of what
this pack must do.

So every tool, every reader, every rule, every ending and every workshop you name is one those two
sections call for. An author who asked for the tightest clock period a flow closes at has asked for
that: a second measurement, a gate on another stage of the flow, a record of something nobody
mentioned — each of those is a method they never chose, and a spec that carries one is a pack whose
whole shape came from somewhere other than the person who wanted it.

A knowledge file shapes **how** the business is pursued. It never adds a stage. If reading one makes
you want a section the author never described, that is a thing to say rather than to write: name the
file, say what it would add, and say that the author has not asked for it. The next stage compiles
what is here, and what is here is theirs.

## Rules that do not bend

- **One file.** `SPEC.md`, in this folder. Nothing else is created, edited or deleted.
- **Nothing invented.** Every value in `Semantics` is one some reader will actually produce. Every
  ending in `Endings` is one some value can detect. A spec that names a number nobody reads is a
  spec the next stage cannot compile.
- **It passes its own check.** The six contradictions above are the ones `/hima-fabric` refuses the
  whole spec for; a draft that fails one of them is rewritten here, never handed on for the next
  stage to discover.
- **Nothing the author did not ask for.** Every tool, reader, rule, ending and workshop is one the
  record's `Business` and `Answers` call for. A knowledge file never adds one; where it would, say
  so instead of writing it.
- **The flow stays where it lies.** Pointers into it, never copies of it.
- **Knowledge is cited, not summarized.** Name the file and say what it shaped. A section that
  restates a knowledge file instead of applying it has not applied it.
- **Counterexamples are contractual.** Carry the intent record's source-linked zero, empty, missing
  and multi-target cases into the reader/rule requirements. A reader may return a typed zero only
  when the report proves zero; missing or ambiguous evidence has an explicit refusal or unknown path.
