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
  - name: design
    description: What the flow is run over, spelled as the flow's own manifests spell it.
  - name: workspaceRoot
    description: Where campaign workspaces are made; the Site's permit must allow writes under it.

outputs:                     # what a generation leaves in its own workspace
  - name: measurement
    path: flow/out/${design}/measurement.txt   # relative to the workspace; ${…} is an input above
    reader: measurement-file                    # the reader that turns it into typed values
    description: What this generation measured. The judged file.
  - name: toolLog
    path: flow/logs/${design}/tool.log         # no reader: a file a person reads after a failure
    description: What the tool said while it ran.

environment:
  wrappers:                  # the first word of every command line below — a tool's argv[0] and a
    - make                   #   reader's; the Site's permit decides each, and a word not here is
    - sh                     #   refused before a campaign starts

workspace:
  copy:                      # what is copied out of flowRoot into <workspace>/flow/, once per campaign
    - Makefile
    - tools
    - inputs/${design}

tools:
  - id: measure
    file: tools/measure.sh   # the script a person can run by hand, under this folder's tools/
    description: One generation of the flow's own measuring stage, in the campaign's copy of it.
    inputs: [WORKSPACE, DESIGN, STEP_MS]   # the variables the script reads, and the only names argv may use
    licences:                # optional: what a job of this tool holds on the Site while it runs
      measuring-seat: 1      # the Site declares how many it has; a tool that holds none writes no block
    argv:                    # what the harness launches; argv[0] is the wrapper above
      - make
      - -C
      - ${WORKSPACE}/flow
      - DESIGN=${DESIGN}
      - measure
      - STEP_MS=${STEP_MS}
  # JSON-native commands: the Golden Flow must implement these explicit operands.
  - id: measure-json
    file: tools/measure-json.sh
    description: Measure from the business JSON input and write the declared JSON output.
    inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]
    argv: [sh, '${WORKSPACE}/flow/tools/measure-json.sh', '${TASK_INPUT}', '${TASK_OUTPUT}']
  - id: deliver-json
    file: tools/deliver-json.sh
    description: Deliver the committed sample without recomputing it.
    inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]
    argv: [sh, '${WORKSPACE}/flow/tools/deliver-json.sh', '${TASK_INPUT}', '${TASK_OUTPUT}']

rules:                       # the judge rules this pack may apply, by id: this folder's rules/ first,
  - measurement-within-bound #   the bundle's second

knowledge:                   # optional: this pack's own domain knowledge, one entry per file
  - file: the-step-method.md
    purpose: why this pack changes the step the way it does

goal:
  measurement_at_most: {type: number, unit: ms, min: 0.5, max: 10, default: 2}

strategy:                    # actual method knobs; optional for versioned flows that need none
  stepMs: { type: number, unit: ms, min: 0.5, max: 10, default: 2 }
  shape: { type: choice, options: [plain, dense], default: plain }

words:                       # what a person reads each number under: one entry per goal parameter the
  measurement_at_most: { label: measurement at most, unit: ms }   # graph binds, one per knob above
  stepMs: { label: step, unit: ms }
  shape: { label: shape }    # a choice states no unit: a choice is measured in nothing
```

## `graph.yml` — versioned tasks and compositions for new methods

Keep the existing `contract.yml` Site, tool, output, knowledge, budget and display declarations.
A versioned flow that never chooses a Strategy can omit `strategy` or use `{}`; declare actual
knobs when the method needs them. Existing four-kind graphs retain their nonempty Strategy contract.
The graph uses `schema: hima-flow/1`, the same Pack id/version, and one `flow`. Every task and
composition has a unique id. A task's `tool` names a declared contract tool; a command, a program
using a model and a complete outsourced engineering task share the same data contract. The builtin
`builtin/human-wait` task waits for a durable human response.

This strict graph uses the JSON-native `measure-json` and `deliver-json` tools declared above.
The legacy `measure` command remains an example for the legacy graph later in this file. The task adapter returns the
business value described by its output schema; Runtime fills identity and commits the envelope.
The `sample` binding reads the predecessor's value, rather than guessing where a file was written.

```yaml
schema: hima-flow/1
id: example-probe
version: '1'
flow:
  kind: sequence
  id: measure-and-deliver
  steps:
    - kind: task
      id: measure
      tool: measure-json
      inputs:
        design: {source: runInput, path: [design]}
        step: {source: strategy, path: [stepMs]}
        target: {source: goal, path: [measurement_at_most]}
      contract:
        input:
          version: '1'
          schema:
            $schema: https://json-schema.org/draft/2020-12/schema
            type: object
            properties:
              design: {type: string}
              step: {type: number}
              target: {type: number}
            required: [design, step, target]
        output: &measurement-result
          version: '1'
          schema:
            $schema: https://json-schema.org/draft/2020-12/schema
            $ref: schemas/measurement.json
    - kind: task
      id: deliver
      tool: deliver-json
      inputs:
        sample: {source: committedOutput, taskId: measure, path: []}
      contract:
        input:
          version: '1'
          schema:
            $schema: https://json-schema.org/draft/2020-12/schema
            type: object
            properties:
              sample: {$ref: schemas/measurement.json}
            required: [sample]
        output: *measurement-result
```

## Command input and output

A new JSON-native command explicitly declares `TASK_OUTPUT` in its tool `inputs` and uses it in
`argv`. Runtime supplies a task-private output filename. Structured input uses an explicitly
declared `TASK_INPUT` operand: Runtime writes the resolved business input object as immutable
JSON and supplies its filename. Those files contain business data, not platform ledger fields.
The Golden Flow command or its approved wrapper must implement these operands; declaring them
does not make an existing command understand JSON.

For scalar operands, a task input key must exactly match the name declared in `tools[].inputs`;
strings, numbers and booleans become their string argv values. There is no `step` to `STEP_MS`
translation. Runtime owns WORKSPACE, FLOW_ROOT, DESIGN, CAMPAIGN and the task file operands.
Legacy `parameters.arguments` continue to bind their declared Goal/Strategy names through the
legacy adapter. A new command without TASK_OUTPUT needs an explicitly registered native/Reader
collector; Runtime refuses a missing collector before launching work and never guesses stdout.

The command writes this producer shape to TASK_OUTPUT (illustrative fixture values only):

```json
{"schemaVersion":"1","value":{"route":"stop","measurement":2},"artifacts":[],"diagnostics":[]}
```

`value` must satisfy the task's output schema. To retain a file, an artifact declaration has
`name`, a workspace-relative `path`, and optional `mediaType`. Runtime verifies the actual file,
retains immutable bytes, and supplies SHA256 and Run/task/effect identity. A diagnostic has `code`,
`message` and a concrete `source`. Producers never fabricate platform IDs or artifact hashes.
Existing domain Readers still establish business meaning; JSON validity does not establish timing
closure or a Goal. A valid result can say the business Goal was not met.

## Local schema files

`schemas/measurement.json` is an ordinary method file, included in method digest, seal and history:

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"route":{"type":"string","enum":["continue","stop"]},"measurement":{"type":"number"}},"required":["route","measurement"]}
```

Schema references resolve inside this Pack. A local schema's `child.json` resolves beside that
schema, and `#/$defs/name` resolves in its owning document. Supply each referenced file. Validation
uses synchronous JSON Schema 2020-12 with no network resolution, custom executable keyword, value
coercion, default insertion or field removal. A schema accepts data shape; the declared Reader and
Judge establish engineering meaning. Successful task execution, Goal achievement and adoption
limits remain distinct facts.

## Input bindings and compositions

Input bindings use exact string-array paths. `[]` selects the whole value. The declared sources are
`literal` with `value`, `runInput`, `goal`, `strategy`, `carry`, `committedOutput` with `taskId`, and
`artifactRef` with `taskId` and `name`. `carry` is available only inside the repeat that declares its
first path key. Artifact references select already committed immutable artifact metadata.

The four composition forms are:

- `sequence`: ordered `steps`; later tasks may consume committed earlier outputs.
- `choice`: `select: {taskId, path}` and `cases: {enumValue: flow}`. The producer schema must declare
  a string enum at that path, and every value has exactly one case. Cases contain the same grammar;
  expression strings and evaluation are absent.
- `parallel`: `branches: {name: {flow, required}}` and
  `results: {name: {output: {taskId, path}, required}}`. Branch names execute in stable sorted order
  for identity while branches may run concurrently. Every branch is scheduled. `required: false`
  permits its failure or missing result at the join; use `choice` or a diagnostic extension when
  work should run only conditionally. A branch reads predecessors outside the
  parallel, not an uncommitted sibling. A later task consuming an optional producer lists the
  corresponding input key in `optionalInputs`; absent optional values omit that key, and the
  consumer's input schema must accept the result.
- `repeat`: `body`, positive `maxIterations`, `budget: original-run`,
  `carry: {key: {initial: inputBinding, next: {taskId, path}}}` and
  `stop: {output: {taskId, path}, equals: enumValue}`. First-iteration carry uses `initial`; later
  iterations use the committed body output `next`. Body input `source: carry, path: [key, ...]`
  selects that value without modifying original Run input or Strategy. Stop reads a body task's
  committed named enum. Nested/parallel repeats share the original Run deadline and budget.

## Diagnostic extension slot

For an allowed diagnostic detour, add this slot to the same strict graph:

```yaml
extensions:
  - id: diagnostic
    afterTask: measure
    fragmentPath: [extra]
    returnTo: deliver
```

## Diagnostic fragment value

The producer commits a fragment value at that path with the same `flow` grammar and an explicit
return output. For example:

```yaml
flow:
  kind: task
  id: diagnostic-check
  tool: measure-json
  inputs:
    design: {source: runInput, path: [design]}
    step: {source: strategy, path: [stepMs]}
    target: {source: goal, path: [measurement_at_most]}
    original: {source: committedOutput, taskId: measure, path: []}
  contract:
    input:
      version: '1'
      schema: {$schema: https://json-schema.org/draft/2020-12/schema, type: object}
    output:
      version: '1'
      schema: {$schema: https://json-schema.org/draft/2020-12/schema, type: object}
return: {taskId: diagnostic-check, path: []}
```

The committed fragment is validated and frozen with its own digest before it can execute. It can
consume committed predecessors visible at the slot, uses new task/composition ids, returns a result
produced on every successful path, and resumes at `returnTo`. The base method and original budget
remain fixed. A slot grants no new Site Permit, tool, budget or owner authority.

Existing Act tool/observe/Workshop, every Judge rule, Explore chooser/goal/stop/convergence, Wait,
Team recipe, fork/join, loop, growth and revision declarations compile into the same finite IR.
Their original business declarations remain immutable adapter data. Revisit entries name the next
body and each exit's carry/stop binding; original generation limits are Run meter defaults. No
legacy graph scheduler is implied by compilation. Original methods and historical Runs keep their
bytes and recorded identities, and a method upgrade starts a new invocation version.

## Legacy Workshop declaration and graph binding

This section applies to legacy declarations. A new versioned flow has no native Workshop binding;
record that requirement as an unsupported binding rather than inserting these nodes into `flow`.
A Workshop is an existing `act` node variant. Its input reports are contract `outputs` produced by
earlier nodes; scalar `inputs` are bound by the node. Knowledge files also appear in the contract's
`knowledge`. The following is an additional block within `contract.yml`, not a separate file:

```yaml
outputs:
  - name: measuredInput
    path: flow/out/${design}/measurement.txt
    reader: measurement-file
    description: The preceding tool's measurement.
  - name: analysis
    path: research/analysis/result.txt
    reader: measurement-file
    description: The script's derived measurement, checked by the reader and Judge.
environment:
  wrappers: [sh]
knowledge:
  - file: analysis-method.md
    purpose: How the measurements support the analysis.
workshops:
  - id: analyze
    purpose: Read measuredInput and write a script deriving the requested measurement from its actual data.
    directory: research/analysis
    entry: entry.sh
    language: sh
    inputs: [LIMIT]
    reads: [measuredInput]
    knowledge: [analysis-method.md]
    produces: analysis
    argv: [sh, '${ENTRY}', '${WORKSPACE}', '${LIMIT}']
    licences: {}             # omit when no licensed resource is needed
```

The corresponding graph node and downstream read are real nodes, connected after the input producer:

```yaml
- id: analyze
  kind: act
  parameters:
    workshop: analyze
    arguments:
      LIMIT: { from: strategy, name: stepMs }
- id: read-analysis
  kind: act
  parameters:
    observes: analysis
```

`reads` and `produces` are exact `contract.outputs[].name` values. The model's read tool takes that
same output name. `@workshop-input:<name>` is an internal diagnostic label; it is not a declared
output, path, or read argument. `produces` names an output, not the value type its reader emits.
The output's reader emits types declared by `semantics.yml`; downstream Judge rules consume those
types. `directory` is relative to the Campaign workspace and cannot be `flow` or the readers'
reserved directory. `entry` is one filename. `argv[0]` is a declared Site wrapper, and `argv[1]`
is exactly `${ENTRY}`. A script may produce a declared output elsewhere in the Campaign workspace;
its code-writing tool is confined to the admitted code directory. Neither may escape the Site permit.

| Operand | Meaning for a controlled execution |
| --- | --- |
| `${ENTRY}` | The generated entry script inside this execution's private code directory. |
| `${WORKSPACE}` | The Campaign root containing `flow/` and the declared output paths. |
| `${WORKSHOP}` | This execution's private code directory beneath the declared `directory`, including its execution identity. |

This example passes `WORKSPACE`, so shell `$1` is the Campaign root and `$2` is LIMIT. Its input
and output paths start from `$1`. A script needing helper files in its private code directory may
also need a `WORKSHOP` operand; use the approved spec's exact operand order and document each shell
position. Obtain the Campaign root from `WORKSPACE`, never by assuming a number of parent directories
above `WORKSHOP`. The example supplies file shape, not permission to replace the spec's argv.

Reader scripts have their own argv: below `$1` is `${REPORT}` and `$2` is `${OUT}`. These are argv
arrays; shell commands, pipes and redirections belong inside scripts.

## Legacy `graph.yml` — four node kinds, outcome edges and revisit

The block illustrates node and edge syntax. For an executable Explore method, supply the actual
constraint and Goal rules from the spec: the preceding Judge needs at least two ordered rules,
constraint first and Goal second. The single rule skeleton here does not supply that whole method.

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

Read actual edges to audit endings. Judge routing uses the first rule's outcome, while an Explore
owner decision uses the current required Judge evidence. A goal-met decision ends the Run before a
revisit; a next-strategy decision follows the revisit only if the original generation budget allows
it. A terminal Judge PASS alone supplies no Campaign goal-met decision. Waits remain legitimate
where the approved spec calls for human clearance; compare each actual outcome path with that spec.
Comments such as "PASS is terminal" cannot override a PASS edge whose destination is a wait node.

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
# tools/read-measurement.sh — reads $1 (the report) and writes the reading document to $2.
set -eu
printf '{"values":[{"type":"measured_ms","unit":"ms","mode":"setup","scope":"all","value":%s}]}\n' \
  "$(awk '/^measured/ { print $2 }' "$1")" > "$2"
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
entry gives it. It guides the executing Agent; it does not establish measured facts. Explain the
method symbolically. Include a worked numeric result only with the exact input and parameters and
an observed calculation or checked result that produced it; otherwise leave the result unverified.
An example value copied from another dataset cannot serve as this dataset's expected answer.

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
