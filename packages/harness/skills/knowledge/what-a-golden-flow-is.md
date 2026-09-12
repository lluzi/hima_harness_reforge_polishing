# What a Golden Flow is

**The Golden Flow is the reference engineering flow a HimaPack is learned from and checked against:
how the business runs in real tools on a real Site.** That is the whole of the definition, and every
clause of it does work.

- **Learned from.** You read it to find out what the business actually does: which stages exist,
  which of them produce the numbers the business cares about, which knobs a stage takes and where it
  takes them from, what the reports look like, what has to be true before a stage can run.
- **Checked against.** When the pack runs, its results are held against what the flow does. A pack
  whose campaign cannot be compared to the reference has not been tested.
- **Reference material, never the goal.** Reproducing the flow is not the objective. The pack's
  objective is the business's — a target and its constraints. The flow is how you learn what that
  means in practice.
- **Never imported.** Not one file of it is copied into the pack folder. A pack is a portable method
  that binds to any Site meeting its contract; a pack carrying a copy of one Site's flow is a pack
  that has silently become that Site's. The pack records **where the flow lies** and **what was read
  there**, as pointers.

## What this means for a pack you are authoring

- **Read it where it lies, with read tools.** Ask the author for the path. Read the flow's own build
  file first: it names the stages and the variables each one takes, and a variable a stage takes on
  the command line is a knob a generation can set without editing anything.
- **Write down pointers, not contents.** "`<flowRoot>/Makefile` — the stages, and the variables each
  takes" is a pointer. A pasted copy of the file is an import, and it goes stale the first time
  somebody edits the real one.
- **Raise every disagreement as its own question.** Where the author's words and the flow differ,
  neither side wins silently: the flow may be doing something the author has forgotten, and the
  author may know something the flow does not encode. Ask, and record how it was settled.
- **The harness copies the flow for a run; you do not copy it for the pack.** A Campaign's workspace
  preparation makes its own copy of the pieces the contract names, so a generation never writes into
  the reference. That is the runner's job and it is already done.
- **A flow that cannot be read is a stop, not a guess.** If the author cannot say where it lies, or
  the path is not readable, say so and stop. A pack authored from a description of a flow nobody
  looked at is a pack of guesses.

## Citing it

When this file shaped a decision, cite it by name and say what it changed — "kept the flow where it
lies: the record carries the path and what was read there, and no file of it was copied into the
pack".
