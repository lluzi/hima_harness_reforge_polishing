# hima-test

You run the compiled pack on a real Site, as a Campaign marked a test run, and write the test record
from what that Run actually recorded.

Your ordinary file tools write exactly one file: `TEST.md`, in the session's working directory.
That directory is the Pack folder; keep all method files unchanged during the test. A declared
Workshop generates runtime code separately through `hima_execute write` in its admitted private
execution directory. Runtime code is evidence of this Run; it does not change the Pack method.

A pack without a test record is not releasable. That is what this stage is for, and it is why every
line of the record is read back out of the Run rather than written from what you expected.

## Before you start anything

1. **Call `hima_pack_check`** with this pack and the Site the author named. If the folder stands
   below `compiled`, refuse in words: say which rung it is on, what the next one needs and which
   stage writes it, and stop. Do not start a Campaign of a folder that is not a pack yet.
2. **The Site.** Take it from the author's message. If they named none, ask which Site to test on and
   stop until they answer. A Site is where licensed time is spent; it is not a thing to guess at.
3. **Read `SPEC.md`** for the two things the Run needs and the two the record is judged against: the
   `Goal template` says what a Campaign of this pack is for and what its parameters are, `Choosers`
   and the contract's own strategy say what it starts set to, and `Endings` says which endings this
   pack declares for itself.
4. **Read `INTENT.md`** for the one thing no ledger can answer: its `Golden Flow` section says which
   flow this pack was authored against and where it lies. The record's `Site` section names that
   flow, and its `Disagreements` section is about this pack and that flow. Read the flow there, where
   it lies, for the stages those disagreements will be about.

## The Run

Call `hima_run` with:

- `pack` — this pack,
- `site` — the Site the author named,
- `test: true` — this Run is the test of this pack, and the record rests on its being marked one,
- `goal` — the parameters the spec's `Goal template` states, each with the value the author's message
  gave for it or, where their message gave none, the value the spec's `Goal template` itself
  recommends. Those two are the whole of where a value may come from; when neither states one, ask
  for it in the words the rules below give and start no Run,
- `strategy` — only where the author's message asked for something other than the pack's own declared
  defaults. A knob they said nothing about is left at the default the pack declares, which is a value
  the pack states and not one you picked.

The tool prepares the Run and returns promptly with its execution context. This same conversation is
the Run's owner; no hidden Agent or automatic graph driver continues it. Keep the returned Run id.

Read `hima_context`, then use `hima_execute` with its current owner epoch and control revision to:

1. Read `run.control.epoch`, `run.control.revision`, `available`, `executions` and the method's
   contract/reference graph. Each action carries `run`, `expectedEpoch`, `expectedRevision` and
   `requestId`. `begin` names one available `nodeId`; retain its admitted `executionId` for node actions.
2. For a Workshop, call `recommend` with its `executionId` to obtain the purpose, private entry path,
   actual argv/values, declared reads, knowledge and output. Use `read` with the declared `output`,
   `knowledge` with the declared `file`, and `write` with a relative private code `path` and exact
   `content`. Derive the algorithm from actual inputs. Then call `work` for its real Job. For other
   nodes, use `work` for the declared mechanical operation. A Job starts asynchronously and its identity
   returns before completion. Do not wait in a long foreground tool or start a second Run.
3. Inspect new context and actual Job/output facts. A notification only says new facts were saved;
   it does not mean the node succeeded or give permission to ignore a pause.
4. Request `complete` only when that execution is `ready` with actual required evidence. A Workshop
   still needs its declared reader and Judge nodes after its script exits. At an exploration node, state the decision,
   strategy where needed, rationale and citations yourself; Judge remains the verdict authority.
5. Choose the next available node only after completion is accepted. Repeat within the fixed budget.

Use a unique request id for each new action; an identical retry keeps its id and arguments. After a
stale/refused response read context again before deciding. Respect the author's mid-run instructions:
`pause` blocks new work while Jobs may still run, `cancel` requests actual stop, and `continue` requires
authorization. Re-read owner/epoch/revision after every mutation. Job completion, notifications and
reconnection do not authorize continuing a paused Run. Keep active code bytes unchanged while a Job
uses them. Never claim a Job stopped or a node completed from the request alone. `revise`/`grow`
may be unsupported; report that response rather than substituting a hidden automatic driver.

Then call `hima_status` with the run id it answered, and write the record from that. Every fact about
the Run — its status, its generations, the code it wrote, what it refused, its blockers — comes out of
that answer and out of nothing else. The two facts that are not about the Run are the two read above:
which Golden Flow this was checked against, from `INTENT.md`, and which endings this pack declares,
from `SPEC.md`. If a field you expected is not in the answer, say so in the record rather than
filling it in from what you assumed.

## `TEST.md`

One file, with exactly these sections, in this order, and no other heading. A record that holds a
heading of its own, holds one of these twice, or puts them in another order does not validate, and
the folder does not stand at `tested`.

- `## Site` — the Site this was run on, and the Golden Flow it was checked against, by the pointer
  `INTENT.md` gives.
- `## Run` — one line, exactly `run: <run id>`, and beside it the Goal and the Strategy the Run
  started at. The run id is what everything else in this record is evidence from, and the harness
  reads this line: a record without it does not validate.
- `## Ending` — one line, exactly `status: <the run's status>`, in the ledger's own word for it and
  not a paraphrase of it, and beside it whether that ending is one the spec's `Endings` section
  declares. Say plainly when it is not.
- `## Generations` — one line per generation: what it asked for, what was measured, and the verdicts.
- `## Code` — one line per code record, each carrying that record's sha256, and beside it the path,
  the node it was written at and the attempt. Exactly `none`, and nothing else, when the Run wrote
  none.
- `## Refusals` — one line per refusal record, each carrying that record's id, and beside it the
  reason it carries. Exactly `none`, and nothing else, when there were none.
- `## Disagreements` — each place this pack and the Golden Flow disagreed, read from what the Run
  recorded — its blockers, its refusals, the flow's own words in a log tail — and from the flow
  itself: a value the flow states differently from what the spec expected, an ending the flow reached
  that the pack does not declare, a stage a tool line drove that the flow refused, a tool that did
  not behave as its script says. `none` when there were none, and say `none` only when you have
  looked.

**Three of those lines the harness reads**, and it holds them against the Run itself: the `Ending`
section's `status:` line must be the status that Run ended with, exactly; the `Code` section must
carry the sha256 of every code record that Run wrote, or say `none`; and the `Refusals` section must
carry the id of every refusal record it made, or say `none`. A record that says anything else about
those three does not stand, and the check names the section. That is not a formality: the record is
the evidence a release seals, and these three are the claims a ledger can be asked about.

Then check the folder again with `hima_pack_check` and say what it answers. A folder at `tested` is
ready for `/hima-release`.

## Rules that do not bend

- **Immutable method.** Ordinary file writes create only `TEST.md` in this folder. Runtime Workshop
  code uses the admitted execution's controlled write operation and is recorded by the Harness.
- **Nothing invented.** Every line of the record is something `hima_status` answered. A generation you
  did not see, a verdict you expected, an ending you assumed — none of those goes in.
- **The Run is marked.** `test: true`, always. A Campaign that was not marked a test is not evidence
  that this pack was tested, and the harness will say so when the folder is checked.
- **One Run.** If the Run ends waiting for a person, say so and stop: a blocked Run is a fact about
  this pack that the author has to see, not a reason to start another.
- **Use recorded identities.** Code hashes, the method digest and the check against the ledger are
  the Harness's (`hima_pack_check`, and the release stage's own verb). Copy those actual hashes into
  the test record; never fabricate them. The Workshop's declared numerical analysis still computes
  from actual inputs.
- **The numbers are the author's, never yours.** Every value on the `goal`, and every override on the
  `strategy`, comes from the author's message or from the spec's `Goal template` recommending one, and
  from nowhere else. Not from the Golden Flow's own numbers, not from the contract's or the chooser's
  defaults, not from a pack installed beside this one, not from anything you find in this harness, and
  not from what you judge would make a good test. Where the message and the template both state a
  value, the author's message wins — it is the later word of the two.
- **A parameter nobody stated stops the stage.** When neither the author's message nor the spec's
  `Goal template` states a value for a parameter of the Goal, ask for it, in these words, and start no
  Run:

  > The Goal template names <parameter> and recommends no value; what should this test Run ask for?

  Then stop until they answer. A Campaign spends a Site's licensed time on the numbers it is given, so
  a number you chose is a test of a pack nobody asked for — and the record it leaves would say this
  pack was tested against a target the author never set.
