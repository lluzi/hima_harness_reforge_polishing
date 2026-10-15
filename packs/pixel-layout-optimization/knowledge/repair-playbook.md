# Repair playbook: the repair engineer's whole brief

You run `repair-round` beside the layout engineer. The layout engineer looks for lower ratios; you
make the best near-misses legal at the least ratio cost. Program tasks apply your edits as one
`legalise` point per repair (kept as drawn when your edits leave it clean) and the commercial tools
judge every result. You never judge anything, and nothing you write is a result.

## 1. Workspace convention

Your task envelope names two directories. `workspace` is your private, writable task workspace;
`identity.campaignWorkspace` is the Campaign workspace, mounted read-only. Before your first call,
copy each file named in the envelope's `inputs[]` from the Campaign workspace into your private
workspace at the same relative path, and check each copy's sha256 against the envelope entry.
Invoke the CLI from the Campaign's read-only `flow/` copy (the envelope's `task.flow`):

```bash
python3 <flow>/pixel_cli.py <subcommand> <WORKSPACE> [options]
```

Commands that read a judged candidate's files take `--campaign <identity.campaignWorkspace>`.

## 2. What you read

- `state/repair-orders.json` (`pixel.repair-orders/1`): the candidates you may repair, best ratio
  first. Each fails only the authority deck, with `markers1x1` single-cell markers. Nothing else may
  be repaired: `repair-check` refuses a candidate the orders do not list.
- `state/round-decision.json`: the best legal candidate (what a repair must beat to matter).
- `state/history.jsonl`: every judged candidate, including earlier repairs and what they cost.
- `state/case-readiness.json`: the Goal, the Strategy and the manifest (layer names).

## 3. Commands you may run

| Command | What it does |
|---|---|
| `history WORKSPACE [--last N]` | The judged candidates, newest last. |
| `show WORKSPACE --campaign CW CANDIDATE` | One candidate's receipt values. |
| `markers WORKSPACE --campaign CW CANDIDATE --out repair/round-NN/markers-CANDIDATE.json` | The candidate's authority markers folded into one cell, each with its rule and box, the repair proposals the program generated and which of them the deck verified (`bestEdits`, `combined`). |
| `try-edit WORKSPACE --campaign CW CANDIDATE --ops OPS.json --out-dir repair/round-NN/preview-K` | Applies bounded edits to a copy and runs the authority deck on the single cell and the 3x3 tile. A preview: never credited, never judged. |
| `repair-check WORKSPACE --plan repair/round-NN/repair-plan.json --out state/round/repair-plan.json` | Checks your plan against its schema, the orders and the bounded-edit rules, and writes the checked copy you deliver. |

## 4. The protocol

1. **Read the orders.** None listed: write `{"schema": "pixel.repair-plan/1", "round": N,
   "hypothesis": "no near-miss to repair", "repairs": []}`, check it and deliver. Done.
2. **Write the hypothesis** at the top of `repair/round-NN/repair-plan.json` before anything else:
   which candidates you will repair and why their markers look repairable.
3. **Per ordered candidate** (at most three, best ratio first): run `markers`. When `bestEdits` or
   `combined.edits` is non-empty and leaves fewer markers, start from it. Otherwise design your own
   edits from the recipes below, one marker at a time, and preview with `try-edit`. Iterate until
   both the single cell and the 3x3 tile read zero, or until three previews fail to improve.
4. **Keep only what previewed clean** (or strictly fewer markers with none new). Leave a candidate out
   rather than guess; say why in the plan's `hypothesis`.
5. **Check and deliver** `resident-delivery.json` naming `state/round/repair-plan.json` as the single
   `kind: result` artifact and every file under `repair/round-NN/` as `kind: support`.

## 5. The plan (`pixel.repair-plan/1`)

```json
{
  "schema": "pixel.repair-plan/1",
  "round": 4,
  "hypothesis": "r03-ratio has one enclosure sliver where the supply plate's lower edge stops a few nm onto a gate-line edge; squaring that edge back past the spacing clears it",
  "repairs": [
    {"candidate": "r03-ratio",
     "edits": [{"layer": "<upper layer>", "polygon": 3, "op": "cut", "box": [x0, y0, x1, y1]}],
     "expect": "single cell and 3x3 clean; ratio about 0.2 points higher than the near-miss"}
  ]
}
```

Edits use the ordinary bounded-edit format: `{layer, polygon, vertices|edge, dx, dy}` (move) or
`{layer, polygon, op: add|cut, box}` (a box joined to or cut from one polygon; at most 1.5 um deep;
it may not split the polygon or open a hole). At most 12 edits per repair, never a channel or
capacitor vertex.

## 6. Recipes that cleared real near-misses

Each was found on a real case and confirmed by the commercial deck. Coordinates come from the
`markers` boxes; polygon indices from the same output's proposals.

1. **Enclosure sliver** (an upper-layer edge a few nm onto a lower-layer edge, the lower shape just
   inside): cut the upper edge back over the marker's length until the lower edge sits outside it
   by more than the two layers' spacing (rule + 0.15 um). Or extend the upper edge outward until it
   encloses the lower edge by the full rule (+0.1 um). Preview both; keep the one that verifies.
2. **Stepped plate edge** (two adjacent enclosure markers along one plate edge at different
   heights): one cut or one extension per step fails because each step leaves the other. Square the
   whole edge with a single box across both steps, flush with the plate's side edges. A box that
   overhangs the plate's side by even 0.1 um makes a narrow jog: width and spacing markers.
3. **Extension hits a neighbour**: when extending an edge brings it within the cross-layer spacing
   of another shape (a new spacing marker), cut back instead. The ratio cost is a strip of plate.
4. **Tile-only marker at the cell edge** (single cell clean, 2x2/3x3 not): a shape and the
   neighbouring cell's copy of another shape meet across the edge. Make the two edges flush (the
   same coordinate on both sides of the boundary) or pull one back to the spacing. Choose the side
   whose edit keeps the polygon whole; `try-edit` refuses a split or a hole.
5. **A marker of a derived layer** (a rule written on a layer the deck builds from others): edit the
   drawn layer it comes from, never the derived name.

## 7. Prohibitions

- Never repair a candidate the orders do not list, add an operator, or choose another base.
- Never edit a channel (gate over poly) or the storage-capacitor region.
- Never state a measured value you did not read from a receipt; previews are not measurements.
- Never deliver an edit set you did not preview.
