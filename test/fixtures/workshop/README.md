# Workshop fixtures

Where the model's side of a **workshop** comes from when the contract suite runs one (#62). A
workshop is the one act node where the model writes a script and the fabric runs it as a Job, so the
model's side of it is a handful of tool calls: read the knowledge the pack carries, read the outputs
the declaration allows, write the entry file, and say so. The suite has no DeepSeek key and must
never need one, so a driven host mounts dsh's keyless replay adapter
(`@deepseek-ai/dsh-llm-replay`, pinned exactly) in place of the DeepSeek one and plays these back as
if the model had produced them. Everything else is real: a real agent, a real loop, a real system
prompt, the three real `hima_workshop_*` tools against a real Site under its Permit.

**These are hand-written, and that is what they are for.** They exist to prove the mechanism — that
the moment opens with exactly three tools, that a write inside the declared directory lands and
becomes a `code` record, that a write outside it is refused and never sent, that a script which exits
non-zero spends the Retry allowance, and that a host taken away mid-moment or mid-Job reconciles to
one chain — and they say the smallest thing a model can say while proving it. They are not recordings
of anything; what put the words into the adapter's grammar was a throwaway generator, described at
the end of this file. The controller replaces them with fixtures recorded through this same mechanism
with the owner's key, at which point the scenarios stay and only the transcripts change. The live
check (`scripts/live-check-workshop.ts`) is what holds the real model to the same workshop.

The file shapes are the moment fixtures' (`test/fixtures/moments/README.md`) and the pipeline
fixtures' (`test/fixtures/pipeline/README.md`): a header-only `session.jsonl` as the plugin's primary
fixture, and a bare `ReplayEntry[]` in `replay.override.json`, which the plugin's README says
*replaces* the derived script outright. Entry shapes come from `@deepseek-ai/dsh-llm-replay`'s
`lib/types/index.d.ts`; the chunk grammar comes from `@deepseek-ai/dsh-llm`'s `lib/types/types.d.ts`.
A tool call is one entry and the model's next words are the next entry, exactly as the pipeline
README sets out.

## The scenarios

| Scenario | Model calls, in order | What it is for |
|---|---|---|
| `writes` | `hima_workshop_knowledge` `mining.md` · `hima_workshop_read` `qorReport` · `hima_workshop_write` `miner.sh` · text | The workshop end to end: the moment opens with the three tools, the model reads what the pack knows and what the generation produced, writes the entry, and the fabric runs it as a Job whose script writes the output the declaration `produces`. |
| `refused` | `write` `../../flow/Makefile` · `write` the report's own absolute path · `write` `sub/../miner.sh` · `write` `miner.sh` · text | The write tool's target rule, in one session: the three spellings that leave the workshop directory are refused — recorded, answered with the reason, and never sent to the Site — and the good write that follows them lands, so the Run still completes. |
| `failing` | four sessions, each `write` `miner.sh` · text | A script that exits 3, written again at each of the three attempts the Retry allowance permits, then the good script at the fourth moment a resume opens. Four model sessions in one host process, which is what the child logs below are for. |
| `hangs` | one `hang` entry with `readyFile` | The moment that was interrupted. The host's model call **hangs**: replay writes the `readyFile` and then waits for a cancellation that never comes, so the test knows the moment is open and can take the host away mid-turn. The second host boots on the same home with `writes` as its primary and answers. |
| `slow` | `write` `miner.sh` · text | A script that sleeps twenty seconds before it writes the output, so a host can be taken away while the **Job** runs rather than while the moment is open. The second host picks that Job up, and opens no second moment. |
| `rewrites` | `write` `miner.sh` (counts 3) · `write` `miner.sh` (counts 8) · text | The model correcting itself: the same path written twice in one moment. Both writes land and each is a `code` record of its own — a `code` record is one **version** of one file — the Job runs the second, and the card counts one file rather than two. |

## Several model sessions in one host process

`failing` is three attempts at one node and then a fourth after a resume, which is four Model moments
and therefore four dsh sessions inside one host process. The replay adapter binds a live session to a
recorded script by first-call order — the first claims the primary script, each later one the next
*child* script — and a sidecar, in either of its forms, replaces or patches **the primary session's
script alone** (its README, §Known limitations). So the second session onwards cannot be a sidecar:
each has to arrive as a recorded session log.

They are committed as sidecars all the same — `session.1.override.json`, `session.2.override.json`,
`session.3.override.json`, numbered from one for the session after the primary — because a bare
`ReplayEntry[]` is what a person can read and edit. `writeMomentScenario`
(`test/contract/support/moments.ts`) is what turns each of them into a child session log inside the
test's own home, and `--replay-child` is how the driven shell hands them to the adapter.

### The shape of a child log, and where it comes from

One physical Session header, then one row group per model call:

| Row | Data |
|---|---|
| `turn/start` | `{ turn }` |
| `step/start` | `{ turn, step: 1 }` |
| `assistant/attempt` | `{ turn, step: 1, stream: [{ type: 'chunk', time: 0, chunk }, …] }` |
| `step/end` | `{ turn, step: 1 }` |
| `turn/end` | `{ turn, reason: { kind: 'completed' } }` |

The header carries the current Session format generation, `type: 'session'`, an `id`, a `createdAt`
that sorts after the primary's own zero, the `{{cwd}}` token the adapter resolves, `delegationDepth:
0` and `isSeeded: false`. The stream is the *raw-chunk* form of a compact attempt stream
(`AssistantStreamRecord`, `@deepseek-ai/dsh-llm`'s `lib/types/assistant-stream.d.ts`), one record per
chunk, so no delta boundary is joined and the adapter's expansion is the chunk list exactly as
written.

**`assistant/attempt` and not `assistant/message`.** `deriveReplayScript` reads one entry from each
of the two alike, and an attempt is the event dsh records for "one model attempt that committed no
surface message" — which is precisely what a synthesized row is. A message is the worse choice twice
over: the format's invariants require it to carry an identified message with a model source, and a
tool call inside one requires the matching `tool/call` and `tool/result` rows beside it or the whole
log is refused (`step/end leaves unresolved tool call`) — so a transcript of three tool calls would
have to invent three tool results nobody produced.

A `throw` before any chunk and a `hang` are the two failures the adapter documents as unreconstructable
from a durable settlement, so neither can be a child: `writeMomentScenario` refuses one in a child
position, naming the file.

**The check is not a claim.** Every child log's own text is put through the adapter's own
`parseSessionLog` and `deriveReplayScript` before it is written, and the derived script is held
against the entries it was built from. It is the text that is checked and not the file — the parse
happens in memory, on the very bytes about to be written — so a dsh whose Session format has moved on
fails at the line that writes the file, with the format's own words, rather than inside a booted
host.

## `{{fromRequest:…}}` and `{{readyFile}}`

`refused` names the report's own absolute path, which no committed file can know: it is read out of
the live request with `{{fromRequest:qorReport at (\S+)}}`, which matches the line the workshop's own
instructions give the model for each output it may read. The adapter resolves the placeholder against
every string leaf of the request messages, last match wins, first capture group substitutes in place,
and an unmatched pattern fails loud. As in the pipeline fixtures, the pattern is spliced into the
already-encoded `arguments` string, one JSON level above the argument object, because a pattern passed
through `JSON.stringify` comes out with its backslashes escaped one level too many.

`hangs/replay.override.json` carries `"readyFile": "{{readyFile}}"`. A ready file has to live inside
the test's own throwaway home, so `writeMomentScenario` substitutes the real path on the way in; the
token never reaches the plugin.

## The generator

What every transcript says is written by hand, as above; what put it into the replay adapter's
grammar was a throwaway generator, because the splicing described here is easy to get wrong by hand
and silent when it is. The generator is not committed — what it knows is written down here instead,
because a generator nobody runs again is a file that goes stale while the fixtures it wrote stay
right.
