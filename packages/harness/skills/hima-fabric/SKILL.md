# hima-fabric

You compile a pack spec into a HimaPack a Campaign can actually run: the contract, the graph, the
semantics, and the rules, choosers, readers, knowledge files and tool scripts they name.

You write only inside the session's working directory. That directory is the pack folder, and it is
the only place you write. You edit no file outside it, and you never edit `INTENT.md` or `SPEC.md` —
those are the record you are compiling from, and a stage that edited its own input would be
compiling something nobody wrote.

## Before you write anything

1. **Read `SPEC.md` in this folder.** If it is not there, say so and tell the author to run
   `/hima-spec` first. Do not invent one.
2. **Check it holds all nine of its sections** — `Goal template`, `Constraints`, `Run contract`,
   `Semantics`, `Judge rules`, `Choosers`, `Endings`, `Workshops`, `Knowledge` — and that each says
   something. If one is missing or empty, refuse in words, name the section, and tell the author to
   run `/hima-spec` again.
3. **Read `INTENT.md`'s `Golden Flow` section** for the pointers it gives, and **read the flow
   there**, where it lies. You need its command lines: a tool of this pack is a command the flow
   already answers, and one you cannot see in the flow is one you may not invent.
4. **Read the six knowledge files**, relative to this skill's base directory:
   - `knowledge/over-constrain-and-read-the-violation.md`
   - `knowledge/end-honestly-in-more-than-one-way.md`
   - `knowledge/assert-the-checker-options.md`
   - `knowledge/one-checker-per-session.md`
   - `knowledge/attribute-by-database-relation.md`
   - `knowledge/what-a-golden-flow-is.md`
5. **Read `knowledge/pack-anatomy.md`**, beside those six and relative to the same base directory. It
   is the skeleton of every file kind a pack folder holds — the contract, the graph, the semantics, a
   rule, a chooser, a reader declaration and its script, a knowledge file, the five records — each
   the smallest one this harness accepts, with a note per field. It is a skeleton and not a method:
   its ids, paths and numbers are stand-ins, and what yours should be is the spec's to say.
6. **Read the reference pack installed beside this folder** — `../opene902-timing-probe/`, a sibling
   of this pack folder in the same packs directory, read by that relative path: its `PACK.md`,
   `contract.yml`, `graph.yml` and the scripts under its `tools/`. That folder is a pack this harness
   accepts, written by hand for a real business: read it for what a whole contract and a whole graph
   look like when somebody means them. Read it for shape and never for content — its method is its
   own business's, and yours is this spec's.
7. **Read the bundle's own `../semantics.yml`**, and **`../rules/<id>.yml` or `../choosers/<id>.yml`
   for every rule and chooser the spec names by an id rather than describing as this pack's own** —
   all relative to this skill's base directory, beside `knowledge/`. These are the files this harness
   ships and resolves *after* this pack's own, so they are two things at once: whole examples of
   those kinds, and the list of what you may name instead of writing. A rule or a chooser you name by
   a shipped id without opening its file is a rule you have not read and cannot say agrees with the
   spec's own wording; the bundle's semantics is what tells you which value types already have a
   meaning, so that a pack declares only the ones its own readers invent.

If a rule or chooser id the spec names has no file under `../rules/` or `../choosers/`, that is not a
fault: it means the move is this pack's own, and you write `rules/<id>.yml` or `choosers/<id>.yml`
here — after reading the bundle's nearest equivalent for the shape.

## Where a file's shape comes from

Six sources, and no seventh:

- **`SPEC.md`**, for what this pack is and what every file of it must say;
- **`INTENT.md`'s Golden Flow pointers, and the flow at them**, for the command line a tool of this
  pack may run;
- **the six knowledge files**, for how a method is shaped;
- **`knowledge/pack-anatomy.md`**, for the skeleton of every file kind — the keys each holds, what
  each key is for, and which are optional;
- **the sibling reference pack, and the bundle's `../semantics.yml` with the `../rules/<id>.yml` and
  `../choosers/<id>.yml` the spec names**, for whole examples of those kinds, written by hand and
  accepted by this harness — and for which ids you may name instead of writing a file; and
- **`hima_pack_check`**, for whether what you wrote is a pack — it names every fault in this pack's
  own files, and you fix them there and ask again.

Nothing else on this machine is an authority for any of it. This harness's own source, another
repository's test fixtures, a file you found by searching the disk for a key name: none of those is a
pack, and a person's machine holds none of them. If those six between them do not tell you how to
spell something, that is a gap, and you name it in the record rather than guessing at it from
whatever else is on the disk.

## Hold the spec against itself, and refuse a contradiction

Before a single file is written, read the spec as one document and look for the six ways it can
contradict itself. Each of them is a pack that would compile into files that disagree, and a person
finding out at the first judge node has paid for a workspace and a licence to learn it.

- A value a `Judge rules` entry or a `Choosers` entry reads that `Semantics` does not declare.
- An `Endings` entry no judge rule's outcome and no chooser's decision can reach.
- A tool the `Run contract` names with no wrapper that section declares.
- A `Workshops` entry whose output is not one of the values `Semantics` declares.
- A `Knowledge` file the spec declares and no section of it names as being for anything.
- A tool line that runs a stage of the Golden Flow whose own inputs nothing produces: no earlier tool
  of this pack runs the stage that writes them, and the flow's copy into the campaign workspace does
  not carry them either. Such a line cannot run on any Site, however well the rest compiles — the
  flow refuses it by name the first time a Campaign reaches it, after a workspace and a licence have
  been spent. Read the flow for what each stage it names requires, and refuse the line that asks for
  a stage nothing has fed.

If you find one or more, **write nothing at all** and answer in words. The first line is exactly:

```
SPEC.md does not compile:
```

and each finding is one line of the form

```
<section>, line <n>: "<the line>" — <why>
```

Then stop. Tell the author to correct `SPEC.md` — by hand or by running `/hima-spec` again — and to
run `/hima-fabric` afterwards. Do not repair the spec yourself: what the pack means is the author's,
and a stage that quietly filled a gap would have compiled a method nobody chose.

## What you write

In this folder and nowhere else, and only what the spec states:

- `contract.yml` — the run contract: `inputs`, `outputs` (each with the reader that reads it, where
  the spec says one), `environment.wrappers`, `workspace.copy`, `tools`, `rules`, `knowledge`,
  optional `goal` with each numeric parameter's type, unit, bounds and author-approved default, `strategy` with each knob's type, bounds and default, and `words` for every goal parameter the
  graph binds and every knob the strategy declares.
- `graph.yml` — the act, judge, explore and wait nodes the spec's method needs, the edges between
  them labelled with the outcomes they are taken on, and the revisit edge that closes the loop.
- `semantics.yml` — one entry per value type **this pack's own readers** emit, with its unit and,
  where it needs them, its mode and scope. A pack whose outputs are all read by readers this harness
  ships declares none of its own and writes no such file: a value type nothing of this pack's
  produces is a vocabulary no campaign of it will speak, and the check refuses it.
- `rules/<id>.yml` — each judge rule the spec states, unless the rule is one this harness already
  ships under that id and the spec's wording is that rule; then name the id and write no file.
- `choosers/<id>.yml` — each chooser the spec states, by the same rule: write the file when the move
  is this pack's own, and name a shipped id when the knowledge behind the move is this harness's.
- `readers/<id>.yml` with its script under `tools/` — for each output the spec says is read into
  typed values and that no shipped reader already reads. The declaration names the script, the
  command line it is launched with and every value type it emits. Keep the source-linked
  counterexamples beside the reader as its existing Pack test fixture or documented invocation:
  true zero is a value; empty, missing, ambiguous and multi-target input is a refusal or unknown,
  never a substituted success.
- `knowledge/<file>.md` — one file per entry of the spec's `Knowledge` section, written for the
  purpose that section gives it, and declared in the contract's `knowledge:` with that purpose.
- `tools/<name>` — one script per tool, holding the very command line the contract declares for it,
  so a person can run a generation by hand exactly as the harness runs it. Write one **only** where
  the Golden Flow shows you that command line.

### Compile every Workshop

For each actual Workshop in `SPEC.md`, write a `contract.workshops` entry using the Workshop
block in `knowledge/pack-anatomy.md`. Preserve its `purpose`, `inputs`, `reads`, `knowledge`,
`produces`, `directory`, `entry`, `language`, `argv` and any `licences`. The wrapper is `argv[0]`
and must appear in `environment.wrappers`; `argv[1]` is exactly `${ENTRY}`. Bind each declared
input at the graph node through `parameters.arguments` using the declared Goal or Strategy name.
The reserved `ENTRY`, `WORKSHOP`, `WORKSPACE`, `FLOW_ROOT`, `DESIGN`, `CAMPAIGN` values are supplied
by the Harness and are never declared as Workshop inputs or rebound at nodes. Read back the written
`argv` against the approved spec **operand by operand**, including the script's `$1`, `$2`, etc.
`WORKSPACE` is the Campaign root; `WORKSHOP` is the admitted execution's private code directory.
Use the root the approved input/output paths require; preserve their order rather than copying the
anatomy's example. Explain both operands explicitly when a script needs both roots.

Create an act node with `parameters.workshop: <id>` and connect it into the real graph. Schedule
producers of `reads` before it. Both `reads` and `produces` use the exact `contract.outputs[].name`;
`@workshop-input:<name>` is a diagnostic label, not an output name or a read-tool argument.
Its `produces` names a contract output with a reader; write that reader and semantics when no shipped reader covers the output. Add an observing act node and the
required Judge downstream so the produced file becomes checked evidence. A Workshop with an empty
purpose, no graph binding, no declared reader, an undeclared wrapper or an output escaping the
Campaign workspace is incomplete. Stop at the failed check; record the actual gap.

The Workshop entry script is generated during the Run from actual inputs. Author the contract and
reader now; do not fill the future research result with invented data. `PACK.md` may explain the
method, but never substitutes for the executable declaration. A spec that says it has no Workshops
gets no Workshop block. The Goal values themselves belong to each Run; the contract declares their
shape and the graph binds them without fixing a Campaign's choice.

## Audit the written method before recording FABRIC

Read the actual contract, graph and scripts back from the folder. Trace each declared ending in
`SPEC.md` through the actual edges and decisions, recording the source node, matching outcome,
destination and resulting ending alongside the file review shown to the author. A comment saying
"terminal" is not an edge audit. The first Judge rule determines its outgoing outcome; an Explore decision
weighs the current constraint and Goal rules in their declared order. Goal completion needs its
explicit goal-met decision, not a terminal Judge PASS alone. A revisit describes the next-strategy
path; a generation limit may stop that path before another generation starts.

A wait node is valid when the spec calls for human clearance at that boundary. When the spec calls
for a successful terminal ending, follow the actual success path and verify that it reaches that
ending. Resolve any file/spec discrepancy in the compiled files before `FABRIC.md`; an honest
later `TEST.md` disagreement does not make a contradictory method ready to compile or release.

For knowledge files, explain the method symbolically until a worked numerical claim has an exact
input, parameter values and an observed reproducible calculation or checked result to cite. Keep
unverified numbers out of worked examples. Author-approved parameter defaults are declarations;
measured or calculated results require their own evidence.

## The gaps, and the review

**The gap list.** After the writes, the list is what the spec called for and this folder does not
hold. Two kinds, and only these two:

- a tool or a reader **the contract names** that is **neither in this folder nor shipped by this
  harness under that id**. A reader, a rule or a chooser you named by a shipped id is *not* a gap:
  `hima_pack_check` says of every id which file answered it, and one answered by the bundle is
  answered; and
- something the spec asked for that you could not put in the contract at all — a tool whose command
  line the Golden Flow never showed you, a reader for a report the flow never produces.

One line each, saying what is missing and what the author has to find out to write it. You do not
invent either, and a folder with nothing missing says `none`.

**The review.** Every tool script and every reader script **you wrote** is put to the author, one at
a time, before you finish. Show the file and ask in these words:

```
Review tools/<name>: <one line on what it runs and why> — approve, or say what to change
```

Wait for their answer, act on it if they asked for a change, and record their verdict **in their own
words**. A review you summarised is a review nobody gave.

## `FABRIC.md`

One file, with exactly these sections, in this order, and no other heading. A record that holds a
heading of its own, holds one of these twice, or puts them in another order does not validate, and
the folder does not stand at `compiled`.

- `## Files written` — one line per file you wrote, by its path in this folder.
- `## Gaps` — one line per tool or reader the contract names that this folder does not hold, or
  `none`.
- `## Reviews` — one line per script you wrote: the file, and the author's verdict in their words, or
  `none`.

## Then check your own work

Call `hima_pack_check` with this pack and the Site the author named. It answers which rung the folder
stands on, whether that Site can host the pack, and every fault by name. Fix what it names **in this
pack's own files**, and check again. Stop when it says `compiled` and the pack fits, or say plainly
which fault you cannot fix and what the author has to decide.

If a reopened folder checks below `compiled`, resume at the check's `next` stage rather than editing
a later record. If this stage is next because its contract, graph or method bytes changed, compile
again and leave the old test/release evidence for the checker to reject; the next test Run will carry
the current digest.

## Rules that do not bend

- **This folder only.** Nothing outside it is created, edited or deleted, and `INTENT.md` and
  `SPEC.md` are not yours to touch.
- **Nothing invented.** Every tool script holds a command line the Golden Flow showed you. Every
  value a rule or a chooser reads is one some reader of this pack emits. A tool or a reader you
  cannot write from what you were given is a gap you name, not a file you guess at.
- **Six sources for shape, and no seventh.** The spec, the intent record's flow pointers and the flow
  at them, the six knowledge files, `knowledge/pack-anatomy.md`, the sibling reference pack with the
  bundle's `../semantics.yml` and the `../rules/<id>.yml` and `../choosers/<id>.yml` the spec names,
  and `hima_pack_check`. Never this harness's source, never another repository's fixtures, never a
  file you found by searching the disk for a key name.
- **The flow stays where it lies.** Read it; copy nothing of it into this folder.
- **You compute nothing.** A hash, a folder digest, a check against the ledger — those are verbs this
  harness has (`hima_pack_check`, and the later stages' own). Use their actual answers for those
  facts; worked examples follow the evidence rule in the written-method audit above.
