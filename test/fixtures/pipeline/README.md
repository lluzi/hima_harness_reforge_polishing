# Pack-authoring-pipeline fixtures

Where the model's side of a pipeline stage comes from when the contract suite runs one (#63). The
suite has no DeepSeek key and must never need one, so the host mounts dsh's keyless replay adapter
(`@deepseek-ai/dsh-llm-replay`, pinned exactly) in place of the DeepSeek one and plays these back as
if the model had produced them. Everything else about the session is real: a real agent, a real
loop, a real system prompt, a real tool catalog, real `read` and `write` tools against a real
filesystem under dsh's own sandbox.

**These are hand-written, and that is what they are for.** They exist to prove the mechanism — that
`/hima-grill` in a person's own message injects the skill, that the stage reads the Golden Flow
where it lies, that it writes the pack intent record into the pack folder and nothing outside it —
and they say the smallest thing a model can say while proving it. They are not recordings of
anything; what put the words into the adapter's grammar was a throwaway generator, described at the
end of this file. The controller replaces them with fixtures recorded through this same mechanism with the
owner's key, at which point the scenarios stay and only the transcripts change. The live check
(`scripts/live-check-pipeline.ts`) is what holds the real model to the same five stages.

The file shapes are the moment fixtures' (`test/fixtures/moments/README.md`): a header-only
`session.jsonl` as the plugin's primary fixture, and a bare `ReplayEntry[]` in
`replay.override.json`, which the plugin's README says *replaces* the derived script outright. Entry
shapes come from `@deepseek-ai/dsh-llm-replay`'s `lib/types/index.d.ts`; the chunk grammar comes
from `@deepseek-ai/dsh-llm`'s `lib/types/types.d.ts`.

## The scenarios

| Scenario | Model calls, in order | What it is for |
|---|---|---|
| `grill` | text (three numbered questions) · `read` the flow's `Makefile` · text (the disagreement, as its own question) · `read` ×6, one per knowledge file · `write` `INTENT.md` · text | The grill stage end to end, executing the protocol its body sets out: the frontier questions, the Golden Flow read where it lies, the one place the author's words and the flow disagree put back to the author as a question of its own and settled by a message of theirs, all six knowledge files read before anything is written, and the pack intent record written into the pack folder — citing the four that shaped an answer and not the two that read on nothing here, because the body says to read every one of them and never to cite a file that changed nothing. |
| `spec` | `read` `INTENT.md` · `read` the flow's `Makefile` · `read` ×6, one per knowledge file · `write` `SPEC.md` · text | The spec stage end to end: the intent record read back, the flow read again at the pointers it names, the six knowledge files read, and the pack spec written beside the record with every one of its nine sections naming the knowledge that shaped it. Its `Workshops` section says plainly that this probe has none — nothing of it is written by the AI at run time — and its `Knowledge` section names exactly the one file the `fabric` transcript then writes, so the spec and its compilation are one method and not two. |
| `escape` | `read` the flow's `Makefile` · `write` the flow's `Makefile` · `bash` · text | The two calls an authoring session must not be able to make, made by a stage that has just read the flow exactly as its body told it to. The read goes through; the write and the shell are refused by the authoring guard in its own words. The target is the **temp-resident Golden Flow inside the test's own home**, deliberately: that path is inside dsh's `workspace-write` sandbox — which permits `/tmp` and `os.tmpdir()` beside the session's own root — and outside the pack folder, so it is the one target that tells this product's rule apart from dsh's. `skills.test.ts` replays the same transcript a second time in a session standing in the ordinary workspace, where both calls go through and the flow really is rewritten. |
| `targets` | `read` a file outside the folder · `write` `NEW.md` · `write` a dangling link inside the folder · `write` `sub/../INTENT.md` · `write` `link/../escaped.md` · the same climb spelled absolutely · `edit` the outside file · text | The authoring guard's target rule, in one session. A file that is not there yet at the top of the pack folder goes through, because creating one is the stage's whole job; the dangling link, the three spellings that climb through `..`, and the `edit` aimed outside are refused. The test makes `link` a symlink out of the pack folder, which is what makes the climbs mean something: that spelling names two different files depending on whether `..` is removed lexically or by the kernel after the link is followed. |
| `posture` | `read` a file outside the folder · `write` it · text | What the guard does when a path will not resolve, replayed in four sessions on four boots: an absent packs directory (the write goes through, because no working directory can lie beneath a directory that is not there), a packs directory that is a link to nothing (refused, in an ordinary session), a working directory removed after the session opened, and a session standing below an ordinary file where a pack folder would be. The `read` is in it to show the refusal is the guard's and not the arrangement's: it is not a governed tool and goes through in all four. |
| `fabric` | `read` `SPEC.md` · `read` `INTENT.md` · `read` the flow's `Makefile` · `read` ×6, one per knowledge file · `read` `knowledge/pack-anatomy.md` · `read` ×4 of the sibling pack (`../opene902-timing-probe/PACK.md`, `contract.yml`, `graph.yml`, `tools/synth.sh`) · `read` ×3 of the bundle's own data (`../semantics.yml`, `../rules/setup-wns-all-nonnegative.yml`, `../rules/clock-period-at-most.yml`) · `write` ×5 (`contract.yml`, `graph.yml`, `choosers/over-constraining-push.yml`, `knowledge/push-method.md`, `tools/synth.sh`) · text (the one review, put to the author as its own question) · `write` `FABRIC.md` · `hima_pack_check` · text | The fabric stage end to end, executing the protocol its body sets out: the spec read first and the record it points back at read after it, the Golden Flow read where it lies for the command line a tool of this pack may run, all six knowledge files, then the two sources its body names for the *shape* of what it is about to write — the skeleton of every file kind a pack folder holds, and the whole pack installed beside this one, read by the relative path the body names it at — then the bundle's own semantics and the file of each of the two judge rules this spec names by id — which the body mandates before a write, because a rule you name instead of writing is a rule you have to have read, and the bundle's semantics is what says which value types already have a meaning — and only then the pack's own files: a contract whose one output is read by a reader this harness ships, a graph whose explore node applies the pack's *own* chooser (no bundled chooser is read, because the spec names none: that move is this pack's and the stage writes the file), the knowledge file the spec names, and the one tool script the flow showed. Every read is a source that body calls an authority, and the list is the whole of it: a stage that wrote without them got its shapes from somewhere the body forbids. The script it wrote is put to the author and their verdict goes into the record in their words; the gap list says `none`, because nothing the spec asked for is missing from the folder; and the stage checks its own work with `hima_pack_check` rather than declaring the folder done. |
| `contradiction` | `read` `SPEC.md` · `read` `INTENT.md` · `read` the flow's `Makefile` · `read` ×6, one per knowledge file · text (the refusal) | The one thing the fabric stage does before it writes: holding a spec against itself. The spec the test writes has a judge rule and a chooser reading a value its own Semantics section does not declare, and the answer is the refusal its body requires — `SPEC.md does not compile:` on the first line, then one finding per contradiction naming the section, the line number and the line — with no `write` anywhere in the transcript. The reads come first because the body says to read before deciding, and because a refusal from a stage that had not looked at the flow would prove nothing about the order. |
| `test` | `hima_pack_check` · `read` `SPEC.md` · `read` `INTENT.md` · `read` the flow's `Makefile` · `hima_run` (`test: true`) · `hima_status` · `write` `TEST.md` · `hima_pack_check` · text | The test stage end to end: the folder checked before a licence is spent, the Goal and the Strategy taken from the author's own message (the committed spec's `Goal template` recommends no value, and the stage's body gives it no third place to get one from, so the message states both and the `hima_run` call asks for exactly those, which the test then holds the run row to), the two facts `hima_status` cannot give it read where they are — the Golden Flow pointer out of the intent record, and the flow itself at that pointer, which is what the record's `Site` and `Disagreements` sections are about — a real Campaign on the stand-in started as a **test run**, the Run read back out of the ledger, and the record written from what that answer held. The two `{{fromRequest:(run-[0-9a-f-]+)}}` placeholders — the `hima_status` argument and the record's own `run:` line — are the run id the harness minted, which no committed file can know. Three of the record's lines are the ones the harness reads back: `Ending`'s `status: ended-converged`, and `Code` and `Refusals` saying exactly `none`, which is what that Run recorded. |
| `release` | `hima_pack_check` · `hima_pack_release` · text | The release stage end to end, which is deliberately two calls and nothing else: the stage checks the rung, asks the harness to seal the folder, and says what was sealed. No `write` appears in this transcript at all, which is the whole property — a version file a model typed would carry hashes nothing computed. |

The `read` in `escape` is not decoration: dsh refuses a write to a file the session has not read, so
without it that rule would answer first and the scenario would prove nothing about containment. The
same is true of the `read` that opens `targets`, whose `edit` would otherwise be refused for never
having read the file.

**One session per boot.** Replay's cursor does not go back to the start for a second session on the
same host, so a scenario replayed in more than one session — `escape` twice, `posture` four times —
is booted again for each.

## The two things a hand-written transcript has to get right

### A tool call is one entry; the model's next words are the next entry

A successful turn is three chunks — `block-start`, `block-end` carrying the finished block, and
`finish`. For a tool call the block is a `tool-call` (`id`, `name`, `arguments` as a raw JSON
string) and the finish reason is `{"kind":"tool-calls"}`; for words it is a `text` block and
`{"kind":"stop"}`. The loop runs the tool, appends its result, and asks the model again — so every
tool call costs one entry and the sentence after it costs another.

### How `{{fromRequest:…}}` is resolved

The replay plugin resolves `{{fromRequest:<regex>}}` against the live request — the corpus is every
string leaf of the request messages, the last match wins, the first capture group substitutes in
place, and an unmatched pattern fails loud. That is how a committed transcript names the paths no
committed file can know: where the Golden Flow lies, where the skill's own knowledge files are, and
where the guard's two scenarios were pointed.

- **Where the Golden Flow lies** — `{{fromRequest:the flow is at (\S+)}}`, read out of the very
  message the person sent (`/hima-grill … the flow is at <flowRoot>`). In the `spec`, `fabric` and
  `test` scenarios the same pattern reads it out of the `INTENT.md` the grill stage wrote, which is
  what "the stage reads the Golden Flow at the pointers the intent record gives it" means: each of
  the three reads that record first, so the last match in the corpus is the record's own pointer.
- **Where the skill's own knowledge files are** — `{{fromRequest:Base directory for this skill:
  (\S+)}}`, read out of the `<skill_content>` block the injection put in the request. dsh renders a
  bundled skill's resource base into that block as `Base directory for this skill: <path>` and tells
  the model to resolve the skill's relative paths against it, so a stage reading
  `knowledge/<file>.md` is reading exactly where the provider said its resources are.
- **Where the guard's scenarios were pointed** — `{{fromRequest:the outside file is (\S+)}}` and
  `{{fromRequest:the pack folder is (\S+)}}` in `targets` and `posture`, read out of the message the
  test sends. A pack folder and a file beside it inside an isolated home have no path a committed
  file could hold either, and the absolute climb in `targets` has to be spelled against the real one.
- **Which Run the test stage started** — `{{fromRequest:(run-[0-9a-f-]+)}}` in `test`, read out of
  what `hima_run` answered. The harness mints a run id when the Campaign opens, so no committed file
  can hold one; the pattern carries no brace and no backslash on purpose, because a `{` inside a
  placeholder would end the placeholder and a `\` would have to survive one more level of escaping.
  Every match in one of these sessions is the same Run — there is exactly one — and a record id
  (`run-…#000003`) matches down to the `#`, which is that same run id.

**What a transcript states outright rather than reading back.** Only what the harness itself invents
is a placeholder. The Site (`local`), the ending (`ended-converged`), the periods each generation
asked for and what was measured are all *stated* in the `test` scenario's record, because the
stand-in is arithmetic and this scenario is deterministic — and the test then asserts that the ledger
says the same thing. A fixture that read its own conclusions back out of the answer would agree with
whatever happened, which is the one thing a test record must not do.

Two things this costs, and both are in the generator that wrote these files:

- **The placeholder is resolved on the `arguments` string**, one JSON level above the argument
  object. A pattern passed through `JSON.stringify` with the rest of the arguments comes out with
  its backslashes escaped one level too many, and the plugin then matches a literal backslash and
  fails loud. So the pattern is spliced into the already-encoded arguments text.
- **The captured path is substituted into a JSON string**, so the pointer line in `INTENT.md` ends
  at the path — `the flow is at <path>` and then a newline. A pattern that ran on past the path
  would carry a full stop into the filename, and the stage after it would read a file that is not
  there.

The same escaping is why anything reading a transcript's arguments back has to substitute **before**
it parses: `\S` is not an escape JSON knows, so `JSON.parse` of an unresolved arguments string
throws. `committedRecord` in `test/contract/support/pipeline.ts` — which hands the live check the
same intent record the suite runs the grill stage against, so that the keyless run and the live run
author from one intent — does it in that order, and refuses loudly when a placeholder it cannot
resolve is left behind.

## The generator

What every transcript says is written by hand, as above; what put it into the replay adapter's
grammar was a throwaway generator, because the splicing described here is easy to get wrong by hand
and silent when it is. The generator is not committed — what it knows is written down here instead,
because a generator nobody runs again is a file that goes stale while the fixtures it wrote stay
right.

## Five scenarios, one session

`replayStages` (`test/contract/support/pipeline.ts`) concatenates `grill`, `spec`, `fabric`, `test`
and `release` into one script in the home, so the whole pipeline can be replayed the way a person
runs it: one boot, one session, one folder, five stages. The concatenation is written into the home
and never committed — it holds nothing these five files do not, and a sixth copy would be one more
thing to correct the day any of them is re-recorded. Nothing in the five may depend on being played
first: the placeholders are resolved against the whole live request, and every one of them resolves
to the same value in a joined session as it does in a session of its own.

## The one row the scenarios need beside the stand-in

dsh generates a session title from the first human message, and it does so with a model call of its
own **on the same session** (`@deepseek-ai/dsh-session-title-first-prompt-llm`, purpose
`session-title`). Replay's cursor is per session and advances at invocation time, so that call would
eat one of the entries below — and it is deferred, so which one it ate would differ from run to run.
`test/contract/support/pipeline.ts` therefore disables that one row in the home's own patch layer,
beside the stand-in, so the only model calls on the session are the stage's own.
