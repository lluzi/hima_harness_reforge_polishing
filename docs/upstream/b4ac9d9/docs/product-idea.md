# HimaHarness Product Idea

Status: v0.2, 2026-09-08, grilled and agreed. The codex baseline v0.3, the Q1–Q39 interview, and the three prior repositories were inputs, not constraints. The decisions behind every claim here, with their reasons, are in [product-decisions.md](product-decisions.md). Terms are defined in [CONTEXT.md](../CONTEXT.md). Engineering decisions that are hard to reverse live in [docs/adr/](adr/). Decisions fixed before writing: DeepSeek Harness is the host and the ecosystem from day one; an exploration campaign is the first path; this is a vendor product for many customers; one builder plus AI agents, first customer-visible result in about three months.

## 1. The user and the outcome

The first user is a DTCO or back-end engineer at a customer that owns its EDA cluster, PDK, and licences. They have a design, say an AES block on TSMC28, and a question the standard flow cannot answer in an afternoon: would custom cells or a different strategy buy 5% Fmax, and which ones? Today that costs weeks of scripting and serial trials, and the knowledge leaves with the engineer.

With HimaHarness they pick a pack, confirm the goal, inputs, and budget, and start a campaign. It runs on their cluster for hours or days, survives them closing the laptop, explores only inside the pack's method, and ends in one of two honest states: goal met with evidence, or goal not met with evidence and a grounded explanation. Both leave a fact chain the organization keeps: what ran, what was measured, what was judged and why. Every number came from a tool reading a report. Every verdict came from a role that did not run the job. A goal is never widened to manufacture a pass.

The buyer is the R&D lead or CAD owner. Their outcome is throughput and retained knowledge when people move on.

Product success in three months: one such campaign watched end to end, on a real site, by someone who did not build it.

## 2. What HimaHarness is

HimaHarness runs bounded exploration campaigns for chip design on the customer's own infrastructure, with the customer's chosen models. A campaign is a goal with its constraints, a budget, a site, and a pack. The budget has four meters, all tied to the design and the EDA environment: time, EDA resources, how many jobs may run in parallel, and licences, plus a retry allowance per node. Model tokens and money are not budgeted, because customers run their own models on their own servers. A HimaPack is a sellable, portable method: the steps, the tools that read reports, the semantics those tools produce, the judgment rules, and the domain knowledge, compiled into a run template that binds to any site meeting its declared contract. The harness runs the pack's graph, lets the AI choose and branch inside the method, appends every fact, and hands verdicts to an independent judge. The vendor sells packs and the platform. The customer keeps its facts and its experience.

HimaHarness is built on DeepSeek Harness and is part of its ecosystem, not merely hosted on it. Any DeepSeek Harness plugin is available to a campaign, and that includes AI coding plugins. So HimaHarness is not sold as a coding tool, but it codes. When an exploration node needs a script, a report parser, or a small tool that does not exist yet, the AI writes it and runs it through those coding capabilities, inside the pack's permitted tool scope and inside HimaShell. Creative and exploratory chip-design work needs this, and it is a first-class ability, not an exception.

## 3. How a campaign runs

Six parts, in the order a campaign meets them.

1. **HimaGuide, the workbench.** The engineer opens a project, picks a pack, confirms goal, inputs, and budget, starts the campaign, watches it, and can cancel it. It shows what the run reports. Run state lives in the fabric, never in the workbench, so closing the browser changes nothing about the campaign. In this phase it is the DeepSeek Harness web profile with a Hima module inside it.

2. **HimaPack plus site binding.** The pack ships a compiled run template and a run contract: inputs, outputs, how they are accessed, what runs, and what the environment must provide. CAD fulfils the contract the way they would a requirements file. Binding checks the site against the contract and yields the actual run graph. The customer never has to reconstruct the method; they meet the contract and bind.

3. **HimaFabric, the runner.** Fixed by the pack: the steps, the gates, what data to collect, and the judgment criteria. Free to the AI: direction after a verdict, creative work inside a node including writing and running code on the fly, and new branches and loops. The main graph stays at business granularity. An exploration node drills down into a small solving loop with its own convergence condition, and a campaign may contain several such loops at different stages, as its pack defines. However complex the fabric gets, it is built from a few basic elements whose states and attributes are finite; the connections between them carry the business logic. Four node kinds are enough: act, judge, explore, and wait. Edges branch out so nodes run in parallel and converge back into a judge node, and the site's job cap decides how many actually run at once. All of it stays inside the fabric, on one shared budget, with prior facts preserved on any revisit. If the host restarts, the fabric finds its cluster jobs again from its own logs and job IDs and carries on.

4. **HimaGadget to HimaLedger to HimaJudge, the trust chain.** Tools read reports and emit typed semantics. A WNS is a number with a mode, a path scope, and a unit, never a bare figure. The ledger records them. The judge, isolated from the executor, applies the pack's rules to ledger data only: every pass or fail comes from a deterministic rule, and a model may add only the qualitative findings the pack declared as judgment calls. A claim made in chat is not a fact.

5. **HimaChannel plus HimaShell, the hands.** A warm SSH channel reaches the customer's cluster through jump hosts. The harness itself runs on the engineer's own machine and the EDA jobs run on the site, because that is how chip design works today: nobody runs Innovus on a laptop. A dropped connection does not kill a running job; the two lifetimes are kept separate on purpose. A constrained execution environment keeps the agent inside a permit, and the permit is a plain file the site owner can read and edit, encoding the site's own operating rules.

6. **HimaMind plus HimaExperience, the memory.** Pack knowledge feeds planning and judgment moments. Campaign facts are written up as a technical report the organization owns, facts and reasoning together, reusable across packs with environment differences stated, not hidden.

When a node fails, the fabric retries within that node's retry allowance, three by default and set per campaign. Failures in EDA tools or site infrastructure, which Hima cannot change, become hard blockers once the allowance is spent. Failures in Hima's own tools are Hima's to fix: the AI may patch the tool on the fly inside its permit, leaving a record, and only after that fails does it become a hard blocker. A blocked node keeps its state and resumes when the blocker is cleared.

Two rules hold regardless of host. HimaHarness owns its own approval and judgment semantics, because the reforge lost its brake the day the host owned approval. And no Hima component is designed against a DeepSeek Harness interface until that interface has been exercised on a running host, because the reforge's fakes were written from the same documentation as its code, so its tests passed while the real host failed.

## 4. The first path and the three-month cut

The first path: a DTCO or back-end engineer starts a cell-mining and Fmax-push campaign on the AES block on TSMC28 from the workbench, walks away, and comes back to a judged result and a fact chain. The site is our EDA server standing in for a customer site, and it is the only combination on that site where every loop of this campaign can run. The Golden Flow is the legacy cell-mining and autonomous-Fmax material, learned from, never ported. The site's toolchain moved to newer releases after the reference runs, so some commands will change, and fixing them is the first real exercise of self-repair.

In scope for three months: one pack, one site, one campaign type, and the minimum of every component that path touches.

- **Guide:** start, observe, cancel, and the authoring pipeline below.
- **Pack:** run template, run contract, binding to one site.
- **Fabric:** the exploration graph with drill-down loops, parallel branches, shared budget, revisit, reconcile after restart, cancel.
- **Gadget:** only the report readers this pack needs, with self-repair.
- **Ledger and Judge:** complete for this pack's semantics, nothing more.
- **Channel and Shell:** one cluster, one permit file, actually enforced.
- **Mind:** the pack's knowledge present at planning and judgment moments.
- **Experience:** one campaign's technical report, readable by machine and by people.

The first pack is authored the way every pack will be: the author describes the business in plain language and points HimaGuide at the Golden Flow, and HimaGuide carries the work through a skill pipeline in the spirit of Matt Pocock's skills, one skill per stage. Grill the author until the intent is unambiguous. Turn the answers into a pack spec. Compile the spec into the fabric. Test the pack on the real site against the Golden Flow. Release it. A pack is a folder of plain files its author can read. The builder is the first author, and the pipeline is the first thing that has to hold up, because it is the differentiator.

Out of scope until this path is proven: the public pack source and release flow beyond a local release, multi-site binding, a second pack, risk mode in its broad sense of touching site infrastructure or pack delivery, ontology-formal experience, packaging and signing the desktop shell (the shell itself exists and is the product's only delivery form, D39), and multi-user authorization.

How the cut gets built: lean on the DeepSeek Harness plugin ecosystem for everything that is not Hima's own semantics. The agent loop, tool calling, session storage, the web shell, coding tools, MCP bridging, and similar pieces come from DeepSeek Harness or its plugins rather than being written again. Custom code is reserved for what only Hima can define: the fabric's graph language, the ledger semantics, the judge, and the pack contract. Reuse is checked against a running host, not a README. Code from the prior repositories is studied, never imported, so the development context stays aligned and carries no integration debt. This is how one builder ships in three months.

What must be observed, in this order, each on the real server:

1. **Trust chain on real data.** One tool reads one real report into the ledger and the judge returns a verdict, inside a booted DeepSeek Harness host.
2. **One generation.** Synthesize, read, judge, choose the next strategy, as a fabric graph, surviving a host restart and a cancel.
3. **The campaign.** Multi-generation exploration with drill-down, parallel branches, budget, and convergence, packaged with contract and binding, experience written.
4. **The proof.** Someone who did not build it runs it end to end from the workbench.

Each step is a customer-visible behavior, not a component. A step that cannot be observed on the real server is not done.

## 5. What HimaHarness refuses

It is not a PPA optimizer that promises numbers. It never widens a goal to manufacture a pass, never treats chat output as a fact, and never reports an old run's result as a new one. It does not ask a human to approve a conclusion the evidence already supports. It asks only when a tool has no way forward after its retries or a permission blocks it. It does not require a customer to copy the reference site's paths or style. And it does not add a check, gate, or governance document that does not protect against a failure someone has actually observed. The prior repositories accumulated ceremony faster than evidence.

## 6. Accepted risks, named rather than dissolved

- **DeepSeek Harness** is a developer preview that promises compatibility-breaking changes and states no versioning policy. In one week its agent, session-log, system-prompt, and commands interfaces changed while tools, approvals, skills, presets, storage, and the bundle format did not. Durable jobs, approval memory, and judgment are Hima plugins by design, so they are Hima's responsibility. The churn is handled by using the stable seams directly, wrapping only the seams that moved, and re-proving every seam on a booted host at each bump; that boundary is ADR-0001. Plugin names go to the DeepSeek API by default and one config row turns that off, but an anonymous id and user-agent still travel with every request, which customers must be told.
- **Solo builder.** Scope is one path, and the DeepSeek Harness ecosystem carries everything that is not Hima's own semantics. Every document stays reviewable in one sitting. The proof step needs a second person, to be named before month two.
- **Exploration first is the hardest path,** and both prior repositories stalled on it. The one-generation step exists so the inner loop is proven before any multi-generation work.
- **A converging multi-generation loop has never been demonstrated.** Of the legacy's 603 runs, the finalized ones all met their target in the first generation, and the only two that truly looped ended with the target not met and the planner exhausted. Step 3 (D45, 2026-09-10) ran a six-generation Campaign on the reference site from the workbench window with every fabric element in play, and it did not converge either: the reference pack's chooser loosened the period on a tool that reports zero slack when met. The harness is no longer the open question; the pack is. Step 4 is where a pack with real exploration and DTCO knowledge is authored and run, and a converging Campaign is what it must show.
- **Physical design has no oracle.** A passing judge proves the pack's criteria were met, not that the PPA is good. The criteria are the pack author's responsibility and are visible in the pack.
- **The reference material is fragile.** The legacy autonomous-Fmax package exists only as an untracked working tree, and the legacy runtime's store lives on one laptop. Both are archived, hashed, before anything else.
- **Customer models may not carry high-level reasoning.** The base flow must not depend on it. Pack knowledge fills the gap, and the effect is measured, never promised.

## 7. How we know it is real

Every claim in this idea is either observed on the real server or marked unproven. The four steps in section 4 are the acceptance ladder. Each step yields the run's fact chain, the judge's verdict with the ledger records it used, the budget consumed, and a note of what was skipped or failed. No fixture demo counts. No historical result counts.

This idea does not prove, and does not claim, architectural superiority, efficiency gains, model baseline lift, cross-site compatibility, or long-run stability. Each of those needs its own experiment with a baseline, a fixed metric, and a stopping rule.

## Inputs

- Baseline v0.3, interview Q1–Q39, glossary, constitution: `/Users/lluzi/code/hima_harness_reforge_codex/` (`docs/product-definition.md`, `docs/product-definition-interview.md`, `CONTEXT.md`, `docs/engineering-constitution.md`).
- Postmortems, all under `/Users/lluzi/code/`: `himaharness/docs/retrospectives/2026-07-27-hima-harness-phase1-phase2-retrospective.md`, `hima_reforge/docs/w4-exit-record.md`, `hima_harness_reforge_codex/docs/research/2026-09-07-prototype-investigation/README.md`.
- DeepSeek Harness architecture research: [research/2026-09-08-dsh-architecture-and-integration.md](research/2026-09-08-dsh-architecture-and-integration.md).
