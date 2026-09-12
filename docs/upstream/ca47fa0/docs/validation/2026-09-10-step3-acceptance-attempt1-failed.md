# Step-3 acceptance run, 2026-09-10

One multi-generation Campaign of the `opene902-timing-probe` pack on site `linglong` (luzi@192.168.50.41). HimaHarness 0.1.0 on DeepSeek Harness 0.1.5-alpha.1 (Node v24.20.0). Commit `01653b776d433e85bc86506edce9090811427cac`.

Started from the window through the driver (D42, ADR-0004): the desktop shell's own Electron main process, started with `--driver` on an isolated home, which launched the real dsh host and exchanged its token in its own window's session. The Campaign was started by filling the workbench page's own start form and clicking `start`, watched on the card the window renders, and read over the routes with the session the shell established — `GET /hima/api/runs/<id>`, `/records` and `/experience` — then over a second shell booted on the same home.

## What was asked for

- The site's own last result: `/data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt`, read read-only, states **2.27 ns**.
- The target the Goal was set to, and the first Strategy's period: **2.07 ns** — the site's last result (2.27 ns) minus 0.2 ns.
- The Budget: a time box of 30 minutes for the whole Campaign, a retry allowance of 3 per node per generation, and at most 6 generations — the pack's own `converge.generationLimit`. The site declares 1 parallel job(s).
- The pack's convergence rule: `period` moving by less than 0.05 over 1 successive generation, and its guard band is 0.05 ns.

The window's own start form, filled control by control:

```
start-pack = opene902-timing-probe
start-site = linglong
start-target = 2.07
start-period = 2.07
start-time-box = 30
start-retries = 3
start-generations = 6
click start
```

## What ran

Run `run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9` of campaign `opene902-timing-probe-20260910-221158-96d7`, status **ended-budget-exhausted**, at node `next-period`, in generation 6. Goal {"target_period_ns":2.07}, strategy {"periodNs":2.48}, budget {"timeBoxMs":1800000,"retryAllowance":3,"jobCap":1,"licences":{"Design-Compiler":99,"Library-Compiler":99,"PrimeTime":99,"Innovus_Impl_System":0},"generationLimit":6}, meters {"elapsedMs":917948,"jobsLaunched":6,"attempts":24,"licenceMs":{"Design-Compiler":914018},"generationMs":[167526,161280,155211,146034,140047,146061],"endedBy":"generation-limit"}.

- Nodes: `synthesize` (act) done, attempt 1; `read-qor` (act) done, attempt 1; `judge` (judge) done, attempt 1; `next-period` (explore) done, attempt 1
- Jobs: launched in `hima-a4249f9b-synthesize-10d0eb`; finished exit 0 in `hima-a4249f9b-synthesize-10d0eb`; launched in `hima-a4249f9b-synthesize-fc2f83`; finished exit 0 in `hima-a4249f9b-synthesize-fc2f83`; launched in `hima-a4249f9b-synthesize-54acc7`; finished exit 0 in `hima-a4249f9b-synthesize-54acc7`; launched in `hima-a4249f9b-synthesize-ce152f`; finished exit 0 in `hima-a4249f9b-synthesize-ce152f`; launched in `hima-a4249f9b-synthesize-4e83f5`; finished exit 0 in `hima-a4249f9b-synthesize-4e83f5`; launched in `hima-a4249f9b-synthesize-a5c976`; finished exit 0 in `hima-a4249f9b-synthesize-a5c976`
- Blockers: none
- Cancels: none

### While it ran, as the window showed it

```
2026-09-10T22:12:30.662Z running — running
2026-09-10T22:13:00.839Z running — running
2026-09-10T22:13:31.009Z running — running
2026-09-10T22:14:01.209Z running — running
2026-09-10T22:14:31.370Z running — running
2026-09-10T22:15:01.525Z running — running
2026-09-10T22:15:31.707Z running — running
2026-09-10T22:16:01.896Z running — running
2026-09-10T22:16:32.058Z running — running
2026-09-10T22:17:02.241Z running — running
2026-09-10T22:17:32.426Z running — running
2026-09-10T22:18:02.597Z running — running
2026-09-10T22:18:32.788Z running — running
2026-09-10T22:19:02.957Z running — running
2026-09-10T22:19:33.151Z running — running
2026-09-10T22:20:03.330Z running — running
2026-09-10T22:20:33.503Z running — running
2026-09-10T22:21:03.689Z running — running
2026-09-10T22:21:33.868Z running — running
2026-09-10T22:22:04.037Z running — running
2026-09-10T22:22:34.193Z running — running
2026-09-10T22:23:04.370Z running — running
2026-09-10T22:23:34.524Z running — running
2026-09-10T22:24:04.698Z running — running
2026-09-10T22:24:34.869Z running — running
2026-09-10T22:25:05.049Z running — running
2026-09-10T22:25:35.220Z running — running
2026-09-10T22:26:05.413Z running — running
2026-09-10T22:26:35.589Z running — running
2026-09-10T22:27:05.765Z running — running
```

## The generations

| generation | period (asked → observed) | slack | verdicts | decision | wall time |
| --- | --- | --- | --- | --- | --- |
| 1 | 2.07 → 2.07 | -0.16 | FAIL setup-wns-all-nonnegative, PASS clock-period-at-most | next strategy: periodNs 2.28 | 167.5 s |
| 2 | 2.28 → 2.28 | 0 | PASS setup-wns-all-nonnegative, FAIL clock-period-at-most | next strategy: periodNs 2.33 | 161.3 s |
| 3 | 2.33 → 2.33 | 0 | PASS setup-wns-all-nonnegative, FAIL clock-period-at-most | next strategy: periodNs 2.38 | 155.2 s |
| 4 | 2.38 → 2.38 | 0 | PASS setup-wns-all-nonnegative, FAIL clock-period-at-most | next strategy: periodNs 2.43 | 146.0 s |
| 5 | 2.43 → 2.43 | 0 | PASS setup-wns-all-nonnegative, FAIL clock-period-at-most | next strategy: periodNs 2.48 | 140.0 s |
| 6 | 2.48 → 2.48 | 0 | PASS setup-wns-all-nonnegative, FAIL clock-period-at-most | next strategy: periodNs 2.53 | 146.1 s |

- The chooser's and the pack's own clauses for generation 1: period + |slack| + guard = 2.07 + 0.16 + 0.05 → {"strategy":{"periodNs":2.28}}
- The chooser's and the pack's own clauses for generation 2: period − slack + guard = 2.28 − 0 + 0.05 → {"strategy":{"periodNs":2.33}}
- The chooser's and the pack's own clauses for generation 3: period − slack + guard = 2.33 − 0 + 0.05 → {"strategy":{"periodNs":2.38}}
- The chooser's and the pack's own clauses for generation 4: period − slack + guard = 2.38 − 0 + 0.05 → {"strategy":{"periodNs":2.43}}
- The chooser's and the pack's own clauses for generation 5: period − slack + guard = 2.43 − 0 + 0.05 → {"strategy":{"periodNs":2.48}}
- The chooser's and the pack's own clauses for generation 6: period − slack + guard = 2.48 − 0 + 0.05 → {"strategy":{"periodNs":2.53}}

## The report

- Markdown: `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md`, sha256 `45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2` (3683 bytes)
- JSON: `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json`, sha256 `e00751a8bdbaae0989bcd224e93f4f07210b981209beed6c4a41c1004056450f` (4595 bytes), schema `hima-experience/1`
- Written at 2026-09-10T22:27:16.400Z, and re-served unchanged after the restart.
- Its first heading: **Campaign opene902-timing-probe-20260910-221158-96d7**
- Read back off the site through HimaChannel's `cat`: markdown 45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2, json e00751a8bdbaae0989bcd224e93f4f07210b981209beed6c4a41c1004056450f — both what the ledger states

## The window

The ended card, photographed through the same window the Campaign was started from: [`2026-09-10-step3-acceptance-attempt1-failed-card.png`](2026-09-10-step3-acceptance-attempt1-failed-card.png) — 2400×1670, 392765 bytes.

The card's own `run-experience` section carries the report, marked with the Markdown file's sha256 `45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2` and the instant both files state as their own, 2026-09-10T22:27:16.400Z.

## The campaign workspace, left on the site

- Workspace: `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7`
- Container: `hima-opene902-timing-probe-20260910-221158-96d7`
- Report: `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md` and `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json`

Left in place as evidence, the report beside the results. Nothing in this harness removes a path on a Site; removing this workspace, the container of that name and the report inside it is the site owner's call.

The isolated harness home this run used, holding the ledger every record here was read from, is `/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-J2CHzm`. It is left in place for the same reason.

## Checks

Every one of these is stated from what was observed. Nothing here is assumed, and a check that could not be evaluated is a failure.

### PASS — last-result-read

The site's own last result was read, read-only, before anything else was done to the site.

*Predicate:* `POST /hima/api/observe` with `{ site: linglong, path: /data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt, reader: dc-qor-report }`, over the routes with the session the shell established, answers 200 and its observation states a `clock_period`. The desktop shell was booted before this probe and the window opened on a home holding no Run at all, so a host coming up here reconciles nothing and asks the site for nothing; the probe is still the first thing this run asks of the site, and the launch is still gated on it.

*Observed:* 2.27 ns, from /data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt, sha256 a8977b90b9f034c247dbec600448404f1cadfa172bf327d573ec886be21af22c (2421 bytes)

### PASS — target-tighter-than-last

The campaign's first generation was asked for a clock period derived from the site's own last result: last − 0.2 ns. Tighter than last follows from that derivation; this check does not confirm it independently.

*Predicate:* The site's last result states a clock period, and the target asked for is `last − 0.2` rounded to 3 decimals — the derivation, stated. The target is also inside the sanity band — 0.5 ns ≤ target ≤ 2 × the site's own last result, and a plain decimal — which is enforced before the launch: a period outside it exits 2 with no record and nothing asked of the site beyond this probe. Later generations ask for whatever the chooser picked, which is what a Loop is; those periods are checked one by one below.

*Observed:* last 2.27 ns, target 2.07 ns (the site's last result (2.27 ns) minus 0.2 ns)

### PASS — site-roots-resolved

Both roots this site names resolved on the site itself before anything was launched: where campaign workspaces go, and where the site's own flow is.

*Predicate:* `realpath` of the site's `workspaceRoot` and of its `flowRoot`, asked through HimaChannel, each answered a path. Every later check measures against these two, so a root that does not resolve stops the launch here rather than failing checks after a campaign has already run.

*Observed:* workspaceRoot /data/eda/project/hima_harness → /data/eda/project/hima_harness; flowRoot /data/eda/project/design_zoo → /data/eda/project/design_zoo

### PASS — one-job-at-a-time

Every tmux session and every tmux pane on the site was listed and read, and none of them carries a job of this harness or a large EDA job of the site's own.

*Predicate:* tmux on the site lists no session whose name begins with `hima-`, and no pane that any of four patterns reads as busy: its session name begins with `hima-`; or its command half — `pane_current_command` and `pane_start_command` together, which is where the tool, the design and the target are — names the site's own resolved flow root, or names one of `dc_shell`, `icc2`, `innovus`, `pt_shell`, `/usr/local/bin/eda`, or holds `make` and `synth` together. Those are the shapes a large job is launched in here: the flow runs Design Compiler through `make` and a container, so `dc_shell` is never the string on the pane, and matching on it alone would clear a site that is busy. A probe that could not be made is a failure, never a quiet site. Asked once, before the launch: a Campaign holds the site for several generations, and this says the site was free when it took it, not that nobody arrived afterwards — the Site's own job cap is what bounds that, and the Budget's meters are what say what this Campaign held.

*Observed:* no server running on /tmp/tmux-1000/default; no tmux panes; hima- sessions: none; panes read as busy: none of 0

### PASS — started-from-the-window

The campaign was started by filling the window's own start form and clicking start, and what was typed into it is the Run's goal, its first Strategy and its Budget.

*Predicate:* Each of the seven controls the workbench marks — `start-pack`, `start-site`, `start-target`, `start-period`, `start-time-box`, `start-retries`, `start-generations` — was filled through the page and read back holding what it was given; `start` was clicked; and the Run the host started carries `goal.target_period_ns` = the target typed, a first Strategy of the period typed (which is generation one's asked period on the card's own ledger), a time box of the minutes typed, the retry allowance typed and the generation limit typed. Nothing here posts to a route to start anything: what starts the Campaign is the page's own form.

*Observed:* the form held {"start-pack":"opene902-timing-probe","start-site":"linglong","start-target":"2.07","start-period":"2.07","start-time-box":"30","start-retries":"3","start-generations":"6"}; the run's goal {"target_period_ns":2.07}, first strategy 2.07 ns, budget {"timeBoxMs":1800000,"retryAllowance":3,"jobCap":1,"licences":{"Design-Compiler":99,"Library-Compiler":99,"PrimeTime":99,"Innovus_Impl_System":0},"generationLimit":6}

### PASS — at-least-three-generations

The campaign ran several generations of its Loop, not one: three at least.

*Predicate:* The run row says which generation it ended in, and the card's own ledger has one row per generation the Loop opened. Both are at least three, and they agree — three is what makes this a Campaign and not the single generation step 2 proved (D40): a first strategy, at least one the chooser picked from what was measured, and at least one more measured against the one before it, which is the least a convergence rule can be decided over.

*Observed:* the run row says generation 6; the ledger has 6 row(s): g1 2.07→2.07, g2 2.28→2.28, g3 2.33→2.33, g4 2.38→2.38, g5 2.43→2.43, g6 2.48→2.48

### FAIL — ended-goal-met-or-converged

The campaign ended for the one of two reasons step 3 is declared done by: the Goal was met, or the exploration converged — the window said so, and the record says which, and by what rule when it converged.

*Predicate:* The card the window rendered showed an ended status, waited for on its own `run-status` region, and that status is the one the Run carries: what ended this Campaign was watched where a person would watch it, not only read off a route afterwards. The status is `ended-goal-met` or `ended-converged`. On `ended-converged` the last decision on the ledger carries the whole rule the pack declared — which read, what band, over how many generations, and the measured values compared — and those match the pack's own `converge` block, so the ending is re-derivable from this record alone. The other three endings a Run can reach are not this: `ended-goal-not-met` is a graph out of edges, `ended-budget-exhausted` is a meter running out before the exploration had its answer, and `cancelled` is a person.

*Observed:* the card showed ended-budget-exhausted; the run carries ended-budget-exhausted, ended by generation-limit

### PASS — g1-observed-period-is-the-asked

Generation 1's own report states the clock period that generation was asked for.

*Predicate:* The observation this generation read out of the Campaign workspace — the one its verdicts cite, or its latest when they cite none — states a `clock_period` equal to the Strategy this generation was asked for. Generation one was opened by no decision: what it asked for is the run row's `firstStrategy`, written once when the Run was opened, which is the period the start form was filled with. That period is the one the report's *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at.

*Observed:* asked 2.07 ns; /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt states 2.07 ns

### PASS — g1-setup-verdict-follows-the-measurement

Generation 1's setup rule verdict follows from the slack that generation measured, and cites the observation it was read from.

*Predicate:* The `setup-wns-all-nonnegative` verdict of this generation is PASS exactly when its observation's `setup_wns` is at least 0, and it cites that observation.

*Observed:* setup_wns -0.16 ns, verdict FAIL, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000007

### PASS — g1-goal-verdict-follows-the-measurement

Generation 1's goal rule verdict follows from the period that generation measured and the Run's own goal, and cites the observation.

*Predicate:* The `clock-period-at-most` verdict of this generation is bound to the Run's `target_period_ns`, is PASS exactly when its observation's `clock_period` is at most that target, and cites that observation. The target is the Campaign's and does not move between generations — a Loop explores toward one Goal, and a new goal is a new Campaign (D3).

*Observed:* clock_period 2.07 ns against {"target_period_ns":2.07}, verdict PASS, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000007

### PASS — g1-decision-follows-the-chooser

Generation 1's decision is the one `timing-push` and the pack's convergence rule declare for these two verdicts and these measured values, and it cites both verdicts and the observation.

*Predicate:* One decision, by chooser `timing-push`, taken in the chooser's own order: `{goalMet: true}` when the constraint and the goal both passed; else `{converged: {read, band, generations, values}}` when the pack's `converge` block has enough generations to compare and each of the last `generations` moves of the measured period is strictly below the band; else `{strategy: {periodNs: period − slack + guard}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| + guard}}` when the constraint failed, each rounded to 3 decimals — with `period` and `slack` read from this generation's observation, `guard` the guard band the pack binds, and the earlier generations' measured periods taken from this same record. Its `rationale` is those numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.

*Observed:* timing-push chose {"strategy":{"periodNs":2.28}}; the chooser's and the pack's own clauses give {"strategy":{"periodNs":2.28}} (period + |slack| + guard = 2.07 + 0.16 + 0.05); rationale {"period":2.07,"slack":-0.16,"guardBandNs":0.05}; cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000010, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000011, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000007

### PASS — g1-next-period-follows-the-decision

Generation 2 asked the flow for exactly the period generation 1's decision chose.

*Predicate:* Following a revisit edge is one write of the run row — the target node, the next generation and the Strategy the decision chose, together — so a generation that follows a decision asks for that decision's period and no other number. Where a generation follows, its asked period equals the previous decision's `chosen.strategy.periodNs`. Where none follows, the last decision chose no next Strategy at all (the Goal was met, or the exploration converged) — or it chose one and the Budget's generation limit refused to open the generation that would have tried it, which is an ending the decision stays on record for.

*Observed:* generation 1 chose 2.28 ns; generation 2 asked for 2.28 ns

### PASS — g2-observed-period-is-the-asked

Generation 2's own report states the clock period that generation was asked for.

*Predicate:* The observation this generation read out of the Campaign workspace — the one its verdicts cite, or its latest when they cite none — states a `clock_period` equal to the Strategy this generation was asked for. Generation 2 asked for whatever generation 1's decision chose, which is checked as its own claim below. That period is the one the report's *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at.

*Observed:* asked 2.28 ns; /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt states 2.28 ns

### PASS — g2-setup-verdict-follows-the-measurement

Generation 2's setup rule verdict follows from the slack that generation measured, and cites the observation it was read from.

*Predicate:* The `setup-wns-all-nonnegative` verdict of this generation is PASS exactly when its observation's `setup_wns` is at least 0, and it cites that observation.

*Observed:* setup_wns 0 ns, verdict PASS, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000021

### PASS — g2-goal-verdict-follows-the-measurement

Generation 2's goal rule verdict follows from the period that generation measured and the Run's own goal, and cites the observation.

*Predicate:* The `clock-period-at-most` verdict of this generation is bound to the Run's `target_period_ns`, is PASS exactly when its observation's `clock_period` is at most that target, and cites that observation. The target is the Campaign's and does not move between generations — a Loop explores toward one Goal, and a new goal is a new Campaign (D3).

*Observed:* clock_period 2.28 ns against {"target_period_ns":2.07}, verdict FAIL, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000021

### PASS — g2-decision-follows-the-chooser

Generation 2's decision is the one `timing-push` and the pack's convergence rule declare for these two verdicts and these measured values, and it cites both verdicts and the observation.

*Predicate:* One decision, by chooser `timing-push`, taken in the chooser's own order: `{goalMet: true}` when the constraint and the goal both passed; else `{converged: {read, band, generations, values}}` when the pack's `converge` block has enough generations to compare and each of the last `generations` moves of the measured period is strictly below the band; else `{strategy: {periodNs: period − slack + guard}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| + guard}}` when the constraint failed, each rounded to 3 decimals — with `period` and `slack` read from this generation's observation, `guard` the guard band the pack binds, and the earlier generations' measured periods taken from this same record. Its `rationale` is those numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.

*Observed:* timing-push chose {"strategy":{"periodNs":2.33}}; the chooser's and the pack's own clauses give {"strategy":{"periodNs":2.33}} (period − slack + guard = 2.28 − 0 + 0.05); rationale {"period":2.28,"slack":0,"guardBandNs":0.05}; cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000024, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000025, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000021

### PASS — g2-next-period-follows-the-decision

Generation 3 asked the flow for exactly the period generation 2's decision chose.

*Predicate:* Following a revisit edge is one write of the run row — the target node, the next generation and the Strategy the decision chose, together — so a generation that follows a decision asks for that decision's period and no other number. Where a generation follows, its asked period equals the previous decision's `chosen.strategy.periodNs`. Where none follows, the last decision chose no next Strategy at all (the Goal was met, or the exploration converged) — or it chose one and the Budget's generation limit refused to open the generation that would have tried it, which is an ending the decision stays on record for.

*Observed:* generation 2 chose 2.33 ns; generation 3 asked for 2.33 ns

### PASS — g3-observed-period-is-the-asked

Generation 3's own report states the clock period that generation was asked for.

*Predicate:* The observation this generation read out of the Campaign workspace — the one its verdicts cite, or its latest when they cite none — states a `clock_period` equal to the Strategy this generation was asked for. Generation 3 asked for whatever generation 2's decision chose, which is checked as its own claim below. That period is the one the report's *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at.

*Observed:* asked 2.33 ns; /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt states 2.33 ns

### PASS — g3-setup-verdict-follows-the-measurement

Generation 3's setup rule verdict follows from the slack that generation measured, and cites the observation it was read from.

*Predicate:* The `setup-wns-all-nonnegative` verdict of this generation is PASS exactly when its observation's `setup_wns` is at least 0, and it cites that observation.

*Observed:* setup_wns 0 ns, verdict PASS, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000035

### PASS — g3-goal-verdict-follows-the-measurement

Generation 3's goal rule verdict follows from the period that generation measured and the Run's own goal, and cites the observation.

*Predicate:* The `clock-period-at-most` verdict of this generation is bound to the Run's `target_period_ns`, is PASS exactly when its observation's `clock_period` is at most that target, and cites that observation. The target is the Campaign's and does not move between generations — a Loop explores toward one Goal, and a new goal is a new Campaign (D3).

*Observed:* clock_period 2.33 ns against {"target_period_ns":2.07}, verdict FAIL, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000035

### PASS — g3-decision-follows-the-chooser

Generation 3's decision is the one `timing-push` and the pack's convergence rule declare for these two verdicts and these measured values, and it cites both verdicts and the observation.

*Predicate:* One decision, by chooser `timing-push`, taken in the chooser's own order: `{goalMet: true}` when the constraint and the goal both passed; else `{converged: {read, band, generations, values}}` when the pack's `converge` block has enough generations to compare and each of the last `generations` moves of the measured period is strictly below the band; else `{strategy: {periodNs: period − slack + guard}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| + guard}}` when the constraint failed, each rounded to 3 decimals — with `period` and `slack` read from this generation's observation, `guard` the guard band the pack binds, and the earlier generations' measured periods taken from this same record. Its `rationale` is those numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.

*Observed:* timing-push chose {"strategy":{"periodNs":2.38}}; the chooser's and the pack's own clauses give {"strategy":{"periodNs":2.38}} (period − slack + guard = 2.33 − 0 + 0.05); rationale {"period":2.33,"slack":0,"guardBandNs":0.05}; cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000038, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000039, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000035

### PASS — g3-next-period-follows-the-decision

Generation 4 asked the flow for exactly the period generation 3's decision chose.

*Predicate:* Following a revisit edge is one write of the run row — the target node, the next generation and the Strategy the decision chose, together — so a generation that follows a decision asks for that decision's period and no other number. Where a generation follows, its asked period equals the previous decision's `chosen.strategy.periodNs`. Where none follows, the last decision chose no next Strategy at all (the Goal was met, or the exploration converged) — or it chose one and the Budget's generation limit refused to open the generation that would have tried it, which is an ending the decision stays on record for.

*Observed:* generation 3 chose 2.38 ns; generation 4 asked for 2.38 ns

### PASS — g4-observed-period-is-the-asked

Generation 4's own report states the clock period that generation was asked for.

*Predicate:* The observation this generation read out of the Campaign workspace — the one its verdicts cite, or its latest when they cite none — states a `clock_period` equal to the Strategy this generation was asked for. Generation 4 asked for whatever generation 3's decision chose, which is checked as its own claim below. That period is the one the report's *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at.

*Observed:* asked 2.38 ns; /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt states 2.38 ns

### PASS — g4-setup-verdict-follows-the-measurement

Generation 4's setup rule verdict follows from the slack that generation measured, and cites the observation it was read from.

*Predicate:* The `setup-wns-all-nonnegative` verdict of this generation is PASS exactly when its observation's `setup_wns` is at least 0, and it cites that observation.

*Observed:* setup_wns 0 ns, verdict PASS, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000049

### PASS — g4-goal-verdict-follows-the-measurement

Generation 4's goal rule verdict follows from the period that generation measured and the Run's own goal, and cites the observation.

*Predicate:* The `clock-period-at-most` verdict of this generation is bound to the Run's `target_period_ns`, is PASS exactly when its observation's `clock_period` is at most that target, and cites that observation. The target is the Campaign's and does not move between generations — a Loop explores toward one Goal, and a new goal is a new Campaign (D3).

*Observed:* clock_period 2.38 ns against {"target_period_ns":2.07}, verdict FAIL, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000049

### PASS — g4-decision-follows-the-chooser

Generation 4's decision is the one `timing-push` and the pack's convergence rule declare for these two verdicts and these measured values, and it cites both verdicts and the observation.

*Predicate:* One decision, by chooser `timing-push`, taken in the chooser's own order: `{goalMet: true}` when the constraint and the goal both passed; else `{converged: {read, band, generations, values}}` when the pack's `converge` block has enough generations to compare and each of the last `generations` moves of the measured period is strictly below the band; else `{strategy: {periodNs: period − slack + guard}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| + guard}}` when the constraint failed, each rounded to 3 decimals — with `period` and `slack` read from this generation's observation, `guard` the guard band the pack binds, and the earlier generations' measured periods taken from this same record. Its `rationale` is those numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.

*Observed:* timing-push chose {"strategy":{"periodNs":2.43}}; the chooser's and the pack's own clauses give {"strategy":{"periodNs":2.43}} (period − slack + guard = 2.38 − 0 + 0.05); rationale {"period":2.38,"slack":0,"guardBandNs":0.05}; cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000052, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000053, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000049

### PASS — g4-next-period-follows-the-decision

Generation 5 asked the flow for exactly the period generation 4's decision chose.

*Predicate:* Following a revisit edge is one write of the run row — the target node, the next generation and the Strategy the decision chose, together — so a generation that follows a decision asks for that decision's period and no other number. Where a generation follows, its asked period equals the previous decision's `chosen.strategy.periodNs`. Where none follows, the last decision chose no next Strategy at all (the Goal was met, or the exploration converged) — or it chose one and the Budget's generation limit refused to open the generation that would have tried it, which is an ending the decision stays on record for.

*Observed:* generation 4 chose 2.43 ns; generation 5 asked for 2.43 ns

### PASS — g5-observed-period-is-the-asked

Generation 5's own report states the clock period that generation was asked for.

*Predicate:* The observation this generation read out of the Campaign workspace — the one its verdicts cite, or its latest when they cite none — states a `clock_period` equal to the Strategy this generation was asked for. Generation 5 asked for whatever generation 4's decision chose, which is checked as its own claim below. That period is the one the report's *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at.

*Observed:* asked 2.43 ns; /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt states 2.43 ns

### PASS — g5-setup-verdict-follows-the-measurement

Generation 5's setup rule verdict follows from the slack that generation measured, and cites the observation it was read from.

*Predicate:* The `setup-wns-all-nonnegative` verdict of this generation is PASS exactly when its observation's `setup_wns` is at least 0, and it cites that observation.

*Observed:* setup_wns 0 ns, verdict PASS, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000063

### PASS — g5-goal-verdict-follows-the-measurement

Generation 5's goal rule verdict follows from the period that generation measured and the Run's own goal, and cites the observation.

*Predicate:* The `clock-period-at-most` verdict of this generation is bound to the Run's `target_period_ns`, is PASS exactly when its observation's `clock_period` is at most that target, and cites that observation. The target is the Campaign's and does not move between generations — a Loop explores toward one Goal, and a new goal is a new Campaign (D3).

*Observed:* clock_period 2.43 ns against {"target_period_ns":2.07}, verdict FAIL, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000063

### PASS — g5-decision-follows-the-chooser

Generation 5's decision is the one `timing-push` and the pack's convergence rule declare for these two verdicts and these measured values, and it cites both verdicts and the observation.

*Predicate:* One decision, by chooser `timing-push`, taken in the chooser's own order: `{goalMet: true}` when the constraint and the goal both passed; else `{converged: {read, band, generations, values}}` when the pack's `converge` block has enough generations to compare and each of the last `generations` moves of the measured period is strictly below the band; else `{strategy: {periodNs: period − slack + guard}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| + guard}}` when the constraint failed, each rounded to 3 decimals — with `period` and `slack` read from this generation's observation, `guard` the guard band the pack binds, and the earlier generations' measured periods taken from this same record. Its `rationale` is those numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.

*Observed:* timing-push chose {"strategy":{"periodNs":2.48}}; the chooser's and the pack's own clauses give {"strategy":{"periodNs":2.48}} (period − slack + guard = 2.43 − 0 + 0.05); rationale {"period":2.43,"slack":0,"guardBandNs":0.05}; cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000066, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000067, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000063

### PASS — g5-next-period-follows-the-decision

Generation 6 asked the flow for exactly the period generation 5's decision chose.

*Predicate:* Following a revisit edge is one write of the run row — the target node, the next generation and the Strategy the decision chose, together — so a generation that follows a decision asks for that decision's period and no other number. Where a generation follows, its asked period equals the previous decision's `chosen.strategy.periodNs`. Where none follows, the last decision chose no next Strategy at all (the Goal was met, or the exploration converged) — or it chose one and the Budget's generation limit refused to open the generation that would have tried it, which is an ending the decision stays on record for.

*Observed:* generation 5 chose 2.48 ns; generation 6 asked for 2.48 ns

### PASS — g6-observed-period-is-the-asked

Generation 6's own report states the clock period that generation was asked for.

*Predicate:* The observation this generation read out of the Campaign workspace — the one its verdicts cite, or its latest when they cite none — states a `clock_period` equal to the Strategy this generation was asked for. Generation 6 asked for whatever generation 5's decision chose, which is checked as its own claim below. That period is the one the report's *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at.

*Observed:* asked 2.48 ns; /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt states 2.48 ns

### PASS — g6-setup-verdict-follows-the-measurement

Generation 6's setup rule verdict follows from the slack that generation measured, and cites the observation it was read from.

*Predicate:* The `setup-wns-all-nonnegative` verdict of this generation is PASS exactly when its observation's `setup_wns` is at least 0, and it cites that observation.

*Observed:* setup_wns 0 ns, verdict PASS, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000077

### PASS — g6-goal-verdict-follows-the-measurement

Generation 6's goal rule verdict follows from the period that generation measured and the Run's own goal, and cites the observation.

*Predicate:* The `clock-period-at-most` verdict of this generation is bound to the Run's `target_period_ns`, is PASS exactly when its observation's `clock_period` is at most that target, and cites that observation. The target is the Campaign's and does not move between generations — a Loop explores toward one Goal, and a new goal is a new Campaign (D3).

*Observed:* clock_period 2.48 ns against {"target_period_ns":2.07}, verdict FAIL, cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000077

### PASS — g6-decision-follows-the-chooser

Generation 6's decision is the one `timing-push` and the pack's convergence rule declare for these two verdicts and these measured values, and it cites both verdicts and the observation.

*Predicate:* One decision, by chooser `timing-push`, taken in the chooser's own order: `{goalMet: true}` when the constraint and the goal both passed; else `{converged: {read, band, generations, values}}` when the pack's `converge` block has enough generations to compare and each of the last `generations` moves of the measured period is strictly below the band; else `{strategy: {periodNs: period − slack + guard}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| + guard}}` when the constraint failed, each rounded to 3 decimals — with `period` and `slack` read from this generation's observation, `guard` the guard band the pack binds, and the earlier generations' measured periods taken from this same record. Its `rationale` is those numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.

*Observed:* timing-push chose {"strategy":{"periodNs":2.53}}; the chooser's and the pack's own clauses give {"strategy":{"periodNs":2.53}} (period − slack + guard = 2.48 − 0 + 0.05); rationale {"period":2.48,"slack":0,"guardBandNs":0.05}; cites run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000080, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000081, run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9#000077

### PASS — g6-next-period-follows-the-decision

Generation 6 was the last, and the record says why no generation followed it.

*Predicate:* Following a revisit edge is one write of the run row — the target node, the next generation and the Strategy the decision chose, together — so a generation that follows a decision asks for that decision's period and no other number. Where a generation follows, its asked period equals the previous decision's `chosen.strategy.periodNs`. Where none follows, the last decision chose no next Strategy at all (the Goal was met, or the exploration converged) — or it chose one and the Budget's generation limit refused to open the generation that would have tried it, which is an ending the decision stays on record for.

*Observed:* generation 6 chose {"strategy":{"periodNs":2.53}} and no generation followed it; the run ended ended-budget-exhausted at the generation limit of 6

### PASS — every-generation-in-one-workspace

Every generation's synthesis Job ran inside the one Campaign workspace, through `make` in tmux, under a container of this Campaign's own and never the site's.

*Predicate:* Every `workspace` record of this Run names the same workspace, and that workspace is `<workspaceRoot>/<campaignId>` with `<workspaceRoot>` as the site itself resolves it; its `containerName` is `hima-<campaignId>`; every generation launched at least one Job; and every Job the Run launched has that path as its own `workspace`, runs `make -C <workspace>/flow` on its command line, and carries `EDA_CONTAINER_NAME=` that same container name. One workspace across the whole Loop is what makes a Campaign a Campaign rather than several runs that share a goal: the flow is copied once, and each generation synthesizes in the copy the last one left.

*Observed:* workspace /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7 (expected /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7), container hima-opene902-timing-probe-20260910-221158-96d7 (expected hima-opene902-timing-probe-20260910-221158-96d7); 1 workspace record(s), all naming it: yes; jobs per generation: g1=1, g2=1, g3=1, g4=1, g5=1, g6=1; every job in the workspace under that container: yes; wires: 'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.07' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit' | 'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.28' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit' | 'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.33' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit' | 'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.38' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit' | 'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.43' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit' | 'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.48' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'

### PASS — nothing-written-outside-the-workspace

Every write the campaign asked the site to make landed inside its own workspace, every path the ledger records as written is inside it too, every report the campaign read came out of it, and this script itself asked the site to write nothing at all.

*Predicate:* Two readings of the same thing, and both have to hold. **What was sent**: every `mkdir`, `cp` and `tee` the campaign's own host asked the site to run — drained from that host's audit over `POST /hima/api/audit/drain` — has its write target, the last word of the command, inside `<workspaceRoot>/<campaignId>`; every `cp` reads from inside the site's own flow root, as the site resolves it; and every `tmux new-session` names the Campaign workspace as its working directory (`-c`), which is what puts the Job's own `make -C <workspace>/flow` there. HimaChannel runs no other verb that writes. **What was left**: the Campaign workspace, every Job's working directory, every Job's log and exit file — named on the Job's own command line, as the site received it — and both files of the report are inside that same directory, and every observation this Run recorded was read from inside it. And this script's own process ran no write verb and no launch at all, its audit holding read-only probes and nothing else. What `make` and the tools it starts write once a Job is running is not covered by either reading: that is inside the Job, where this harness sees only the log and the exit status, and it is the flow's own doing — bounded by where the flow copy is (D19).

*Observed:* 14 write command(s) sent (mkdir, mkdir, cp, cp, cp, cp, mkdir, cp, mkdir, cp, tee, mkdir, tee, tee); write targets outside /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7: none; copy sources outside /data/eda/project/design_zoo: none; launches outside the workspace: none; 21 recorded write target(s), outside it: none; 6 observation(s) read, outside it: none; each job's log and exit file named on its own wire: yes; commands this script sent that write: none

### PASS — site-flow-root-untouched

The one report the target was derived from is unchanged in content and length. Only that file: the rest of the site's own flow root is never read here, so nothing is claimed about it.

*Predicate:* The same report, `/data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt`, read read-only before the campaign and after it over the same route, has the same sha256, the same byte count and the same stated clock period. That is this one file in the site's own flow root, not the flow root: no other file under it is read, and a rewrite that reproduced these same bytes would not be caught. (HimaChannel's read-only probes are `cat` and `realpath`; there is no `stat` on that list, and adding one would be a verb granted on a customer's site for this script's sake, so content and length are what this is said by.)

*Observed:* before sha256 a8977b90b9f034c247dbec600448404f1cadfa172bf327d573ec886be21af22c (2421 bytes, 2.27 ns); after sha256 a8977b90b9f034c247dbec600448404f1cadfa172bf327d573ec886be21af22c (2421 bytes, 2.27 ns)

### PASS — report-on-the-site-beside-the-results

The campaign's technical report is on the site under the campaign workspace, beside the results, and both files are exactly what the ledger says they are.

*Predicate:* Both files are at `<workspace>/hima-experience/<runId>.md` and `.json`; each was read back off the site through HimaChannel's `cat` — a read-only probe — and hashes to the `sha256` the Run's `experience` record states, at the byte count it states; and `GET /hima/api/runs/<id>/experience`, which reads them back the same way from the host and verifies both hashes itself, answers 200 with that same record and a report whose schema is `hima-experience/1`. The record is the claim that the files are there (D44), so a record without the files, or files that no longer hash to it, is a failure here.

*Observed:* /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md sha256 45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2 (3683 bytes); /data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json sha256 e00751a8bdbaae0989bcd224e93f4f07210b981209beed6c4a41c1004056450f (4595 bytes); where the record says: yes; read off the site: markdown 45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2 (3683 bytes), json e00751a8bdbaae0989bcd224e93f4f07210b981209beed6c4a41c1004056450f (4595 bytes); the experience route: schema hima-experience/1, 3667 characters of markdown

### PASS — window-shows-the-report

The window shows the campaign's report on the ended card, what it shows is the report that is on the site, and the card is a picture beside this record.

*Predicate:* The card's `run-experience` region is there on the ended Run; its `-sha256` state is the Markdown file's own hash and its `-written-at` the instant both files state as their own; and its rendered text carries the report's first heading, as the file on the site opens with it. What the page renders is composed from the same run view the record was written from (D44), so this is the document on the site and not a second account of it. The same window then painted the ended card into the PNG named beside this record, which is what makes the claim something a reader can look at rather than only read: a picture that was not taken is a claim this record does not get to make.

*Observed:* -sha256 45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2 (the file's is 45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2), -written-at 2026-09-10T22:27:16.400Z (the record's is 2026-09-10T22:27:16.400Z); the report's first heading "Campaign opene902-timing-probe-20260910-221158-96d7" is in what the window rendered: yes; the ended card was photographed to /Users/lluzi/code/hima_harness_reforge_claude/docs/validation/2026-09-10-step3-acceptance-attempt1-failed-card.png (2400×1670, 392765 bytes)

### PASS — report-reproduces-the-card

The report a program reads holds the very numbers the card showed: the campaign's generations, row for row.

*Predicate:* The `generations` of the JSON file on the site are, element for element, the `generations` of the run view the window rendered the card from — each row's asked and observed period, its slack, its verdicts, its decision in the card's own words, its wall time and its state. A report whose numbers differ from the card's is a report of a different Campaign, however plausible its arithmetic.

*Observed:* 6 row(s) in the file, 6 on the card; identical: yes

### PASS — restart-reads-back-unchanged

After the window was quit and another shell booted on the same home, the whole campaign reads back unchanged, and its report is re-served rather than written again.

*Predicate:* The first shell was told to quit and its process ended; a second shell was booted on the same home, which is a second dsh host over the same HimaLedger. `GET /hima/api/runs/<id>` and `GET .../records` answer over it exactly what they answered over the first — the run row, every generation, every record. The `experience` record is the same record, with the same `writtenAt` and the same two hashes, so no second report was written; and both files, read off the site again through `cat`, still hash to it. (What is *not* said here is that the files' modification times are unchanged: `stat` is not one of HimaChannel's two read-only probes, and adding one would be a verb granted on a customer's site for this script's sake. What stands in its place is stronger about the thing that matters — one `experience` record, one `writtenAt`, and the same bytes on the site — and weaker about nothing but the timestamp.)

*Observed:* run view identical, 86 records identical, experience record identical; the files after the restart: markdown 45ab49e91e7f46062139f058f2dcc5186c616819d302b070b9f338c6acd2dbd2, json e00751a8bdbaae0989bcd224e93f4f07210b981209beed6c4a41c1004056450f

### PASS — every-remote-command-recorded

The record lists every command this campaign asked the site to run, as HimaChannel's own audits saw them being sent: the host's, which drove the campaign, and this script's own probes beside them.

*Predicate:* Two audits, because there are two processes and HimaChannel's audit is per process: the dsh host inside the desktop shell drives the campaign, and this script only probes. Both are drained here — this one in process, the host's over `POST /hima/api/audit/drain`, behind the same session fence every other route is — every 2 seconds from the click onwards and at every phase boundary, so that neither 500-entry window could evict a command before it was read; each says so itself, and a window that filled fails this check rather than being written down as a complete list. Every drain answered, and the host's audit holds what a campaign is made of: the `mkdir` and `cp` of the workspace, one `tmux new-session` carrying each generation's whole `make` command line as the site received it — matched here against the session the ledger recorded for that generation, so a Job on the ledger whose launch was never sent would fail this — and the two `tee`s that wrote the report. This script's own audit holds its read-only probes: the tmux question, `realpath` of the two roots, and the `cat` of each report file on an ssh site. Two commands are outside both lists by design: the reachability probe `ssh … true` sent before anything else, which runs nothing on the site, and whatever a second host would have sent between the first shell being told to quit and the second answering — a window in which no Run was running and nothing asked the site anything. What a Job's own `make` runs once it is going is not a command this harness sent and is not here; that is the flow's, inside the Job.

*Observed:* 847 command(s) sent by the host that drove the campaign, 8 by this script (8 read-only probe(s)); the window filled between drains — host: no, script: no; 6 launch(es) on the wire, one at least per generation: yes; the report's two files written by `tee`: yes

### PASS — meters-within-budget

The campaign stayed inside every bound it was started under, and its meters account for what it spent.

*Predicate:* The Run's own meters against the Budget copied onto it at start: the elapsed time is at most the time box; the generation it ended in is at most the generation limit; there is one per-generation duration for each generation it opened, and they sum to no more than the elapsed time; every licence it spent time on is one the Site declared seats of; and `endedBy` names a meter or a person exactly when the graph did not end it — absent on goal met, on converged and on a graph out of edges, present on a spent Budget and on a cancel.

*Observed:* elapsed 917948 ms of a time box of 1800000 ms; generation 6 of at most 6; per generation [167526,161280,155211,146034,140047,146061] ms; jobs launched 6, attempts 24; licences declared {"Design-Compiler":99,"Library-Compiler":99,"PrimeTime":99,"Innovus_Impl_System":0}, spent {"Design-Compiler":914018}; ended by generation-limit, which for a ended-budget-exhausted ending is what it should be

## Restart

After quitting the window and booting a second shell on the same home, the run view, every one of the Run's records and its `experience` record read back unchanged, and both report files still hash to what that record states.

## The read-only probe of the site

- Before the campaign: `POST /hima/api/observe { site: linglong, path: /data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt, reader: dc-qor-report }` → 2.27 ns, sha256 `a8977b90b9f034c247dbec600448404f1cadfa172bf327d573ec886be21af22c`
- After it: `POST /hima/api/observe { site: linglong, path: /data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt, reader: dc-qor-report }` → 2.27 ns, sha256 `a8977b90b9f034c247dbec600448404f1cadfa172bf327d573ec886be21af22c`
- Campaign workspaces go under `/data/eda/project/hima_harness`, and the site's own flow is at `/data/eda/project/design_zoo`, as the site itself resolves them.
- One job at a time: no server running on /tmp/tmux-1000/default; no tmux panes; read as busy: none of 0 pane(s)

## Every command this harness asked site `linglong` to run

Two audits, because two processes asked, and HimaChannel's audit is per process. The Campaign was driven by the dsh host inside the desktop shell, and its audit was drained over `POST /hima/api/audit/drain` every 2 seconds and at every phase boundary; this script's own process sent the read-only probes, and its audit was drained in the same step. Each command is here as the Site received it, once every word was quoted. On an ssh Site every read is a `cat` or a `realpath`; a local Site is reached without ssh, where reading a file and resolving a path spawn nothing and so are not commands at all.

### What the host that drove the campaign sent

- (read-only probe) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt'`
- (read-only probe) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (read-only probe) `'cat' '--' '/data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the start) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/workspace.json'`
- (the start) `'mkdir' '-p' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'mkdir' '-p' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/Makefile'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/Makefile'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/Makefile' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/Makefile'`
- (the start) `'cp' '-R' '--' '/data/eda/project/design_zoo/Makefile' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/Makefile'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/flows'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/flows'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/flows' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/flows'`
- (the start) `'cp' '-R' '--' '/data/eda/project/design_zoo/flows' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/flows'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/manifests'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/manifests'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/manifests' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/manifests'`
- (the start) `'cp' '-R' '--' '/data/eda/project/design_zoo/manifests' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/manifests'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/tools'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/tools'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/tools' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/tools'`
- (the start) `'cp' '-R' '--' '/data/eda/project/design_zoo/tools' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/tools'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/build/opene902'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build'`
- (the start) `'mkdir' '-p' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build/opene902'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build/opene902' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build/opene902'`
- (the start) `'cp' '-R' '--' '/data/eda/project/design_zoo/build/opene902' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/build/opene902'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/sources/opene902'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources'`
- (the start) `'mkdir' '-p' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources/opene902'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources/opene902' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources/opene902'`
- (the start) `'cp' '-R' '--' '/data/eda/project/design_zoo/sources/opene902' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/sources/opene902'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/workspace.json'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/workspace.json' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/workspace.json'`
- (the start) `'tee' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/workspace.json'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the start) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the start) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the start) `'tmux' 'new-session' '-d' '-P' '-F' '#{pane_pid}' '-s' 'hima-a4249f9b-synthesize-10d0eb' '-c' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7' '/bin/sh' '-c' ''\''make'\'' '\''-C'\'' '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'\'' '\''DESIGN=opene902'\'' '\''synth'\'' '\''CLOCK_PERIOD_NS=2.07'\'' '\''FORCE_SYNTH=1'\'' '\''EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7'\'' > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.log'\'' 2>&1; printf '\''%s\n'\'' "$?" > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'\'''`
- (the start) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the start) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the start) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the start) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-10d0eb'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'tmux' 'new-session' '-d' '-P' '-F' '#{pane_pid}' '-s' 'hima-a4249f9b-synthesize-fc2f83' '-c' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7' '/bin/sh' '-c' ''\''make'\'' '\''-C'\'' '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'\'' '\''DESIGN=opene902'\'' '\''synth'\'' '\''CLOCK_PERIOD_NS=2.28'\'' '\''FORCE_SYNTH=1'\'' '\''EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7'\'' > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.log'\'' 2>&1; printf '\''%s\n'\'' "$?" > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'\'''`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-fc2f83'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'tmux' 'new-session' '-d' '-P' '-F' '#{pane_pid}' '-s' 'hima-a4249f9b-synthesize-54acc7' '-c' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7' '/bin/sh' '-c' ''\''make'\'' '\''-C'\'' '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'\'' '\''DESIGN=opene902'\'' '\''synth'\'' '\''CLOCK_PERIOD_NS=2.33'\'' '\''FORCE_SYNTH=1'\'' '\''EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7'\'' > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.log'\'' 2>&1; printf '\''%s\n'\'' "$?" > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'\'''`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-54acc7'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'tmux' 'new-session' '-d' '-P' '-F' '#{pane_pid}' '-s' 'hima-a4249f9b-synthesize-ce152f' '-c' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7' '/bin/sh' '-c' ''\''make'\'' '\''-C'\'' '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'\'' '\''DESIGN=opene902'\'' '\''synth'\'' '\''CLOCK_PERIOD_NS=2.38'\'' '\''FORCE_SYNTH=1'\'' '\''EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7'\'' > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.log'\'' 2>&1; printf '\''%s\n'\'' "$?" > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'\'''`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-ce152f'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'tmux' 'new-session' '-d' '-P' '-F' '#{pane_pid}' '-s' 'hima-a4249f9b-synthesize-4e83f5' '-c' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7' '/bin/sh' '-c' ''\''make'\'' '\''-C'\'' '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'\'' '\''DESIGN=opene902'\'' '\''synth'\'' '\''CLOCK_PERIOD_NS=2.43'\'' '\''FORCE_SYNTH=1'\'' '\''EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7'\'' > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.log'\'' 2>&1; printf '\''%s\n'\'' "$?" > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'\'''`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-4e83f5'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'tmux' 'new-session' '-d' '-P' '-F' '#{pane_pid}' '-s' 'hima-a4249f9b-synthesize-a5c976' '-c' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7' '/bin/sh' '-c' ''\''make'\'' '\''-C'\'' '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow'\'' '\''DESIGN=opene902'\'' '\''synth'\'' '\''CLOCK_PERIOD_NS=2.48'\'' '\''FORCE_SYNTH=1'\'' '\''EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7'\'' > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.log'\'' 2>&1; printf '\''%s\n'\'' "$?" > '\''/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'\'''`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'tmux' 'has-session' '-t' '=hima-a4249f9b-synthesize-a5c976'`
- (the campaign) `'test' '-f' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (the campaign) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow/results/opene902/syn/report/qor.rpt'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience'`
- (the campaign) `'mkdir' '-p' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md'`
- (the campaign) `'tee' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience'`
- (the campaign) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (the campaign) `'test' '!' '-e' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json' '-a' '!' '-L' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json'`
- (the campaign) `'tee' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json'`
- (reading the report back) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md'`
- (reading the report back) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (reading the report back) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md'`
- (reading the report back) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json'`
- (reading the report back) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (reading the report back) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json'`
- (read-back) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt'`
- (read-back) `'realpath' '-z' '-e' '--' '/data/eda/project'`
- (read-back) `'cat' '--' '/data/eda/project/design_zoo/results/opene902/syn/report/qor.rpt'`

### What this script's own process sent

- (read-only probe) `'realpath' '-z' '-e' '--' '/data/eda/project/hima_harness'`
- (read-only probe) `'realpath' '-z' '-e' '--' '/data/eda/project/design_zoo'`
- (read-only probe) `'tmux' 'list-sessions' '-F' '#{session_name}'`
- (read-only probe) `'tmux' 'list-panes' '-a' '-F' '#{session_name}|#{pane_current_command}|#{pane_start_command}'`
- (reading the report off the site) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md'`
- (reading the report off the site) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json'`
- (the restart) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md'`
- (the restart) `'cat' '--' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json'`

### The same launches, as the ledger holds them

One row per Job the Run recorded, matched by session against the launches above: the campaign's own account of what it ran, beside the audit of what its process sent.

- (generation 1) in `hima-a4249f9b-synthesize-10d0eb`, working directory `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7`: `'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.07' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-10d0eb.exit'`
- (generation 2) in `hima-a4249f9b-synthesize-fc2f83`, working directory `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7`: `'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.28' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-fc2f83.exit'`
- (generation 3) in `hima-a4249f9b-synthesize-54acc7`, working directory `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7`: `'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.33' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-54acc7.exit'`
- (generation 4) in `hima-a4249f9b-synthesize-ce152f`, working directory `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7`: `'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.38' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-ce152f.exit'`
- (generation 5) in `hima-a4249f9b-synthesize-4e83f5`, working directory `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7`: `'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.43' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-4e83f5.exit'`
- (generation 6) in `hima-a4249f9b-synthesize-a5c976`, working directory `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7`: `'make' '-C' '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/flow' 'DESIGN=opene902' 'synth' 'CLOCK_PERIOD_NS=2.48' 'FORCE_SYNTH=1' 'EDA_CONTAINER_NAME=hima-opene902-timing-probe-20260910-221158-96d7' > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.log' 2>&1; printf '%s\n' "$?" > '/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-a4249f9b-synthesize-a5c976.exit'`

The same campaign's workspace commands made `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7` and copied 6 pieces of the site's own flow into it, and its report commands wrote `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.md` and `/data/eda/project/hima_harness/opene902-timing-probe-20260910-221158-96d7/hima-experience/run-a4249f9b-44a6-4c4b-a208-5dbb77474cc9.json`. Each is named by the ledger record that claims it, above.

