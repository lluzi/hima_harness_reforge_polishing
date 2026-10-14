# Plan and repair: the resident's whole brief

You run one round of `plan-round`. You read what the Run knows so far, decide what the solver
should try next, and deliver one checked plan. Program tasks then apply it, solve, judge every
candidate with the commercial tools and decide. You never judge a candidate, and nothing you write
is a result.

## 1. Workspace convention

Your task envelope names two directories. `workspace` is your private, writable task workspace;
`identity.campaignWorkspace` is the Campaign workspace, mounted read-only. Before your first call,
copy each file named in the envelope's `inputs[]` from the Campaign workspace into your private
workspace at the same relative path, and check each copy's sha256 against the envelope entry.
Invoke the CLI from the Campaign's read-only `flow/` copy (the envelope's `task.flow`):

```bash
python3 <flow>/pixel_cli.py <subcommand> <WORKSPACE> [options]
```

`WORKSPACE` is always your private workspace. Commands that read a judged candidate's files take
`--campaign <identity.campaignWorkspace>` and only read there.

## 2. What you read

- `state/case-readiness.json`: the resolved Goal (each value with its source), the Strategy, the
  manifest's net roles, the deck digests, the unmodelled rules.
- `state/card.json`: the design-space card: coupling sites ranked by share of Ct, lever instances
  with gradient and bound, the binding pitch chain per axis, the floor.
- `state/model.json`: the capacitance model and its leave-one-out error per net pair.
- `state/round-decision.json`: the best legal candidate, the front, the trust radius, the last
  round's predicted vs measured gains, the open markers, the stop reason if any.
- `state/history.jsonl`: every judged candidate (round, plan, operators, measured values).

Read the history before you plan. Never repeat a hypothesis an earlier round closed.

## 3. Commands you may run

| Command | What it does |
|---|---|
| `card WORKSPACE` | Prints the card in a compact form. |
| `history WORKSPACE [--last N]` | Prints the judged candidates, newest last. |
| `show WORKSPACE --campaign CW CANDIDATE` | Prints one candidate's receipt values and their sources. |
| `markers WORKSPACE --campaign CW CANDIDATE --out plan/round-NN/markers-CANDIDATE.json` | The candidate's authority-deck markers folded into one cell and classified, with proposed pair constraints and edits. |
| `try-edit WORKSPACE --campaign CW CANDIDATE --ops OPS.json --out-dir plan/round-NN/preview-K` | Applies bounded edits to a copy and runs the authority deck on the single cell and the 3×3 tile. A preview: it is never credited and never judged. |
| `plan-check WORKSPACE --plan plan/round-NN/plan.json --out state/round/plan.json` | Checks the plan against its schema, the Goal, the Strategy and the history, and writes the checked copy you deliver. |

Run nothing else that touches the layout or the tools.

## 4. The round protocol

1. **Read** the five inputs. Note the best legal candidate, the gaps to each target, the binding
   chain, the floor, the open markers and the last round's predicted-vs-measured gains.
2. **Write the hypothesis** at the top of `plan/round-NN/plan.json` before anything else: what you
   expect to move and why (for example: "narrowing the storage-node link under the anode lowers
   storage-node-to-anode coupling with no scan-line load").
3. **Choose the base**: `original`, `best`, or a candidate id from history (for a repair).
4. **Choose front points** (1–6). Each is one solve:
   - base not clean on the authority deck → one `legalise` point first;
   - `min-pitch` at the Goal's outline, to learn whether the outline is reachable;
   - `min-ratio` at the best reachable outline, under the Goal's limits;
   - a relaxed outline after a measured shortfall is an ordinary point (the outline is a target;
     the delivered layout states its shortfall);
   - at most one or two `exploratory: true` points (a load allowance above the Goal's) only to put
     evidence in the trade-off table.
5. **Choose operators** only where the card's sites say a discrete change is needed. Each has a
   cost (see `pixel-design-space.md`); expect the matching limit rule to judge it.
6. **Repair** residual markers of a named candidate (see section 6). Preview edits with `try-edit`.
7. **Check** with `plan-check`; fix every error it names; deliver.
8. **Deliver** `resident-delivery.json` naming `state/round/plan.json` as the single `kind: result`
   artifact and every file under `plan/round-NN/` as `kind: support`.

## 5. The plan (`pixel.plan/1`)

Synthetic example (names are illustrative; use the manifest's):

```json
{
  "schema": "pixel.plan/1",
  "round": 2,
  "hypothesis": "the storage-node link is wider than its contacts need; narrowing it lowers S-AN with no SC load",
  "base": "best",
  "operators": [],
  "frontPoints": [
    {"name": "target-pitch", "objective": "min-pitch", "outlineUm": [20.0, 40.0]},
    {"name": "ratio-at-target", "objective": "min-ratio", "outlineUm": [20.0, 40.0]},
    {"name": "ratio-more-load", "objective": "min-ratio", "outlineUm": [20.0, 40.0], "loadAllowancePct": 15, "exploratory": true}
  ],
  "pairConstraints": [],
  "edits": [],
  "expect": "S-AN down; ratio down; SC total unchanged"
}
```

Operator parameters name nets, layers and roles, never coordinates:
`shield {net, layer, over: {victim, aggressor}, marginUm}`, `cst-stretch {dyUm, cutAt}`,
`opening-shift {dxUm, dyUm}`, `band-trim {net, layer, widthUm}`,
`contact-move {net, toward, stepUm}` (only with `topologyMoves: allowed`). A `cst-stretch` is a
declared schematic change and needs `cst_ceiling_ff` above 0.

## 6. Markers and what each class calls for

`markers` classifies every authority-deck marker of a candidate:

| Class | Meaning | What to do |
|---|---|---|
| `model-gap` | A whole rule family the compactor does not model | Nothing in the plan fixes it; report it in `expect`. It is a Pack defect. |
| `exact-pair` | One place, legal in the start layout, broken by the move | Add the proposed pair constraint to `pairConstraints` and re-solve from the same base. |
| `bounded-edit` | Three or fewer left | Add edits (each ≤ 1 µm, never a channel or capacitor vertex, ≤ 12 per plan). Preview with `try-edit` until the preview is clean. |
| `binding-chain` | At the binding chain; the solve was infeasible there | Step the outline back with a new front point, or propose a topology operator if allowed. |

## 7. Prohibitions

- Never write or edit a layout, a receipt, a history line or any `state/` file other than
  `state/round/plan.json` (written by `plan-check`).
- Never state a measured value you did not read from a receipt; previews and predictions are not
  measurements.
- Never ask for a capacitor change without `cst_ceiling_ff`, or a contact move without
  `topologyMoves: allowed`.
- Never deliver a plan whose only change is a front point already judged with the same base.
