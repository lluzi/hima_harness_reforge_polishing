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
   **If `state/round-decision.json` has a `nextLever`, act on it first:** it names a candidate of
   the last round that fails only the transmittance window and/or a few authority-DRC markers
   (three or fewer in the single cell) and is better than the best legal one. Make it the `base`
   and apply its `action`: for markers, run `markers` on it and copy `bestEdits` (or
   `combined.edits`) at its own outline and objective; for the transmittance minimum, one
   `band-trim` of a wide supply band plus `min-ratio` at that outline. The Run does not converge
   while it is untried.
2. **Write the hypothesis** at the top of `plan/round-NN/plan.json` before anything else: what you
   expect to move and why (for example: "narrowing the storage-node link under the anode lowers
   storage-node-to-anode coupling with no scan-line load").
3. **Choose the base**: `original`, `best`, or a candidate id from history (for a repair). Section 7
   says which, round by round, and holds plans to copy.
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

Each operator is an object whose `op` field names it; its parameters name nets, layers and roles,
never coordinates (example: `{"op": "band-trim", "net": "<supply net>", "layer": "<layer>",
"widthUm": 3.5}`):
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
| `bounded-edit` | Already broken in the start layout | `markers` proposes edits (each ≤ 1.5 µm, never a channel or capacitor vertex, ≤ 12 per plan) and checks each against the authority deck: copy `bestEdits` (or `combined.edits` when it is lower), or write your own and preview with `try-edit` until clean. |
| `binding-chain` | At the binding chain; the solve was infeasible there | Step the outline back with a new front point, or propose a topology operator if allowed. |

## 7. Lessons from real runs: copy these

These rules come from the Pack's runs on a real customer pixel, each one learned from a candidate the
commercial tools judged. Apply them unless the card or the history clearly says otherwise.

### Order of work

1. **Legal first, better second.** The first legal candidate is the anchor. Every point that tries
   to improve the ratio or the outline starts from the best *legal* candidate (`"base": "best"`, or
   its id). A point started from an illegal base inherits its markers, and the ratio it reaches does
   not count.
2. **One axis at a time.** Shrink the axis the card's pitch bound shows has room (usually the
   height) first, then the other axis from that legal, already shrunk candidate. Asking for both at
   once from the original leaves many markers.
3. **Ask for a reachable outline.** A `min-pitch` point below the card's pitch bound comes back at
   the bound, often with markers. Ask for the bound, or 0.05 to 0.1 µm above it, and read the
   binding chain in the card to see which shapes hold the axis.
4. **Ratio at the outline you reached.** Put `min-ratio` at the outline a legal candidate already
   has. The ratio step moves shapes only within the trust radius, so it first compacts to the asked
   outline; when that outline is beyond reach the point comes back `partial`, and the ratio gain is
   smaller.
5. **Transmittance last, and in steps.** When a legal candidate sits at or under the transmittance
   window's minimum, add one `band-trim` of a wide opaque band that carries no device (a supply
   line; never a gate, a channel or a capacitor plate) and re-run `min-ratio` at the same outline.
   Start with a width 0.5 µm under the band's present width; a trim that lifts transmittance over
   the window's maximum is as illegal as no trim. Narrow further only after a receipt shows room.

### Plans to copy

Fill each `<...>` from the card, the Goal or the round decision; `plan-check` refuses a plan that
still holds one.

Round 1 (from the original):

```json
{"schema": "pixel.plan/1", "round": 1, "base": "original", "operators": [],
 "hypothesis": "make the original legal on the authority deck, and learn how far the outline goes",
 "frontPoints": [{"name": "legal", "objective": "legalise"},
                 {"name": "target", "objective": "min-pitch", "outlineUm": [<goal w>, <goal h>]}],
 "pairConstraints": [], "edits": [], "expect": "a clean candidate at the original size"}
```

Round 2 (from the clean candidate):

```json
{"schema": "pixel.plan/1", "round": 2, "base": "best", "operators": [],
 "hypothesis": "shrink the free axis and cut the ratio at that outline; push the other axis to its bound",
 "frontPoints": [{"name": "ratio", "objective": "min-ratio", "outlineUm": [<current w>, <goal h>]},
                 {"name": "width", "objective": "min-pitch", "outlineUm": [<card x bound>, <goal h>]}],
 "pairConstraints": [], "edits": [], "expect": "legal at the goal height; ratio below the original"}
```

Round 3 (from the narrower legal candidate, transmittance at the window's minimum):

```json
{"schema": "pixel.plan/1", "round": 3, "base": "best",
 "operators": [{"op": "band-trim", "net": "<supply net of the widest opaque band>", "layer": "<its layer>", "widthUm": <present width - 0.5>}],
 "hypothesis": "a slimmer supply band lifts transmittance into the window at no device cost",
 "frontPoints": [{"name": "ratio", "objective": "min-ratio", "outlineUm": [<reached w>, <reached h>]}],
 "pairConstraints": [], "edits": [], "expect": "transmittance inside the window; ratio no worse"}
```

### Reading what came back

0. **One fix away beats starting over.** A candidate that passes LVS, channels, capacitor, loads
   and couplings and misses only the transmittance window or a few DRC markers is worth more than
   a new point from the old legal base: repair its markers with the verified edits, trim it
   (minimum) or shrink it slightly (maximum) next round. The round decision names it as
   `nextLever`. (A live Run once stopped beside its best-ratio candidate, held back by one marker.)

6. **Markers only in the 2x2 and 3x3 tiles** (the single cell is clean) sit across the cell
   boundary: a shape and its neighbour's copy. Step that axis back by 0.05 to 0.1 µm with a new
   front point before you try edits; the shapes inside the cell are fine.
7. **Use what `markers` verified.** Its `bestEdits` and `combined.edits` were each run through the
   authority deck; copy them as they are. Repairs go on the source/drain or a supply shape, never on
   a gate: an edit that moves a gate edge across the poly changes a transistor, and LVS fails.
8. **A `legalise` point on a clean base is refused** (`already-clean`). The solve legalises the
   original by itself, including the small verified reshapes compaction cannot make.
9. **Predictions guide, receipts decide.** The model's ratio prediction has come within a few
   tenths of a percentage point; use it to rank points, never to report. When a point's measured
   gain has the opposite sign to its prediction, try a different lever next round rather than the
   same one harder.
10. **Watch the loads.** A shield or a wider supply shape next to a scan line raises that line's load:
   a VDD shield over a scan line has nearly doubled that line's load before. Keep every load inside the Goal's allowance, and
   put any point that needs more in as `exploratory`.
11. **Know when to stop.** The storage capacitor is held, so the ratio has a physical floor (the
   coupling built into the drive transistor). When two rounds move the best legal ratio by less than
   the convergence band, stop asking for more ratio: deliver the best legal candidate with its
   shortfall stated, and use at most one exploratory point (more load, or a declared capacitor change
   when the Goal allows one) to show the customer what the next step would cost.

## 8. Prohibitions

- Never write or edit a layout, a receipt, a history line or any `state/` file other than
  `state/round/plan.json` (written by `plan-check`).
- Never state a measured value you did not read from a receipt; previews and predictions are not
  measurements.
- Never ask for a capacitor change without `cst_ceiling_ff`, or a contact move without
  `topologyMoves: allowed`.
- Never deliver a plan whose only change is a front point already judged with the same base.
