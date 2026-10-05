# How the customer happy-path demos were prepared

This guide records how the ATCS Fix Timing and QuaLib Insight demos were prepared on
`customer-demo` (2026-10-03/04, App `0.3.0-trial.35`–`.37`). It is written so the same demo can be
prepared again after the HimaFabric DBOS migration. Section 9 lists what changes after the migration.

Results, recordings and fix commits are in [README.md](README.md). The third demo, custom-cell Fmax
on SKY130, has its own spec at
[`docs/superpowers/specs/2026-10-04-custom-cell-fmax-sky130-demo-design.md`](../../superpowers/specs/2026-10-04-custom-cell-fmax-sky130-demo-design.md).

## 1. What "happy path" meant

- **One clean run of the real product on real tools.**
  - ATCS ran one OpenCode resident round with the playbook on real XTop.
  - QuaLib Insight ran a real offline analysis of prepared LibInsight data.
  - No mocked App, and no edited or staged results.
- **No comparison inside the product.** ATCS fixes the timing. The comparison with a scripted AutoFix
  run stays outside the App.
- **The result is what the Pack Reader measured.** Every number in the recording comes from a Reader
  or a raw report, never from model prose.
- **Honest endings.** The ATCS Run ended `ended-goal-not-met` because 12 small setup violations
  remained. Shown as it is, it is still a strong timing result.
- **Small and demo-only.** Only wiring and small fixes that the demo path actually hits go on the
  demo branch. Each one is recorded in the README fix table as "demo-only" or "port to migration".
- **Two languages.** Every key screen exists in English and in Chinese.

## 2. Timeline used last time

| Step | Time | Notes |
| --- | --- | --- |
| Agree scope with the user | 30 min | Questions in §3 |
| Cut branch, add README and feedback template | 15 min | |
| Reproduce and fix the blocking defect (r7 handoff) | ~3 h | RED test, implementation subagent, Opus review, Site install |
| zh/en UI | ~2 h | Through the shell locale runtime |
| LibInsight demo Pack + Site + QuaLib Insight tab | ~5 h | Including two review rounds |
| Build, package, kit, Home | 30 min per kit | Repeated for trial.35, .36, .37 |
| ATCS live run | ~56 min | Run `run-d8122285` |
| LibInsight / QuaLib runs | ~21–30 min each | TSMC28 kit; N12 kit about 4 min |
| Recording segments + screenshots | ~2 h | 6 segments, about 22 min of raw video |
| README, results, push | 30 min | |

Do the slow live run first and record the rest around it. The results segment can be recorded on a
Run that already finished.

## 3. Step 0: agree the scope (ask, don't assume)

Ask these as separate multiple-choice questions and write each answer into the README:

1. **Which Pack, version and Site.** Last time: ATCS 0.3.3 on `linglong-atcs28` (real XTop), and
   the LibInsight offline demo Pack on a local Site.
2. **What the agent may do and how many rounds.** Last time: one resident round. The agent's fix was
   already known to be legitimate.
3. **Evidence label for prepared data.** Last time: "Native-qualified". The LibInsight data had been
   extracted earlier with the vendor API outside HimaHarness.
4. **Data egress to the model.** Last time: "Allow full", so the Guide could read cell names and values.
5. **Figures.** Last time: Hima screens plus screenshots of the lib_insight prototype.
6. **Library kit.** Last time: TSMC28 live.
7. **Where a feature lives in the UI.** The user rejected "LibInsight as a Campaign" and asked for
   the existing Data Insight tab, renamed to QuaLib Insight. Show the user the UI path before
   building it.

Standing constraints, which also apply after the migration:

- Read-only: `/Users/lluzi/code/hima_harness_reforge_claude`, `/Users/lluzi/code/himaharness`,
  `/Users/lluzi/code/lib_insight`.
- Never touch the QuaLib API or the QuaLib licence: no `extract/`, `tmlib`, `edarun`,
  `EMPYREAN_LICENSE_FILE`, `batch convert` or `calibrate`.
- XTop and the QuaLib API run serially, one at a time.
- Never kill a remote process.
- GUI only on the Catsights display, and only one HimaHarness instance at a time.
- Commit, then push immediately and verify the remote SHA (AGENTS.md).

## 4. Step 1: branch and bookkeeping

1. Cut the demo branch from the branch you will show. Last time: `customer-demo` from `main` at
   `9c3a39c1`, as a worktree under `.hima-tmp/worktrees/customer-demo`.
2. Add `docs/product-demo/customer-demo/README.md` with purpose, the "what may land here" rule, the
   fix table, build/launch notes, the storyline, results and known limits.
3. Add `feedback/TEMPLATE.md` to log customer observations during the demo.
4. Every fix gets a row in the fix table, with its commit and with "demo-only" or "port to migration".

## 5. Step 2: remove the blocker at the lowest seam first

Use the tester skill `himaharness-human-like-tester-and-bug-fixer`. It keeps a cycle folder
`.hima-tmp/hltbf/<cycle>/` with `STATUS.md`, `CONTROL.md` and `events.jsonl`, plus `loop.py` and
`watch.py`. Follow `docs/agents/fast-convergence-testing.md`: a minute-level test catches nearly
everything before an hour-long GUI run.

What happened last time (the r7 stall), as a pattern to repeat:

1. **Read the retained failure.** The resident delivery was refused before writing, the owner saw
   "uncertain", and the native agent's reply was lost.
2. **RED tests built from the retained failure:**
   - Host test `test/contract/resident-engineering.host.test.ts`: `artifactPrefix` is in the
     envelope; a pre-write refusal is `rejected`/`done`; `state.detail.reply.text` reaches status.
   - Wrapper tests in `sites/linglong-atcs28/test_resident_engineering_wrapper.py`.
3. **Implementation** by a subagent (Sonnet tier), then **review** by a fresh Opus subagent on the
   narrow diff. Fix every Critical or Important finding. Last time one was found: a malformed ACP
   notification killed the reader thread.
4. **Install on the Site beside the old version, never over it.**
   - The wrapper went into `/data/eda/project/hima_harness/operator-admin/resident-engineering-v2/`
     with v1 kept.
   - The capability JSON points at v2.
   - The Site `engineeringCapabilities` binding points at v2.
5. **Update the Permit too.** The first live start was refused (#26) because the v2 wrapper was not
   in `allowedWrappers`. The Permit hash is part of `siteDigest`. After a Permit change, cancel the
   affected Run through the owner chat and start a fresh Campaign.

Test commands (Node 24):

```bash
export PATH="/Users/lluzi/.local/node24/bin:$PATH"
pnpm run test:local --files test/contract/resident-engineering.host.test.ts
pnpm run check:boundary
python3 sites/linglong-atcs28/test_resident_engineering_wrapper.py
```

The wrapper test `restart_marks_accepted…` is flaky about 1 time in 10: the test kills the wrapper
right after accept. This is a test race, not a product defect.

## 6. Step 3: Pack and Site preparation

Facts learned the hard way when adding a demo Pack (`packs/libinsight-offline-demo/`):

- **Where files live.**
  - Tool scripts named in `tools[].file` live under `flow/`, and
    `workspace: {source: pack, copy: [...]}` lists them relative to `flow/`. Otherwise you get
    "does not hold the declared flow entry".
  - Reader scripts stay under `tools/`.
- **Reinstalling.**
  - The same Pack id and version cannot be installed twice ("export destination already exists").
    Bump the version for every reinstall.
  - Upgrading a release that has already been tested needs the UI flow. Move the old install into
    the kit `backup/` folder before reinstalling.
- **A Site with a local placeholder.** The local Site uses a `__DSH_HOME__` placeholder, and its
  installed copy needs a distinct Permit name (`permit: ./libinsight-local.permit.yml`). Two Sites in
  one Home cannot both use `permit.yml`.
- **Reader output kind.** A Reader that feeds a UI view must emit the `reportKind` that view
  expects. QuaLib Insight opens observations whose `reader.reportKind` is
  `hima-library-insight-report/1` (v1, ≤ 2 MiB).
- **Contract tests.** Add one for every demo Pack and register it in `test/contract-groups.json`.
  For example, `test/contract/libinsight-offline-demo.test.ts` asserts that the workspace copy
  entries exist under `flow/`.

**Known bug to fix in the next round.** The LibInsight demo `report.py` gives every finding the same
SHA-256 (a shared bundle hash). Use a hash per file.

## 7. Step 4: build, package and kit

### 7.1 Build

```bash
cd .hima-tmp/worktrees/customer-demo
export PATH="/Users/lluzi/.local/node24/bin:$PATH"
export CI=true
pnpm install --frozen-lockfile --store-dir "$PWD/../../pnpm-store"
pnpm run build
```

`CI=true` avoids `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. The shared store lives at
`.hima-tmp/pnpm-store` in the main checkout.

### 7.2 Package

1. Bump `packages/desktop/package.json` to the next trial version (last: `0.3.0-trial.37`) and
   commit. The packager refuses a dirty tree, so check `git status --porcelain --untracked-files=no`
   is empty first.
2. Package into a new directory:

   ```bash
   node scripts/package-trial.mjs --output <new dir>
   ```

3. For a new App on an existing kit, keep the Home: move the old `HimaHarness.app` and its launcher
   into `backup/`, then copy in the new `HimaHarness.app`, `launch-hima-trial.command` and
   `trial-manifest.json`.

### 7.3 Kit layout

Last time the kit was `.hima-tmp/customer-demo-kit/`:

```
HimaHarness.app                launch-hima-trial.command   trial-manifest.json
Trial Data/dsh                 (the isolated Home)          Trial Workspace/
packs/                         (Pack copies installed through the UI)
backup/                        (previous App, previous Pack installs)
recordings/  screenshots/{en,zh,prototype}/  fresh-home.json
```

### 7.4 Fresh Home

1. Copy the Packs to show into `<kit>/packs/`. Remove `run-assets/` from the ATCS copy.
2. Prepare the Home:

```bash
node docs/product-demo/customer-demo/scripts/prepare-demo-home.mjs \
  <kit> sites/linglong-atcs28/site.yml sites/linglong-atcs28/permit.yml \
  "<a prior Home that already holds the DEEPSEEK credential>"
```

It refuses an existing Home. It installs the Site and Permit, copies the credential natively (never
printed, mode 600) and writes `fresh-home.json` with the hashes. Last time the prior Home was the
issue83 r7 candidate Home.

### 7.5 Launch

Check first that no other HimaHarness is running (`pgrep -fl HimaHarness.app`). If another
session's instance is running, ask; never kill it. Then launch:

```bash
env -u ELECTRON_RUN_AS_NODE -u DSH_HOME -u DSH_AGENTS_HOME -u HIMA_USER_DATA \
  nohup perl -MPOSIX -e 'setsid(); exec @ARGV' /bin/zsh <kit>/launch-hima-trial.command \
  > /dev/null 2>&1 &
```

The launcher removes download quarantine, verifies the ad-hoc signature, sets `HIMA_USER_DATA`,
`DSH_HOME`, `DSH_AGENTS_HOME`, `HIMA_WORKSPACE`, `HIMA_DRIVER_DISPLAY=Catsights` and
`DSH_TELEMETRY_DISABLED=1`, and logs to `Trial Data/launcher.log`. Do not open the `.app` from
Finder; Gatekeeper rejects it.

## 8. Step 5: drive the App, record, capture

### 8.1 Display and Computer Use

- **Catsights is ffmpeg device `Capture screen 2`** (1920×1200). In global AX coordinates the
  window lies at x −1920..0, y 134..1334. To confirm the index:

  ```bash
  ffmpeg -f avfoundation -list_devices true -i ""
  ```

  Then grab one frame from each screen.
- **Bring HimaHarness forward with `open_application`.** Another app in front (for example ChatGPT)
  blocks the display-scope tools.
- **React text fields ignore accessibility value writes.** Click the field and type with full
  control (`computer_batch`).
- **A prefilled field takes cmd+a before typing.** Otherwise the text is doubled; this is how the
  QuaLib folder path was typed twice.
- **Find the composer's y coordinate from a fresh screenshot,** not from memory.

### 8.2 The journey (same order as the recordings)

1. **Settings → Language** to pick English or 中文. It switches live.
2. **Settings → Site:** run Site discovery for the installed Site.
3. **Settings → Packs → install.** Fill the "Installed Pack" id field, otherwise Review stays
   disabled, then Review → Install.
4. **Guide:** ask in plain words for the bounded goal, for example "fix setup and hold timing on this
   design within one resident round". Check the proposal, then confirm it once.
5. **Brief the owner.** Post the prepared bounds message to the owner conversation immediately.
   Campaign notes do not reach the owner.
6. **Watch the Run** with the tester skill's `watch.py`:

   ```bash
   python3 ~/.claude/skills/himaharness-human-like-tester-and-bug-fixer/scripts/watch.py \
     --home "<kit>/Trial Data/dsh" --run <run-id> --max 540 --cycle-dir .hima-tmp/hltbf/<cycle>
   ```

   After every return, take one screenshot of the owner conversation and act on question cards and
   refusals. Last time the owner repaired two rejected deliveries by itself with same-task messages:
   a stale lock file, and an extra `commonSeedTreeDigest` in `inputIdentity`.
7. **QuaLib Insight:** in the tab, enter the library folder and the kit, then click Analyse. The Run
   starts in the background, and the report opens in the tab when the Run ends. Ask the Guide about
   one finding.

### 8.3 Recording

Start ffmpeg before launching the App or before each segment, and stop it with SIGINT so the MP4 is
finalised:

```bash
cd <kit>
nohup ffmpeg -hide_banner -loglevel error -y -f avfoundation -capture_cursor 1 -framerate 15 \
  -i "Capture screen 2" -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p \
  recordings/01-atcs-setup-en.mp4 > recordings/01.log 2>&1 &
echo $! > recordings/ffmpeg.pid
# … segment …
kill -INT "$(cat recordings/ffmpeg.pid)"
ffprobe -v error -show_entries format=duration -of csv=p=0 recordings/01-atcs-setup-en.mp4
```

Segments used last time:

| File | Content |
| --- | --- |
| `01-atcs-setup-en` | Settings, Site, Pack install |
| `02-atcs-start-en` | Guide proposal, confirmation, owner briefing, live graph starting |
| `03-atcs-results-en` | Finished Run: before/after, deliverables |
| `04-atcs-zh` | The same results in Chinese |
| `05-qualib-insight-zh` | Analysis started from the tab, report, filters |
| `06-qualib-insight-en` | Report in English; the Guide explains a finding |

Raw segments need trimming, and some include setup mistakes. Name every segment with a number,
the demo and the language.

### 8.4 Screenshots

- **App screenshots.** Copy the Computer Use screenshot files into `screenshots/<lang>/NN-what.jpg`
  straight after taking them.
- **Prototype screenshots** (lib_insight UI) with headless Chrome. Wrap each call in a 60 s alarm,
  because headless Chrome can hang:

  ```bash
  perl -e 'alarm 60; exec @ARGV' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --disable-gpu --user-data-dir=<tmp profile> --hide-scrollbars \
    --window-size=1600,1100 --virtual-time-budget=15000 --screenshot=<out.png> \
    "http://127.0.0.1:8766/#<page>"
  ```

  Serve the prototype with `python3 app/server.py --config <cfg> --port 8766` from lib_insight.
  Stop it afterwards and check that `git status` in lib_insight is clean.

### 8.5 Close

1. Stop ffmpeg (SIGINT), then quit the App normally. Choose "Quit and keep jobs" only when no Job
   exists.
2. Check that no HimaHarness main process of this kit remains.
3. Update the README with Run ids, the result tables taken from Reader facts, the recordings list
   and the known limits. Commit, push, and verify the remote SHA.

## 9. Redoing it after the DBOS migration

**Port first, then prepare.** These demo fixes have to exist on the migrated branch (README fix
table):

| Demo fix | Where it belongs after migration | Notes |
| --- | --- | --- |
| Resident handoff (`da9c859f`) | U4/U6 resident adapter | `artifactPrefix` in the envelope and prompt; a pre-write refusal is `rejected`; the native reply reaches status and owner |
| Resident wrapper v2 on linglong | Site config | Already installed beside v1; the Permit must list it |
| zh/en UI (`de3560b9`) | U7 faces | `useHimaT`, `labelKeyed`, zh/en dictionaries with the timing glossary (setup 建立时间, hold 保持时间) |
| QuaLib Insight tab | U7 | Replace the draft save/restore start with an explicit start route |
| LibInsight demo Pack | Demo-only | Fix the per-file provenance hash first |

**Then re-verify these behaviours.** The demo depends on them, and the migration changes how Runs
advance and recover:

1. A rejected resident delivery returns to the owner, and a same-task repair advances the flow
   without a person.
2. Autopilot covers the read → judge → finish chain.
3. A Run can be cancelled from its Run page. The stale waiting LibInsight Run `run-db7778fd` could
   not be stopped by the Guide.
4. The Permit/`siteDigest` change behaviour, and the refusal it shows.
5. The QuaLib progress line's elapsed time. It updated only on Run events; it should tick.
6. Resume after an App restart mid-Run. This is new with DBOS and worth showing.

**Strings still to finish in Chinese:** "Start another Campaign", "Files & code", "Pack & assets",
"1 rules", "ended — goal not met", and the QuaLib help sentence about "no Campaign wording".

**Lowest seam first again.** Run the contract tests, then the Site wrapper tests, then the
resident sandbox smoke on the Site, then one GUI round. Only after that, the recorded live run.

## 10. Checklist

- [ ] Scope questions answered and written in the README
- [ ] Demo branch cut; fix table and feedback template present
- [ ] Blocking defects fixed with a RED test, reviewed, installed beside the old version on the Site,
      and the Permit updated
- [ ] Contract tests and wrapper tests green
- [ ] Version bumped, tree clean, App packaged, kit and fresh Home prepared (`fresh-home.json`)
- [ ] No other HimaHarness running; window on Catsights; ffmpeg device confirmed
- [ ] Site discovered, Pack installed, language chosen
- [ ] Live run done with an honest ending; Run ids recorded
- [ ] Segments recorded in en and zh; screenshots in `screenshots/{en,zh}`
- [ ] App quit, ffmpeg stopped, no stray processes
- [ ] README results, recordings and limits updated; committed, pushed, remote SHA verified
