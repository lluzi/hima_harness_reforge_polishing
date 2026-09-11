# opene902 timing probe

A HimaPack that answers one question about one design: **how tight a clock period will Design
Compiler actually close on?** It synthesizes `opene902` at a chosen period in a workspace of its
own, reads the qor report the run produced, judges it against the setup constraint and the goal, and
chooses the next period to try from what it measured — never from what it hoped. Then it goes round
again with that period, and keeps going until the goal is met, the periods stop moving, or the
Campaign's generation allowance is spent.

This is the first pack, and it is deliberately the smallest thing that is still a real Campaign: one
strategy knob, one tool, one report, two rules, one chooser, one loop. Everything a bigger pack will
need — more knobs, more reports, a drill-down loop inside this one — is the same parts with more in
each.

## What one generation does

1. **`synthesize`** (act) runs `tools/synth.sh` on the Site: `make … synth` inside the Campaign's own
   copy of the flow, at the strategy's clock period, forced so no generation reuses another's
   netlist.
2. **`read-qor`** (act) reads `flow/results/<design>/syn/report/qor.rpt` through the
   `dc-qor-report@1` reader, which turns it into typed values: setup WNS, setup TNS, the clock
   period the run actually used, hold WNS, and cell area.
3. **`judge`** (judge) applies two rules to those values and writes a verdict for each.
4. **`next-period`** (explore) runs the `timing-push` chooser over the verdicts and the values and
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

  The band is the guard band this node also binds: one generation moving the *measured* clock period
  by less than the margin this pack asks a closed design to keep is a flow sitting at about the
  tightest period it closes at, and asking it for much the same period again would buy nothing. One
  Design Compiler tick — 0.01 ns, the two decimals the tool prints a period at — is the resolution of
  the instrument and not a statement about convergence: a band of one tick asks a real flow to repeat
  a period exactly, and a design that oscillates by a hundredth would spend its whole generation
  limit rather than end on what it learned.

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

Against the local stand-in flow, which closes at 2.20 ns and reports setup slack the way Design
Compiler does — `0.00` for any period it meets, the shortfall for one it does not — a Campaign at an
unreachable `target_period_ns=2.0`, started at `--set periodNs=2.0`, reaches neither of the first two
endings. 2.00 ns misses by 0.20 and the chooser backs off to 2.25; 2.25 is met, so the report states
no margin at all; the push clause computes `2.25 − 0.00 + 0.05` and asks for 2.30, and the period
walks away from the achievable one by a guard band a generation until the sixth is spent —
`ended-budget-exhausted`, by `generation-limit`. That is not the stand-in being unkind. It is what
this pack's chooser does on the real tool, and the section below says so.

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

## The chooser and its guard band

`timing-push`, with a **guard band of 0.05 ns**. Given the setup verdict, the goal verdict, and the
observed `clock_period` and `setup_wns`:

- **Setup PASS** — the design closed with `setup_wns` to spare. Push: the next period is
  `clock_period − setup_wns + guardBand`. Taking the whole slack back would land exactly on the edge
  the tool just reported, which is where estimation error lives; the guard band is what is left on
  the table on purpose.
- **Setup FAIL** — the design missed by `|setup_wns|`. Back off: the next period is
  `clock_period + |setup_wns| + guardBand`.
- **Both PASS** — the design closed *and* met the goal. There is no next strategy; the decision is
  that the goal is met.

Convergence is weighed between those: the goal-met clause first, then the `converge` block above over
the periods the earlier generations measured, then the clause's next period. The chooser file says
nothing about convergence — a clause sees one generation, and "successive generations stopped moving"
is a statement about several, so the pack declares it and the harness evaluates it.

The chooser is pack data and deterministic: no model takes part in it, and the same verdicts and
values always produce the same next period. It is referenced by id, exactly as this pack's judge
rules are, and the file it names — `choosers/timing-push.yml` beside `rules/` — states the three
clauses above as data a person can read and change without touching TypeScript. What this pack
chooses is *which* chooser runs and what guard band it binds, the lines above in `graph.yml`, because
the guard band is the pack author's judgement and not the chooser's. The decision record cites the
two verdicts and the observation it read, and carries the numbers it used, so a person can re-derive
the next period from the ledger alone.

### `timing-push` is a stand-in for a method, not the method

Say it plainly: **this pack's chooser does not converge on Design Compiler.**

The Setup PASS clause above asks a met period how much margin it had. Design Compiler does not answer
that question. It stops optimizing the moment the constraint it was given is satisfied, so every
period it meets comes back with a setup slack of exactly `0.00` — a statement that the constraint was
met, and not a measurement of anything. `clock_period − 0.00 + guardBand` is therefore one guard band
*looser* than the period that just passed, so a Campaign on this clause loosens the period every
generation and stops learning nothing. The step-3 acceptance on the reference site recorded precisely
that: six generations walking from 2.28 ns out to 2.53 ns, no convergence and no answer (D45,
`docs/validation/2026-09-10-step3-acceptance-attempt1-failed.md`).

The method that does work never reads the margin of a met period. It over-constrains on purpose — it
asks for one step tighter than it believes is possible — and reads the violation, because a violated
period is the one thing the tool states a number about: `clock_period + |setup_wns|` is the period
the design actually closes at, so asking for one step less than that brings the next generation back
to the same violation and the same request, which is convergence with the fact on record. The harness
ships that method beside this one as the chooser `over-constraining-push`, and the step-4 pack carries
it.

This pack keeps `timing-push` as it is. It is what the step-3 record was written against, and a
pack's method is the pack's to state: what is corrected here is the description, not the file.

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
0.05 ns of setup slack. HimaJudge found PASS on setup-wns-all-nonnegative, FAIL on
clock-period-at-most. The decision was …* — and finally the path the Run took, any Hard blockers,
and any cancel. So the file answers, without the ledger, the two questions a pack author is asked
about a Campaign that has finished: what did it learn, and why did it stop.

A person reads it in three places without going to the Site: the card's evidence drawer on an ended
Run, the `.md` route the drawer links to, and `/hima status <run>`, which names both paths.
