# PixelPack → HUG-DBOS alignment

Written 2026-10-14 for the session building PixelPack (`packs/pixel-layout-optimization`, branch
`feat/pixel-layout-optimization`). Read this file rather than relying on chat history. The integrator is
the session that owns `HUG-DBOS`. Leave your questions for it in a section at the end of this file, on
your branch.

## What HUG-DBOS is

`HUG-DBOS` is the one DBOS-based branch every HUG demo is recorded from. It is `main` plus:

- ATCS 0.4.11, LibInsight 0.2, MAGE scribe placement with its team view, and AndesCell DTCO (mock EDA data);
- one station view format, `view.yml`;
- Results and Reports tabs and `hima_chart` cards;
- the visible word **"Project"** instead of "Campaign". Identifiers stay `Campaign`.

Plan: [2026-10-14-andes-port-plan.md](2026-10-14-andes-port-plan.md).

All HUG videos are recorded from one frozen, tagged App build of this branch. PixelPack must be merged
here before that build.

## Merging

- Your branch touches no `packages/**` file, so it merges cleanly. The only conflict is
  `test/contract-groups.json`, where both sides add entries; keep both.
- **When you're ready:** your stand-in dry route passes, and the Pack loads with `loadPack`. Then tell
  the user, or record the commit SHA here. The integrator merges `feat/pixel-layout-optimization` into
  `HUG-DBOS`, rebuilds, and runs your tests together with everyone else's.
- **Before merging, rebase or merge `origin/HUG-DBOS` into your branch.** That lets you test against the
  new Pack format below. Run `pnpm run build` before tests: contract tests import the built `lib/`.

## Wiring the Pack to the HUG GUI (display only; nothing here changes how a Run executes)

1. **`view.yml`** beside `graph.yml`. This is the only view declaration; `graph.yml` refuses an inline
   `view:`. Model it on `packs/andes-cell-fmax/view.yml` (rows and a fork) or
   `packs/mage-scribe-placement/view.yml` (a team).
   - Stations: `id`, `label` (≤48), `about` (≤240), optional `row` (0..7, at most 2 stations per row).
   - Each station has **either** a `checklist` (`{label, nodes:[...], rounds?: first|all}`) **or** a
     `team` (`{node, label, role?}`).
   - `hidden: [nodeIds]` hides nodes. When `hidden` is present, every graph node must be placed or hidden.
   - Omit `edges` to derive them from the graph, or declare `{from, to, label?, back?}` between station ids.
   - `metrics` (at most 4). Each reads either:
     - a task output: `{label, node, path:[...], unit?, goal?, better?}`, or
     - a Reader value: `{label, reader, type, pick: best|latest, better, unit, digits, goal}`. The
       `reader` must be a contract reader that emits `type`, and `goal` names the Goal field holding the target.
   - Suggested shape for PixelPack: a setup station; the layout engineer as an AI station; a check team
     (DRC / LVS / RCE / transmittance) as a `team` station if those run as separate tasks, else a
     checklist; and a decision station. The headline metric is Ct/Ca, `better: lower`, against its Goal.
2. **Node labels.** Graph nodes and autopilot segments may carry display `label` (≤48) and `about` (≤240).
   The header and the run cards show these labels in place of task ids.
3. **Results tab (optional).** Contract `results:` replaces the Generations section, giving a
   before/after table from Reader values (see `packs/andes-cell-fmax/contract.yml` `results:`).
4. **Reports tab (optional).** Contract `reports: { dir: reports }`. Tools write
   `<workspace>/reports/<node>/r<round>/<file>`, and the tab lists them grouped by round, then station,
   then node.
5. **Charts (optional).**
   - A Run chart is `<reports dir>/<node>/r<round>/<name>.chart.json`, schema `hima-chart/1` (kind `bar`
     or `metrics`, see `packages/harness/src/charts.ts`).
   - A Pack chart is `knowledge/charts/<name>.chart.json`.
   - The Campaign agent shows charts with the `hima_chart` tool. `hima_context` lists the newest
     round's chart paths.

## House rules for the HUG demos

- **Project wording.** Knowledge or prompts that tell the agent how to talk to the person say "Project".
- **Customer data stays out of the public repo.** Case numbers, the vendor demo's data and Site paths
  holding customer files go in Site files and git-ignored knowledge only. Grep the staged diff before
  every commit.
- **The Site's wrapper on Linglong.**
  - Live HUG-DBOS Runs need the current wrapper template,
    `sites/linglong-atcs28/templates/resident-engineering-wrapper.py` (sha256 prefix `02a46760`).
  - Deploy it into a Site-specific new folder under
    `/data/eda/project/hima_harness/operator-admin/`; don't overwrite a folder an older App uses.
  - Use `resident-engineering-ctu01-hug/` as the example.
- **Licences.** FPD licence mode excludes MAGE, so PixelPack live takes and MAGE takes need separate slots.

## Open questions from the PixelPack session

(none yet)
