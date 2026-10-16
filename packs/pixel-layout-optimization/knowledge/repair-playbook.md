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

**A case recipe comes first.** When `case-recipe.md` names this Run's case (`manifest.caseId` in
`state/case-readiness.json`), its repair section names the edits that cleared this cell's markers
before: try those first, adapted to the polygon indices `markers` reports.

## 2. What you read

- `state/repair-orders.json` (`pixel.repair-orders/1`): the candidates you may repair, the most
  promising first. Each fails only the authority deck, with `markers1x1` single-cell markers, and
  would rank above the best legal candidate once clean: it meets more of the Goal's targets, or has
  a lower ratio. Nothing else may be repaired: `repair-check` refuses a candidate the orders do not
  list.
- `state/round-decision.json`: the best legal candidate (what a repair must beat to matter), and
  the lever ledger, whose `bounded-edit repair` line shows what earlier repairs cost in ratio.
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
   edits from the recipes below and preview with `try-edit`. Fix all of a candidate's markers in
   one edit set (markers along one plate edge share their fix). Iterate until both the single cell
   and the 3x3 tile read zero, or until three previews in a row fail to improve; at most eight
   previews per candidate. Repair the first ordered candidate completely before you start the
   second: one clean repair is worth more than three half-done ones.
4. **Keep only what previewed clean** (or strictly fewer markers with none new). Leave a candidate out
   rather than guess; say why in the plan's `hypothesis`.
5. **Least ratio cost.** Among edit sets that preview clean, deliver the one that removes the least
   shielding plate or adds the least storage-node area; the ledger's `bounded-edit repair` line
   shows what earlier repairs cost.
6. **Check and deliver** `resident-delivery.json` naming `state/round/repair-plan.json` as the single
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
   inside): extend the upper edge outward until it encloses the lower edge by the full rule
   (+0.1 um), or cut it back over the marker's length until the lower edge sits outside it by more
   than the two layers' spacing (rule + 0.15 um). **When the upper shape is a supply plate (a
   shield), try the extension first:** a cut removes shielding and the ratio pays for it (on a real
   case a 1 um cut raised the ratio by a third of a point, from a candidate that met the Goal to
   one that missed it), while an extension keeps it or lowers the ratio. An extension that lands
   within the same layer's spacing of another polygon is not a dead end: pull that polygon's
   facing edge back in the same edit set (recipe 2). Cut only when no extension verifies, and say
   in `expect` what the cut costs.
2. **Stepped plate edge** (two adjacent enclosure markers along one plate edge at different
   heights): one cut or one extension per step fails because each step leaves the other. Square the
   whole edge with a single box across both steps, flush with the plate's side edges. A box that
   overhangs the plate's side by even 0.1 um makes a narrow jog: width and spacing markers.
   A squared or extended edge that comes too close to another polygon of the same layer (a new
   same-layer spacing marker at its corner) is fixed in the same edit set: move that polygon's facing edge
   back to the layer's spacing (an `edge` move of 0.5 to 1 um). On a real case this pair, a box
   squaring a supply plate's lower edge plus a 0.8 um pull-back of the neighbouring plate's top
   edge, cleared both enclosure markers, and the larger plate lowered the ratio slightly.
3. **Extension hits a neighbour**: when extending an edge brings it within the cross-layer spacing
   of another shape (a new spacing marker), cut back instead. The ratio cost is a strip of plate.
4. **Tile-only marker at the cell edge** (single cell clean, 2x2/3x3 not): a shape and the
   neighbouring cell's copy of another shape meet across the edge. Make the two edges flush (the
   same coordinate on both sides of the boundary) or pull one back to the spacing. Choose the side
   whose edit keeps the polygon whole; `try-edit` refuses a split or a hole. When the shape jogs
   inward just short of the boundary (a notch the neighbour's copy faces), move the jog's
   vertices out to the boundary coordinate (`vertices` with `dx`), not a box: a box that fills a
   notch is refused when it would close a hole, and the vertex move is what cleared this marker
   on a real case.
5. **A marker of a derived layer** (a rule written on a layer the deck builds from others): edit the
   drawn layer it comes from, never the derived name.

Not yet confirmed on a real case (preview before you trust it):

6. **A width sliver left by a slimmed strip** (a minimum-width marker on a strip the layout engineer
   band-trimmed): widen the sliver to the layer's minimum width plus 0.05 um with an `add` box on
   the side away from the storage node's aggressors, or, when it carries no contact, cut it away.

## 7. Prohibitions

- Never repair a candidate the orders do not list, add an operator, or choose another base.
- Never edit a channel (gate over poly) or the storage-capacitor region.
- Never state a measured value you did not read from a receipt; previews are not measurements.
- Never deliver an edit set you did not preview.
