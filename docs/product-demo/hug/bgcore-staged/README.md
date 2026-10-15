# bgcore staged demo: a scripted conversation in the real App

A demo take that replays a reference conversation in the packaged HimaHarness App (`hug-rc2`, HUG-DBOS
`969cf62b`). The App, its chat rendering, its tools and the Project pane's station view are real.
Two things are scripted:

- **The Guide's model.** `stage.mjs` runs a local OpenAI-compatible stand-in for the DeepSeek API, and
  the kit sets `DEEPSEEK_BASE_URL` to it. Each model request gets the next scripted turn (reasoning,
  text and tool calls such as `read` and `todo_write`), streamed at a model's pace. A turn can be held
  until the director releases it.
- **The Project pane's data.** `stage.mjs` answers the renderer's `/hima/api/runs*` polls over CDP
  (`Fetch.fulfillRequest`), so `TeamCanvas` draws the scripted Run from `bgcore-frontend/view.yml`.

This is a staged recording, not a Run: no Site, no Job and no Ledger record exists. Say so wherever the
video is delivered.

## Files

- `bgcore-frontend/`: a display-only Pack whose six stations are the bgcore front-end flow.
  - Stations: IP package and spec, then Schematic and Testbenches (one row), then Simulation platform,
    the AI Sizing engineer and the Independent re-test.
  - The view has a back edge from re-test to sizing.
  - Top-line metrics: VBG @3.3 V, TC, PM and IQ, against the Goal.
  - Its tools are placeholders. It loads with the App's own `loadPack`.
- `loadpack.mjs`: writes `pack-loaded.json` (the parsed contract and graph that the pane needs).
- `stage.mjs <beats.mjs>`: the model stand-in, the pane feeder and a beat director, which types and
  clicks through the demo skill's `appcdp.mjs`. It starts when a `GO` file appears.
- `mkkit.mjs <name> [cdp]`: a fresh kit with no Site and no real model credential.

The beats (`turns`, `beats`, `run`) and `pane-states.json` hold the case's numbers. They stay in
`.hima-tmp/bgcore-rec/` and are not committed.

## Preview the panel without the App

```bash
node scripts/preview-team-view.mjs --pack-dir docs/product-demo/hug/bgcore-staged/bgcore-frontend --width 480 --out /tmp/bgcore.png
```
