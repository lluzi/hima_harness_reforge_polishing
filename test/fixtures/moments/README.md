# Model-moment fixtures

Where the model's side of a Model moment comes from when the contract suite runs one (#59). The
suite has no DeepSeek key and must never need one, so a driven host mounts dsh's keyless replay
adapter (`@deepseek-ai/dsh-llm-replay`, pinned exactly) in place of the DeepSeek one and plays these
back as if the model had produced them. Everything else about the session is real: a real agent, a
real loop, a real system prompt, a real tool catalog.

**These are hand-written, and that is what they are for.** They exist to prove the mechanism — that a
moment opens, that one turn runs and answers, that a host restart mid-moment reconciles — and they
say the smallest thing a model can say while proving it. They are not recordings of anything. The
controller replaces them with fixtures recorded through this same mechanism with the owner's key, at
which point the scenarios stay and only the transcripts change.

## What a scenario is made of

Each directory is one scenario, and each holds two kinds of file:

- `session.jsonl` — the replay plugin's **primary fixture**, a projected dsh session log. Here it is
  a header line and nothing else: one v0 session header (`version`, `type: session`, `id`,
  `createdAt`, and a `{{cwd}}` token the plugin resolves). A header-only log derives an empty script,
  which is exactly right, because the script comes from the sidecar beside it.
- `*.override.json` — the plugin's **override sidecar**, a bare `ReplayEntry[]`. The plugin's README
  says a bare array *replaces* the derived script outright, so the array is the whole transcript and
  the primary fixture only has to be a valid log. That pair is the smallest thing a person can write
  by hand: writing the model's words as a real `assistant/message` row would mean hand-writing an
  embedded stream, its envelope and its settlement, all to say one word.

Entry shapes come from `node_modules/@deepseek-ai/dsh-llm-replay/lib/types/index.d.ts`
(`ReplayEntry`, `ReplayOverrideDoc`). A successful turn is the same three chunks dsh's own derivation
produces for a settled call: `block-start`, `block-end` carrying the finished block, and `finish`.

## The scenarios

| Scenario | Files | What it is for |
|---|---|---|
| `one-turn` | `session.jsonl`, `replay.override.json` | The model answers `READY`. One moment, one turn, one pair of `session` records. |
| `refused` | `session.jsonl`, `replay.override.json` | The model route answers nothing. A zero-chunk `throw` entry is the one failure a durable settlement cannot express, which is exactly why the sidecar exists; it is how the suite reaches the route's `502 hima/moment-failed` and the `closed:failed` outcome without a key and without a network. |
| `hang-then-answer` | `session.jsonl`, `replay.override.json`, `after-restart.override.json` | The moment that was interrupted. The first host's model call **hangs**: replay writes the `readyFile` and then waits for a cancellation that never comes, so the test knows the moment is open and can take the host away mid-turn. The second host boots on the same home with `after-restart.override.json` and answers. |

### Why `hang-then-answer` has two sidecars rather than one with two entries

Replay binds a live session to a recorded script by **first-call order, per process**: the first live
session to make a model call claims the primary script and advances its own cursor. A restarted host
is a new process with a new session, so it claims that script from its *first* entry again — a single
sidecar reading `[hang, answer]` would hang a second time rather than answer. The two files say what
each of the two hosts replays, which is the honest shape of a scenario whose whole subject is that
there are two hosts.

### `{{readyFile}}`

`hang-then-answer/replay.override.json` carries `"readyFile": "{{readyFile}}"`. A ready file has to
live inside the test's own throwaway home — a committed fixture cannot name a path that exists — so
`writeMomentFixture` (`test/contract/support/moments.ts`) copies the scenario into the home and
substitutes the real path on the way. The token never reaches the plugin.
