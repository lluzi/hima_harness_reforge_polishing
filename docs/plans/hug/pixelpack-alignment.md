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

## Merging (one-way; do NOT merge HUG-DBOS into your branch)

Decided by the integrator on 2026-10-14: the merge is **one-way only**. HUG-DBOS is merged *into*
PixelPack's `HUG-DBOS` copy; PixelPack is not rebased onto, nor does it merge, HUG-DBOS.

- **Do not merge or rebase `HUG-DBOS` into `feat/pixel-layout-optimization`.** Your branch stays on
  `main`. You add only `view.yml` (and the display-only `contract.yml`/label fields below) to your own
  Pack, on your own branch. You never need the `packages/**` renderer in your checkout to ship this.
- **Validate and preview with the HUG-DBOS tool, pointed at your Pack folder.** The preview/validation
  uses the renderer and loader from the HUG-DBOS worktree (`--pack-dir` takes any checkout). See
  [Preview your view.yml](#preview-your-viewyml-before-you-push) just below.
- **When you're ready:** your stand-in dry route passes and the preview tool loads your Pack with no
  schema error. Then push and record the commit SHA in the Open-questions section at the end of this
  file. The integrator merges `feat/pixel-layout-optimization` into `HUG-DBOS` one-way, rebuilds there,
  and runs only PixelPack's dry route (plus the shared suite) on the HUG-DBOS side.
- The only file both sides touch is `test/contract-groups.json` (each adds entries); the integrator
  keeps both at merge time. You do not resolve HUG-DBOS conflicts in your branch.

## Preview your view.yml (before you push)

`scripts/preview-team-view.mjs` (in the HUG-DBOS worktree) builds your Pack's graph with the HUG-DBOS
loader, folds in a sample Run, bundles `TeamCanvas.tsx`, and screenshots it with headless Chrome at a
given CSS width. A schema error in `view.yml` is printed (that is your validation check); a clean load
produces the PNG. Customer data never enters it — the built-in samples are generic.

Run it from the HUG-DBOS worktree `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/worktrees/hug-dbos`
(after `pnpm run build` there once, so `lib/` exists), pointing `--pack-dir` at your Pack folder in your
own checkout:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/worktrees/hug-dbos
pnpm run build                 # once, so packages/harness/lib exists
node scripts/preview-team-view.mjs \
  --pack-dir /Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/pixel-layout-optimization/packs/pixel-layout-optimization \
  --width 480 \
  --out /tmp/pixelpack-view.png
```

Options: `--pack-dir <abs path to a Pack folder>` (any checkout) or `--pack <id>` (a Pack under the
HUG-DBOS worktree's `packs/`); `--width <px>` (default 480, the side-pane width — also try 800);
`--out <png>`; `--sample <json>` for a RunView-shaped sample (default: a generic one that marks the
stations before the first AI station done, that station working, the rest waiting). Sample files live in
`scripts/preview-team-view/`. If headless Chrome is missing the tool prints a skip reason and exits
non-zero rather than pretending success; set `HIMA_CHROME` or `CHROME_BIN` to its path.

Open the PNG and check: nothing clipped at 480px, compact row spacing, one back-edge lane, the live
line on the running station ellipsised or wrapped. Then push your branch and report the SHA below.

## Wiring the Pack to the HUG GUI (display only; nothing here changes how a Run executes)

1. **`view.yml`** beside `graph.yml`. This is the only view declaration; `graph.yml` refuses an inline
   `view:`. Model it on `packs/andes-cell-fmax/view.yml` (rows and a fork) or
   `packs/mage-scribe-placement/view.yml` (a team).
   - Stations: `id`, `label` (≤48), `about` (≤240), optional `row` (0..7, at most 2 stations per row).
   - Each station has **either** a `checklist` (`{label, nodes:[...], rounds?: first|all}`) **or** a
     `team` (`{node, label, role?}`).
   - `hidden: [nodeIds]` hides nodes. When `hidden` is present, every graph node must be placed or hidden.
   - **Declare `edges` explicitly** (recommended): `{from, to, label?, back?}` between station ids, one
     entry per hand-over plus one `back: true` return. Omitting `edges` derives them from every graph
     edge crossing a station, which draws a separate back edge for every return into an earlier station
     and a stray edge between two agents on the same row — the clutter the AndesCell view fixed on
     2026-10-14 by declaring its four hand-overs and one `new cells` return. Keep labels short (≤32).
   - `metrics` (at most 4). Each reads either:
     - a task output: `{label, node, path:[...], unit?, goal?, better?}`, or
     - a Reader value: `{label, reader, type, pick: best|latest, better, unit, digits, goal}`. The
       `reader` must be a contract reader that emits `type`, and `goal` names the Goal field holding the target.
   - Suggested shape for PixelPack: a setup station; the layout engineer as an AI station; the check
     agents (DRC / LVS / RCE / transmittance) as a **`team` station** (each check is its own task, and a
     team station draws them side by side with their own live lines — preferred over a checklist here);
     and a decision station. Give each row explicit `edges` as above. The headline metric is Ct/Ca,
     `better: lower`, against its Goal.
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
