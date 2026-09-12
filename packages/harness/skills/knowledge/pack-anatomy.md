# What a pack folder holds, file by file

The skeleton the fabric stage compiles to. Every block below is the **smallest file of its kind that
this harness accepts**, with one note per field saying what that field is for. Nothing here is a
method: the ids, the paths, the units and the numbers are stand-ins, and what they should be for the
pack you are writing is the spec's to say and never this file's.

Read this for shape. Read the pack installed beside the folder you are authoring for a whole example
of the first two, written by hand for a real business. Ask `hima_pack_check` whether what you wrote
is a pack: it names every fault in the pack's own files, and that answer is the authority no
skeleton can be.

A pack folder holds, at its top: `contract.yml`, `graph.yml`, `semantics.yml` where the pack's own
readers emit value types, and the directories `rules/`, `choosers/`, `readers/`, `knowledge/` and
`tools/` where it has files for them. Every path in it is a plain file with a plain name — no link,
no hidden name, nothing but letters, digits, dots, dashes and underscores in each segment.

## `contract.yml` — what a Site must bind, what a generation produces, what the pack runs

```yaml
id: example-probe            # the folder's own name; lowercase letters, digits and dashes
version: '1'                 # a string, and graph.yml states the same one
title: Example probe         # what a person reads the pack under

inputs:                      # what a Site binds in its own site file; the pack binds none of them
  - name: flowRoot
    description: The Golden Flow's root on the Site. Read where it lies, never written.
  - name: subject
    description: What the flow is run over, spelled as the flow's own manifests spell it.
  - name: workspaceRoot
    description: Where campaign workspaces are made; the Site's permit must allow writes under it.

outputs:                     # what a generation leaves in its own workspace
  - name: measurement
    path: flow/out/${subject}/measurement.txt   # relative to the workspace; ${…} is an input above
    reader: measurement-file                    # the reader that turns it into typed values
    description: What this generation measured. The judged file.
  - name: toolLog
    path: flow/logs/${subject}/tool.log         # no reader: a file a person reads after a failure
    description: What the tool said while it ran.

environment:
  wrappers:                  # the first word of every command line below — a tool's argv[0] and a
    - make                   #   reader's; the Site's permit decides each, and a word not here is
    - sh                     #   refused before a campaign starts

workspace:
  copy:                      # what is copied out of flowRoot into <workspace>/flow/, once per campaign
    - Makefile
    - tools
    - inputs/${subject}

tools:
  - id: measure
    file: tools/measure.sh   # the script a person can run by hand, under this folder's tools/
    description: One generation of the flow's own measuring stage, in the campaign's copy of it.
    inputs: [WORKSPACE, SUBJECT, STEP_MS]   # the variables the script reads, and the only names argv may use
    licences:                # optional: what a job of this tool holds on the Site while it runs
      measuring-seat: 1      # the Site declares how many it has; a tool that holds none writes no block
    argv:                    # what the harness launches; argv[0] is the wrapper above
      - make
      - -C
      - ${WORKSPACE}/flow
      - SUBJECT=${SUBJECT}
      - measure
      - STEP_MS=${STEP_MS}

rules:                       # the judge rules this pack may apply, by id: this folder's rules/ first,
  - measurement-within-bound #   the bundle's second

knowledge:                   # optional: this pack's own domain knowledge, one entry per file
  - file: the-step-method.md
    purpose: why this pack changes the step the way it does

strategy:                    # what a run is set to for one generation; at least one knob, each whole
  stepMs: { type: number, unit: ms, min: 0.5, max: 10, default: 2 }
  shape: { type: choice, options: [plain, dense], default: plain }

words:                       # what a person reads each number under: one entry per goal parameter the
  measurement_at_most: { label: measurement at most, unit: ms }   # graph binds, one per knob above
  stepMs: { label: step, unit: ms }
  shape: { label: shape }    # a choice states no unit: a choice is measured in nothing
```

## `graph.yml` — the four node kinds, the outcomes the edges are taken on, and the one edge back

```yaml
id: example-probe            # the contract's id
version: '1'                 # the contract's version
entry: measure               # the node a campaign starts at

nodes:
  - id: measure              # act: run one of the contract's tools on the Site and wait for it
    kind: act
    parameters:
      tool: measure
      arguments:             # what the Run supplies for this generation
        STEP_MS: { from: strategy, name: stepMs }

  - id: read-measurement     # act: read one of the contract's outputs into the ledger
    kind: act
    parameters:
      observes: measurement

  - id: judge                # judge: apply rules in order; the edge out is chosen by the first one's outcome
    kind: judge
    parameters:
      rules: [measurement-within-bound]
      bind:                  # what binds each parameter a rule declares
        bound_ms: { from: goal, name: measurement_at_most }

  - id: next-step            # explore: choose the next strategy, or open a loop of its own
    kind: explore
    parameters:
      chooser: step-back-off # by id, exactly as a rule is named
      bind:                  # the numbers the chooser leaves to the pack author
        marginMs: 0.05
      converge:              # optional, and all four together: when this loop has stopped learning
        read: measured       # one of the chooser's own `reads`
        band: 0.05           # how far apart two generations must be to count as movement
        generations: 1       # how many successive generations must have moved by less than that
        generationLimit: 6   # what this pack thinks a campaign of it should be allowed at most

  - id: blocked              # wait: where a run stops for a person once its retries are spent
    kind: wait
    parameters:
      blocker: hard-blocker

edges:
  - { from: measure, to: read-measurement }            # an act node's one unlabelled edge out
  - { from: read-measurement, to: judge }
  - { from: judge, to: next-step, outcome: PASS }      # a judge node's edges carry their outcome
  - { from: judge, to: next-step, outcome: FAIL }
  - { from: next-step, to: measure, revisit: true }    # the loop: the only edge that goes back
```

## `semantics.yml` — what the value types this pack's own readers emit mean

Written **only** where this pack's own readers emit a value type. A pack whose outputs are all read
by readers the harness ships declares none and writes no such file.

The two qualifier vocabularies are the harness's own and are **fixed**: `mode` is `setup` or `hold`,
`scope` is `all` or `reg2reg`. Declaring either means every reading of that type carries one of the
listed words; declaring neither means a reading of it carries no qualifier at all.

```yaml
values:
  measured_ms:               # the slug a reader emits and a rule or chooser reads
    unit: ms                 # what a value of it is measured in; every reading is held to this
    mode: [setup, hold]      # optional: the analysis passes a value of it can belong to
    scope: [all, reg2reg]    # optional: the path groups a value of it can cover
    description: what this generation measured, as the file states it
```

## `rules/<id>.yml` — one judge rule

```yaml
id: measurement-within-bound # the file's own name, without the .yml
version: '1'
title: The measurement is within the bound the run was started with
parameter:                   # optional: the one value a node binds at judge time
  name: bound_ms
  unit: ms
requires:                    # what must have been observed for this rule to have an opinion at all
  - type: measured_ms
subject:                     # the value the predicate is about
  type: measured_ms
predicate:
  op: lte                    # lte, gte and the like
  threshold: { parameter: bound_ms }   # or a number written here
  unit: ms
```

## `choosers/<id>.yml` — one explore move, as data

```yaml
id: step-back-off
version: '1'
title: Take the step back by what the last generation missed by
parameter:                   # the one number the pack binds in its explore node's `bind:`
  name: marginMs
  unit: ms
reads:                       # what is read out of the run's latest observation, by type
  measured: { type: measured_ms, unit: ms }
decide:                      # first matching clause wins
  - when: { constraint: PASS, goal: PASS }
    goalMet: true            # the goal is reached; there is no next strategy
  - when: { constraint: PASS }
    next:                    # sets this pack's own strategy knobs by name; a knob not named carries over
      stepMs: { sum: [measured, marginMs] }
  - when: { constraint: FAIL }
    next:
      stepMs: { sum: [measured, { neg: marginMs }] }
```

## `readers/<id>.yml` and its script under `tools/` — a reader of this pack's own

```yaml
id: measurement-file
version: '1'
file: tools/read-measurement.sh   # under this folder's tools/, and a plain file
argv:                             # every word is a literal, or exactly one of the four placeholders
  - sh                            # argv[0] is the wrapper: a literal word the contract declares
  - ${READER}                     # the script's path on the Site
  - ${REPORT}                     # the output the contract pointed it at
  - ${OUT}                        # the file the script must write
reportKind: example-measurement   # a word for the record; never sniffed
emits: [measured_ms]              # every value type it writes, each declared in the semantics
```

Its script, under this folder's `tools/`, launched by the harness as a job under the Site's permit
with the report and the output file as arguments:

```sh
#!/bin/sh
# tools/read-measurement.sh — reads $2 (the report) and writes the reading document to $3.
set -eu
printf '{"values":[{"type":"measured_ms","unit":"ms","mode":"setup","scope":"all","value":%s}]}\n' \
  "$(awk '/^measured/ { print $2 }' "$2")" > "$3"
```

What it writes to `${OUT}` — one JSON document, and exit 0:

```json
{ "values": [ { "type": "measured_ms", "unit": "ms", "mode": "setup", "scope": "all", "value": 2.5 } ] }
```

A value carries `mode` and `scope` exactly when the semantics above declare them for its type, and
the word it carries is one of the declared ones. It may also carry `group` (the tool's own name for
the path group the number came from) and, where the report did not state the number at all,
`"value": null` with `unknownReason` saying why — never a zero standing in for a number nobody read.
A value whose type, unit or qualifiers are not the declared ones is refused, and the reading never
becomes an observation.

## `knowledge/<file>.md` — one piece of this pack's domain knowledge

A plain Markdown file, one per entry of the contract's `knowledge:`, written for the purpose that
entry gives it. Nothing reads it as data; it is what a model moment of this pack is given.

```markdown
# Why this pack changes the step the way it does

<the reasoning, in the author's own words, for the purpose the contract declares>
```

## The five records the pipeline writes

Each is written by one stage, and each is what carries the folder one rung further up. They are the
authoring account and not the pack — no campaign reads one — and the digest of the files a campaign
runs is taken without them.

| File | Written by | Sections, in this order |
| --- | --- | --- |
| `INTENT.md` | `/hima-grill` | `Business`, `Golden Flow`, `Answers`, `Ambiguities resolved`, `Knowledge applied` |
| `SPEC.md` | `/hima-spec` | `Goal template`, `Constraints`, `Run contract`, `Semantics`, `Judge rules`, `Choosers`, `Endings`, `Workshops`, `Knowledge` |
| `FABRIC.md` | `/hima-fabric` | `Files written`, `Gaps`, `Reviews` |
| `TEST.md` | `/hima-test` | `Site`, `Run`, `Ending`, `Generations`, `Code`, `Refusals`, `Disagreements` |
| `VERSION.yml` | `/hima-release`, through the harness's own verb | `pack`, `version`, `released`, `test: { record, run }`, `files:` — one sha256 per file |

A record validates when its ordered `##` headings are **exactly** those sections: nothing missing,
nothing extra, nothing twice, nothing out of order, nothing empty. `VERSION.yml` is the one of the
five nobody writes by hand: every hash in it is computed by the harness over the bytes in the folder.
