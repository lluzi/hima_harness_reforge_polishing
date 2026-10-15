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

**You work beside a repair engineer.** Each round a second resident takes the near-misses listed in
`state/repair-orders.json` (candidates that fail only the authority deck with a few markers and would
beat the best legal candidate once clean) and repairs them with bounded edits, in parallel with your
plan. The split is the Run's speed: a live Run whose single resident spent four of eight rounds
legalising its own near-misses found its second lever only in round 7. So:

- **Markers are not your problem.** A point that lowers the ratio and comes back with up to four
  single-cell markers is a good result: the next round's repair engineer clears it. Push levers hard.
- **Spend no point on an ordered candidate.** When `nextLever.owner` is `repair`, it is on order;
  plan new moves from the best legal candidate. A repaired candidate becomes your base once the
  round decision names it best.
- **The last round is different.** When `state/round-decision.json` has `finalRound: true`, no
  round follows to repair what you leave: see section 4, step 4.

## 2. What you read

- `state/case-readiness.json`: the resolved Goal (each value with its source), the Strategy, the
  manifest's net roles, the deck digests, the unmodelled rules.
- `state/card.json`: the design-space card: coupling sites ranked by share of Ct, lever instances
  with gradient and bound, the binding pitch chain per axis, the floor.
- `state/model.json`: the capacitance model and its leave-one-out error per net pair.
- `state/round-decision.json`: the best legal candidate, the front, the trust radius, the last
  round's predicted vs measured gains, the open markers, the stop reason if any, `finalRound`, and
  the **lever ledger** (`ledger`): every kind of move judged so far (on a warm start, in earlier
  Runs of this case too), with the best ratio change it measured against the plain point of the
  same round and base, its anode and scan-line coupling changes, and how often it came back legal
  or a near-miss. `ledger WORKSPACE` prints it one lever per line.
- `state/history.jsonl`: every judged candidate (round, plan, operators, measured values).

Read the history before you plan. Never repeat a hypothesis an earlier round closed.

## 3. Commands you may run

| Command | What it does |
|---|---|
| `card WORKSPACE` | Prints the card in a compact form. |
| `history WORKSPACE [--last N]` | Prints the judged candidates, newest last. |
| `ledger WORKSPACE` | Prints the lever ledger of the last round decision, best measured lever first. |
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
   **Then read the ledger.** A lever with a measured gain (negative `bestDRatioPctVsPlain`) that
   the best legal candidate does not carry yet is the next thing to stack on it. A lever measured
   at about zero twice (inside `convergeBandPct`) is closed: do not try it again. Levers that
   measured gains separately compose: stack them in one point instead of one per round.
2. **Write the hypothesis** at the top of `plan/round-NN/plan.json` before anything else: what you
   expect to move and why (for example: "narrowing the storage-node link under the anode lowers
   storage-node-to-anode coupling with no scan-line load").
3. **Choose the base**: `original`, `best`, or a candidate id from history (for a repair). Section 7
   says which, round by round, and holds plans to copy.
4. **Choose front points** (1–6). Each is one solve. In the final round (`finalRound: true`),
   put at least half of them on moves the ledger shows judged legal before, and one `legalise`
   point on the best near-miss with the edits `markers` verified: nothing after this round repairs.
   Otherwise:
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
`shield {net, layer, over: {victim, aggressor}, marginUm, bridgeWidthUm}`, `cst-stretch {dyUm, cutAt}`,
`opening-shift {dxUm, dyUm}`, `band-trim {net, layer, widthUm}`,
`contact-move {net, toward, stepUm}` (only with `topologyMoves: allowed`). A `cst-stretch` is a
declared schematic change and needs `cst_ceiling_ff` above 0.

A `shield` plate covers the victim/aggressor overlap grown by `marginUm` (negative shrinks it, so a
smaller plate costs less load). It keeps the layer's spacing from every other net and contact, and is
tied to its own net's nearest shape on that layer by a short strip; a plate that cannot be tied
(more than 1.5 µm away) or that would surround another net's shape is refused. A floating plate is
never a result: the `no-new-floating-net` rule fails it.

**Operators per front point.** A front point may carry its own `operators`, applied after the plan's
on its own copy of the base. Use this to try several discrete changes in one round, for example a
shield-size sweep:

```json
"frontPoints": [
  {"name": "ratio", "objective": "min-ratio"},
  {"name": "shield-s", "objective": "min-ratio", "operators": [{"op": "shield", "net": "<supply>", "layer": "<middle layer>", "over": {"victim": "<storage node>", "aggressor": "<scan line>"}, "marginUm": -0.5}]},
  {"name": "shield-m", "objective": "min-ratio", "operators": [{"op": "shield", "net": "<supply>", "layer": "<middle layer>", "over": {"victim": "<storage node>", "aggressor": "<scan line>"}, "marginUm": 0.3}]},
  {"name": "shield-l", "objective": "min-ratio", "operators": [{"op": "shield", "net": "<supply>", "layer": "<middle layer>", "over": {"victim": "<storage node>", "aggressor": "<scan line>"}, "marginUm": 1.3}]}
]
```

A point whose own operator is refused fails alone (`operator-refused`); the others are still judged.

**Secondary couplings.** The judged ratio is the main goal. The storage node's coupling to the
anode (`pixel_ct_anode_ff`) and to the scan line (`pixel_ct_lines_ff`) are secondary objectives:
when two legal candidates' ratios are within `convergeBandPct`, the one with the lower sum is the
best. A shield between the storage node and the scan line cuts the scan-line coupling but can push
the storage node's shapes toward the anode; watch the anode coupling in the next round and aim a
point at it (move the storage node's link away from under the anode, or shift the opening).

**Fixed-outline fast path (cold start).** Two levers carry most of the gain on a pixel of this
kind, and a live Run found them six rounds apart. The lever ledger of that Run, from receipts:
a supply plate on the middle gate layer between the storage node and the scan line cut the ratio
by 1.8 points against the plain point (scan-line coupling by 1.4 fF); slimming the storage node's
source/drain strip cut it by a further 0.4 point, with the anode coupling. Opening shifts measured
nothing. Take both in round 1:

1. **Round 1, from the original, six points:** `legalise`; a plain `min-ratio` (the ledger's
   control); `min-ratio` with the plate at `marginUm` 1.0; and three `min-ratio` points stacking the
   plate (`marginUm` 1.0 and 1.5) with a `band-trim` of the storage node on its SD layer at about
   **60 % and 50 % of its present width** (never under the layer's minimum width plus 0.25 µm).
   Trim boldly: `band-trim` keeps every contact's enclosure by itself, so the strip between the
   contacts is free down to the width rule, and on a real case the gains came at about half the
   original width; a trim of 0.5 µm at a time needs eight rounds to get there. Spend no point on a
   middle-gate plate between the storage node and the anode: it was refused on a real case. The
   plate also adds the opaque coverage that brings transmittance under the window's maximum.
   Expect near-misses: the repair engineer takes them in round 2.
2. **Round 2:** if a legal candidate exists, stack from it: a sweep of three strip widths around the
   best one measured (0.1 to 0.2 µm apart, the narrowest at the floor) with the plate, and a plain
   `min-ratio`. If none is legal yet, base the points on the best ordered near-miss (they inherit
   its markers, which the repair engineer's edits on the same shapes clear) and add one `legalise`
   point on it as a hedge.
3. **Round 3 on, from the best legal candidate:** a `min-ratio` point always (the coupling limits
   hold the secondary targets); the strip swept in 0.05 to 0.1 µm steps around its best width
   down to its floor; when the anode coupling misses its target, a supply plate on the SD layer
   between the storage node and the anode only where the slimmed strip left room at the layer's
   spacing, and a bounded edit that shrinks the storage node's via in place to the deck's minimum
   enclosure (DRC and LVS judge it). When transmittance sits just above the window, a small
   bounded `add` on the anode layer at the cell edge, far from the storage node.
4. **Sweep in one round, never across rounds:** three plate sizes or three strip widths are three
   per-point operator sets in one plan; the ledger then shows the trade-off at once.

**Fixed outline (`outlineMode: fixed`).** The cell keeps its size: every point is `legalise` or
`min-ratio` at the Goal outline (plan-check refuses `min-pitch` and other outlines). With the
outline fixed, the round's diversity comes from bases and per-point operators, so spend the six
points on different discrete changes, not on outlines. Transmittance above the window's maximum is
fixed by more opaque coverage (a shield plate tied to a supply net, which lowers the ratio too),
never by shrinking.

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
   not count until they are repaired. The one exception is the fast path's round 2 with no legal
   candidate yet: base on the best near-miss the repair engineer has on order.
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
6. **Past the bound: `throughChain`.** When the width stalls at the card's x bound and the binding
   chain is Euclidean (`eu:` rows between 45-degree chamfers of one layer), ask a `min-pitch` point
   with `"throughChain": true` at the Goal width, or a step above it, from the best legal candidate.
   The solve relaxes only those chamfer distances, compacts as far as the target needs and hands
   the few markers left at the chamfers to the verified repairs, the way a designer reshapes them.
   Keep a plain `min-pitch` point at the bound beside it, so a legal width is never lost. A
   `throughChain` candidate's markers are the next round's repair lever.

### Plans to copy

Fill each `<...>` from the card, the Goal or the round decision; `plan-check` refuses a plan that
still holds one.

Fixed outline, round 1 (from the original; the fast path above):

```json
{"schema": "pixel.plan/1", "round": 1, "base": "original", "operators": [],
 "hypothesis": "a supply plate between the storage node and the scan line and a slimmer storage-node strip lower the ratio together, and the plate brings transmittance into the window",
 "frontPoints": [
  {"name": "legal", "objective": "legalise"},
  {"name": "ratio", "objective": "min-ratio"},
  {"name": "shield-10", "objective": "min-ratio", "operators": [<plate, marginUm 1.0>]},
  {"name": "shield-10-trim-a", "objective": "min-ratio", "operators": [<plate, marginUm 1.0>, <band-trim storage node SD, 0.6 x present>]},
  {"name": "shield-15-trim-a", "objective": "min-ratio", "operators": [<plate, marginUm 1.5>, <band-trim storage node SD, 0.6 x present>]},
  {"name": "shield-10-trim-b", "objective": "min-ratio", "operators": [<plate, marginUm 1.0>, <band-trim storage node SD, 0.5 x present>]}],
 "pairConstraints": [], "edits": [], "expect": "ratio well under the original; near-misses for the repair engineer"}
```

where `<plate, marginUm M>` is `{"op": "shield", "net": "<supply net>", "layer": "<middle gate
layer>", "over": {"victim": "<storage node>", "aggressor": "<scan line>"}, "marginUm": M}` and the
band-trim is `{"op": "band-trim", "net": "<storage node>", "layer": "<its SD layer>", "widthUm":
<width>}`.

Target outline, round 1 (from the original):

```json
{"schema": "pixel.plan/1", "round": 1, "base": "original", "operators": [],
 "hypothesis": "make the original legal on the authority deck, and learn how far the outline goes",
 "frontPoints": [{"name": "legal", "objective": "legalise"},
                 {"name": "target", "objective": "min-pitch", "outlineUm": [<goal w>, <goal h>]}],
 "pairConstraints": [], "edits": [], "expect": "a clean candidate at the original size"}
```

Target outline, round 2 (from the clean candidate):

```json
{"schema": "pixel.plan/1", "round": 2, "base": "best", "operators": [],
 "hypothesis": "shrink the free axis and cut the ratio at that outline; push the other axis to its bound",
 "frontPoints": [{"name": "ratio", "objective": "min-ratio", "outlineUm": [<current w>, <goal h>]},
                 {"name": "width", "objective": "min-pitch", "outlineUm": [<card x bound>, <goal h>]}],
 "pairConstraints": [], "edits": [], "expect": "legal at the goal height; ratio below the original"}
```

Target outline, round 3 (from the narrower legal candidate, transmittance at the window's minimum):

```json
{"schema": "pixel.plan/1", "round": 3, "base": "best",
 "operators": [{"op": "band-trim", "net": "<supply net of the widest opaque band>", "layer": "<its layer>", "widthUm": <present width - 0.5>}],
 "hypothesis": "a slimmer supply band lifts transmittance into the window at no device cost",
 "frontPoints": [{"name": "ratio", "objective": "min-ratio", "outlineUm": [<reached w>, <reached h>]}],
 "pairConstraints": [], "edits": [], "expect": "transmittance inside the window; ratio no worse"}
```

Target outline, round 4 (width held at the card's x bound by an `eu:` chain):

```json
{"schema": "pixel.plan/1", "round": 4, "base": "best", "operators": [],
 "hypothesis": "the x bound is a chain of chamfer distances; compacting through it and reshaping the chamfers it leaves narrows the cell",
 "frontPoints": [{"name": "through", "objective": "min-pitch", "outlineUm": [<goal w>, <reached h>], "throughChain": true},
                 {"name": "through-step", "objective": "min-pitch", "outlineUm": [<goal w + 0.2>, <reached h>], "throughChain": true},
                 {"name": "bound", "objective": "min-pitch", "outlineUm": [<card x bound>, <reached h>]}],
 "pairConstraints": [], "edits": [], "expect": "narrower than the bound with a few chamfer markers the repairs close; the bound point stays legal"}
```

### Reading what came back

0. **One fix away beats starting over.** A candidate that passes LVS, channels, capacitor, loads
   and couplings and misses only the transmittance window or a few DRC markers is worth more than
   a new point from the old legal base. Its markers are the repair engineer's (it is on order); a
   transmittance miss is yours: trim it (minimum) or add opaque coverage (maximum) next round. The round decision names it as
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
   put any point that needs more in as `exploratory`. When the Goal's allowance is wide (the person
   accepted scan-line load for coupling), size the shield: the smallest plate that meets the ratio
   target is the better delivery, and a sweep of three sizes in one round shows the trade-off.
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
