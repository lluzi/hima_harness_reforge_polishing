# opene902 timing probe

A HimaPack that answers one question about one design: **which tested clock periods satisfy setup timing, and what should be tried next?** It synthesizes `opene902` at a chosen period in a workspace of its
own, reads the qor report the run produced, judges it against the setup constraint and the goal, and
chooses the next period to try from what it measured — never from what it hoped. Then it goes round
again with that period, and keeps going until the goal is met, the periods stop moving, or the
Campaign's generation allowance is spent.

This is the first pack, and it is deliberately the smallest thing that is still a real Campaign: one
strategy knob, one tool, one report, two rules, one chooser, one loop. Everything a bigger pack will
need — more knobs, more reports, a drill-down loop inside this one — is the same parts with more in
each.

Method version **2** changes only the default chooser binding from the legacy `timing-push`
guard band to the existing `over-constraining-push` step. Graph and contract both declare version 2.
The reference graph topology, tools, reader and Judge rules remain unchanged.

## What one generation does

1. **`synthesize`** (act) runs `tools/synth.sh` on the Site: `make … synth` inside the Campaign's own
   copy of the flow, at the strategy's clock period, forced so no generation reuses another's
   netlist.
2. **`read-qor`** (act) reads `flow/results/<design>/syn/report/qor.rpt` through the
   `dc-qor-report@1` reader, which turns it into typed values: setup WNS, setup TNS, the clock
   period the run actually used, hold WNS, and cell area.
3. **`judge`** (judge) applies two rules to those values and writes a verdict for each.
4. **`next-period`** (explore) runs the `over-constraining-push` chooser over the verdicts and the values and
   records the next strategy with its reasoning.

Then, if the decision was a next period, the Run follows the `revisit` edge from `next-period` back
to `synthesize` and does all four again as the next generation, at that period. A `blocked` wait node
is declared for the Hard blockers a node's spent Retry allowance produces; nothing draws an edge to
it, because the fabric routes a Run there itself.

## The Campaign: generation after generation

A **generation** is one pass of those four nodes: one synthesis at one period, read, judged, decided.
The first is generation one, and every record it leaves — the node transitions, the Job, the
observation, the verdicts, the decision — says which generation it belongs to, so the ledger reads as
the exploration ran. The Retry allowance is per node *per generation*: a synthesis that failed twice
in generation two starts generation three's allowance afresh, because a retry under a new period is
not a third go at the old one.

A Campaign of this pack ends in one of four ways, and the run row says which:

- **`ended-goal-met`** — a generation closed its setup timing *and* reached the target period. The
  question is answered and no further licence-minute is spent on it.
- **`ended-converged`** — the exploration has stopped learning. `next-period` declares what that
  means, as data, in the chooser's own vocabulary:

  ```yaml
  converge:
    read: period        # one of the chooser's own reads
    band: 0.05          # ns: how far apart two generations' periods must be to count as movement
    generations: 1      # how many successive generations must have moved by less than that
    generationLimit: 6  # this pack's default allowance, which a person may override
  ```

  The 0.05 ns band is the exploration step. This ending states only that consecutive
  measured periods moved by less than that band. It does **not** prove the Goal was met,
  the last generation met setup, or a global optimum was found. A repeated violation may
  converge; use the recorded verdicts to distinguish it from a measured closed result.

  The decision record carries the whole rule — the read, the band, the generations counted, and the
  periods compared — so a person can re-derive the ending from one record, and `/hima status` and the
  workbench card say it in words.
- **`ended-budget-exhausted`** — a meter ran out. `generation-limit` is the Loop's own: the Campaign
  reached the generation it was allowed and the revisit that would have opened the next one did not
  happen, with the period it would have tried still on record. `time-box` is the other.
- **`waiting`** — a node spent its Retry allowance and the Run is at `blocked`, for a person.

The generation limit is a **Budget** meter and not a convergence: convergence is what the exploration
learned, the limit is what the Campaign was allowed to spend learning it. `converge.generationLimit`
above is this pack's default; `/hima run … --generations <n>` (and the same field on the start route)
overrides it, and what the Run is actually held to is on its Budget from the moment it opens.

The local Site generates **stand-in** reports, with `setup_wns = min(0, period − 2.20)` ns.
These are controlled test numbers, not measured Design Compiler or silicon improvements.
From 2.30 ns, method 2 gives the following bounded examples:

| Goal | Measured periods (ns) | Ending |
| --- | --- | --- |
| 2.25 ns | 2.30, 2.25 | goal met; the last generation passes both rules |
| 2.00 ns | 2.30, 2.25, 2.20, 2.15, 2.15 | converged; the last two generations violate setup and the Goal remains unmet |
| 2.00 ns, one generation allowed, starting at 2.00 | 2.00 | generation limit; no measured setup-PASS result exists |

For the converged example, the best **measured setup-PASS** period is 2.20 ns. The 2.15 ns
requested period is a violation, and `period + |slack|` is a hypothesis about a possible period,
not a new measurement. An unexecuted next Strategy must never be included among measured results.
If there is no completed setup-PASS observation, there is no measured closed result to report.
The report's generation rows, verdicts, observation IDs and raw qor/logs provide the evidence;
this Pack does not add a second best-result computation to the Harness.

## The goal template

A Campaign binds one number when it starts:

```
target_period_ns = <the clock period this design must close on, in ns>
```

That number is bound into the goal rule `clock-period-at-most@1`, whose predicate is
`clock_period ≤ target_period_ns`. The rule file states the comparison; the Campaign states the
target. One rule therefore serves every target period, and the run cannot widen its own goal to
manufacture a pass — the bound value lands on the verdict, where a person can read what was actually
asked for.

`target_period_ns` is the name the harness carries it under; what a person reads is the words this
pack declares for it under `words:` in `contract.yml` — **clock period at most**, in **ns**. So a
card and `/hima status` say `goal: clock period at most 2.3 ns`, not `goal: target_period_ns=2.3`,
while every route still answers under the name. The number keeps whatever precision it was given: a
face shows what the ledger holds and rounds nothing. A pack that declares no words for a number shows
it under the name; this one declares both of its numbers, this and the strategy knob below.

The setup constraint is the same one step 1 checks, unparameterised:
`setup-wns-all-nonnegative@1`, `setup_wns ≥ 0` over all paths. A generation that closes its own
setup timing but misses the target is a real result, not a failure: it says the design closes, but
not yet where the goal is.

The judge applies the rules in the order `graph.yml` lists them, and the outgoing edge is chosen by
the outcome of the **first** — the setup rule. The goal rule decides whether the Campaign is done,
not which way the graph goes.

## The strategy knob

One knob: **`periodNs`**, the clock period handed to `CLOCK_PERIOD_NS` for that generation. It is
the only thing that changes between generations of this pack. The flow accepts it as a command-line
variable, so nothing in the flow is edited to try a new value.

The knob is this pack's, declared in `contract.yml` under `strategy:` with everything about it in
one place — its type, its unit, its bounds and the value a campaign starts at:

```yaml
strategy:
  periodNs: { type: number, unit: ns, min: 0.5, max: 10, default: 2.30 }
```

The bounds are what a person could plausibly ask *this flow* for and not what this design closes at:
they hold every period this pack has been run at on the stand-in and on the reference site, and they
refuse a mistyped `0` or `100` before a campaign exists, in the same words at the window's start
form, at `--set periodNs=<ns>` and in a request body. The default is what the start form fills in
and what a run that sets nothing is started at.

Its words, declared beside the goal parameter's under `words:`, are **clock period** in **ns**: a
face says `strategy: clock period 2.25 ns`, and the run row and the routes go on carrying
`periodNs`.

The period a generation was judged on is read back from the report (`clock_period`), never assumed
from the number that was asked for. A tool that silently clamped the period, or a reused netlist from
an earlier run, would otherwise be judged as if it had honoured the request.

## The chooser and its exploration step

`over-constraining-push` uses **stepNs = 0.05 ns**. Given the recorded setup verdict,
goal verdict, `clock_period` and `setup_wns`:

- **Both PASS**: end goal-met; do not propose another experiment.
- **Setup PASS, Goal not met**: try `clock_period − stepNs`. A met constraint does not
  need to expose positive slack for exploration to continue.
- **Setup FAIL**: try `clock_period + |setup_wns| − stepNs`. This is a proposed experiment,
  not evidence that the design closes at the inferred period.

Goal-met is checked first, then the Pack's convergence rule, then a next Strategy.
The chooser remains deterministic YAML in `choosers/over-constraining-push.yml`;
no model participates in this sample's strategy selection. The Ledger decision records its
inputs, parameters and cited verdicts/observation. Broader AI research belongs to the later Pack.

### Why the default changed

The historical Step 3 reference-site trace reported zero setup slack at met constraints.
The old `timing-push` PASS clause therefore increased the requested period by 0.05 ns every
generation. On the calibrated stand-in, starting at 2.30 ns produces 2.30, 2.35, 2.40,
2.45, 2.50, 2.55 and stops at the generation limit. That failure remains an explicitly
named `legacy-timing-push-probe` test variant; the old chooser file is retained unchanged.

Version 2 avoids relying on positive margin in that case. The local examples prove the
mechanism under their stated arithmetic, not a universal property of Design Compiler, all
designs or synthesis settings. Real Site efficacy requires a separate measured validation.
Historical records belong to their original method version and must not be relabeled as v2.

## What a Site must bind

`contract.yml` names three inputs; a Site binds them in its own file under `bindings:`.

| Input | On `linglong` | On the local site |
| --- | --- | --- |
| `flowRoot` | `/data/eda/project/design_zoo` — the Site's Design Zoo | the generated stand-in flow |
| `design` | `opene902` | `opene902` |
| `workspaceRoot` | `/data/eda/project/hima_harness` | the isolated home's workspace |

Nothing else about the pack changes between the two. That is what the run contract is for:
`/hima pack check opene902-timing-probe --site <site>` says, before anything runs, whether a Site can
host this pack — every input bound, every tool's first word a wrapper the Permit allows, every rule
and reader resolvable, and every licence a tool holds declared by the Site in at least that number.

## What a generation holds

`synth` holds **one `Design-Compiler` seat** for as long as its Job runs, declared on the tool in
`contract.yml`. A Site says how many seats it has under `capacity.licences` — `linglong` declares 99
— and the count is held across every Run of that Site, exactly as the parallel job cap is, because a
licence belongs to the Site and not to a Campaign. A launch that would take one seat too many waits
for one to come free, and says so on the node; a Site that declares fewer seats than this tool holds
(or none, which is what a node-locked tool's `0` means) cannot host the pack at all, and the check
says so rather than letting a Run wait for a seat that will never come free.

The other tool a person might expect here — Innovus — is not in this pack, which is why nothing
declares the reference site's `Innovus_Impl_System: 0`.

## Where a generation runs

Never in `flowRoot`. `/hima pack prepare` copies the flow's makefile, its `flows/` and `manifests/`
directories, and the design's `build/` and `sources/` trees (about 56 MB for `opene902`) into
`<workspaceRoot>/<campaign>/flow/`, and every generation of that Campaign runs there. The flow
derives its project root from its own location, so the copy builds into the copy.

The one thing that does *not* follow from the copy's location is the container the flow's wrapper
runs in: it creates a container by name and binds the project root into it, so a copy run under the
Site's own container name would write the Site's own results after all. Hence
`EDA_CONTAINER_NAME=hima-<campaign>` on every tool line, and the container's name recorded in the
workspace's `workspace.json` so a later cleanup knows what to remove.

## What the Campaign leaves for the next one

Every ended Run of this pack writes its own technical report into the Campaign workspace, beside the
results: `<workspaceRoot>/<campaign>/hima-experience/<runId>.md` for the people who read it and
`<runId>.json` for the programs that do. Nothing in this pack's three files asks for it — the harness
writes it for every pack, whatever ending the Run reached, a cancel and a spent time box included —
and it is written where the results are and left there, because the evidence of a Campaign belongs to
the Site owner and outlives the session that produced it. HimaLedger keeps only each file's path,
size and SHA-256, so a person who fetches one months later can hold it against what the Campaign
actually wrote.

What the Markdown holds is this pack's own story: the ending and why, the goal that was bound and
the Site it ran on, every Budget meter against its bound, one row per generation with the period it
asked for, the period and slack it measured, its verdicts and its decision, then a paragraph per
generation saying the same in sentences — *It asked the flow for 2.25 ns and measured 2.25 ns, with
0.00 ns of setup slack. HimaJudge found PASS on setup-wns-all-nonnegative, FAIL on
clock-period-at-most. The decision was …* — and finally the path the Run took, any Hard blockers,
and any cancel. So the file answers, without the ledger, the two questions a pack author is asked
about a Campaign that has finished: what did it learn, and why did it stop.

A person reads it in three places without going to the Site: the card's evidence drawer on an ended
Run, the `.md` route the drawer links to, and `/hima status <run>`, which names both paths.
