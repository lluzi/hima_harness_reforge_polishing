# HimaHarness

The domain language of HimaHarness, an AI harness that runs bounded exploration campaigns for chip design on a customer's own EDA infrastructure. Terms are added here the moment they are settled, and only then.

## Language

### Work

**Campaign**:
One goal-bounded engagement of a HimaPack on a Site: what an engineer starts, and what ends in facts whether or not the Goal is met.
_Avoid_: task, 任务, session, job

**Probe campaign**:
The per-day Campaign that observations taken outside any fabric Run belong to, named `probe-<date>`. It exists because a record must name a Campaign and HimaFabric does not yet create them; the first fabric Campaign replaces it, it is never a place to park real work.
_Avoid_: default campaign, ad-hoc campaign, scratch campaign

**Run**:
The single execution of a Campaign's graph instance, including every continuation after a restart or a cleared blocker.
_Avoid_: attempt, campaign (for this meaning)

**Job**:
One EDA or cluster job launched by a tool on a Site, with its own job ID and its own lifetime independent of any connection.
_Avoid_: run, task, process

**Loop**:
A solving loop inside a Campaign that observes, judges, and acts repeatedly toward the Goal. A Campaign may contain several, at different stages, as its pack defines.
_Avoid_: 路谱, iteration, cycle

**Generation**:
One turn of a Loop: the act nodes run once with one Strategy, judged, and decided. Counted from one inside its Loop; a revisit edge opens the next. Every record carries the Generation it was written in, and the Run row carries the one it is in.
_Avoid_: iteration, round, pass, epoch, trial

**Goal**:
One primary target plus its declared constraints, all typed and checkable by HimaJudge, stated without ambiguity and immutable for the life of a Campaign.
_Avoid_: objective, intent, target (on its own)

**Budget**:
A Campaign's allowances on the meters tied to the design and the EDA environment: time, EDA resources, parallel Job count, licences, and a Retry allowance per node. Model tokens and money are not budgeted.
_Avoid_: token budget, cost, spend

**Retry allowance**:
The number of attempts a node may make before its failure becomes a Hard blocker. Three by default, set per Campaign.
_Avoid_: max attempts, retries (unbounded)

**Hard blocker**:
A failure the harness cannot clear on its own after the Retry allowance is spent: an EDA tool or Site infrastructure problem, or a Hima tool the AI could not repair. The node keeps its state and resumes once a person clears it.
_Avoid_: error, exception, failure (generic)

**Self-repair**:
The AI patching one of Hima's own tools on the fly, inside its Permit, when a Site or report-format change breaks it, leaving a record of the change. Bounded by the Retry allowance.
_Avoid_: risk mode (for this), hotfix, workaround

**Risk mode**:
The broader authorization for the AI to repair Site infrastructure or HimaPack delivery problems on site, beyond Hima's own tools. Not in the first phase.
_Avoid_: self-repair (for this), maintenance mode

**Pack authoring pipeline**:
The sequence of HimaGuide skills that takes an author from plain-language description plus Golden Flow to a released HimaPack: grill, spec, fabric, test, release.
_Avoid_: wizard, generator, compiler (for the whole pipeline)

**Model moment**:
One isolated model session HimaFabric opens for one purpose at one node of one Generation and closes, with the instructions and tools of that purpose only, recorded on HimaLedger at open and close.
_Avoid_: chat, conversation, agent (for this meaning)

**Workshop**:
The scope on an act node where the AI writes and runs code: a directory under the Campaign workspace, a wrapper, the inputs and knowledge files it may read, and a declared output. Declared by the pack; what is written in one is run as a Job like any other.
_Avoid_: sandbox, scratchpad

**Code record**:
HimaLedger's record of one **version of one file** a Model moment wrote: its path on the Site, hash, size, language, and the node, attempt and session that wrote it. A moment that writes the same path twice leaves two code records and one file; what a face counts is files, and the launch gives the wrapper, as its first operand, the version the latest record hashes.
_Avoid_: patch, diff

### Place

**Site**:
The customer's EDA runtime environment that hosts a Campaign's Jobs, reached from the harness over HimaChannel. The harness itself runs on the engineer's own machine.
_Avoid_: server, cluster, environment (as synonyms)

**Golden Flow**:
The reference engineering flow a HimaPack is learned from and checked against: how the business runs in real tools on a real Site. Reference material, never the goal and never imported.
_Avoid_: the pack, the template, the baseline

### Fabric elements

**Act node**:
A node where a tool does something on a Site and reports what happened into HimaLedger.
_Avoid_: task node, action, step

**Judge node**:
A node where HimaJudge applies the pack's rules to HimaLedger data and chooses the outgoing edge. Branches converge back into a Judge node.
_Avoid_: decision node, gate

**Explore node**:
A node that opens a Loop with its own convergence condition, drillable into its own small graph.
_Avoid_: sub-workflow, child, scope

**Wait node**:
A node that needs a person or a cleared Hard blocker before the Run continues.
_Avoid_: pause, approval node

**Strategy**:
The knobs a Run is set to for one generation, and the thing an Explore node chooses anew. A Goal is what a Campaign is for; a Strategy is what it is trying right now. The knobs are the pack's, declared in its contract with a type, bounds or a list, a default and words.
_Avoid_: parameters, configuration, settings, goal (for this meaning)

**Chooser**:
The deterministic rule over HimaLedger values, shipped as data beside the judge rules and referenced by id, that an Explore node applies to pick the next Strategy or declare the Goal met.
_Avoid_: policy, planner, optimizer, heuristic

**Decision**:
What an Explore node's Chooser concluded, recorded with the numbers it used and citations of the verdicts and observation it read: the next Strategy, that the Goal is met, or that the exploration has converged.
_Avoid_: verdict (that is HimaJudge's), recommendation, plan

**Fork and join**:
Edge patterns, not node kinds: edges branch out so nodes run in parallel, and converge back into a Judge node. The Site's parallel job cap decides how many actually run at once.
_Avoid_: parallel node, split, merge

### Pack authoring

**Pack intent record**:
What the grill stage produces: the author's answers, the ambiguities resolved, and the Golden Flow pointers.
_Avoid_: notes, transcript

**Pack spec**:
One human-readable file with the goal template, constraints, run contract, semantics, judge rules, and knowledge references. What the spec stage produces.
_Avoid_: manifest, config

**Knowledge file**:
A plain Markdown file in a pack folder, named by the contract with its purpose, holding the domain knowledge a Model moment may read; the harness never reads it as data.
_Avoid_: prompt, documentation (for this meaning)

**Test record**:
The result of running a pack on a real Site against its Golden Flow. A pack without one is not releasable.
_Avoid_: fixture results, unit tests

### Components

**HimaPack**:
A sellable, portable method for one chip-design business: steps, report-reading tools, the semantics they produce, judgment rules, and domain knowledge, compiled into a run template that binds to any Site meeting its declared contract.
_Avoid_: plugin, package (generic), skill

**HimaGuide**:
The workbench where an engineer starts, watches, and cancels a Campaign, and where a pack author works. It shows what a Run reports and never holds Run state.
_Avoid_: UI, frontend, dashboard

**HimaFabric**:
The runner that owns a Campaign's graph and Run state: what the pack fixes, what the AI may choose, the shared Budget, revisit, recovery, and cancel. Built from a few basic elements with finite states and attributes.
_Avoid_: HimaRuntime, workflow engine, flowchart

**HimaGadget**:
The uniform system for registering, invoking, and reusing the small tools that act on a Site and read its reports into HimaLedger.
_Avoid_: scripts, helpers, utilities

**HimaLedger**:
The append-only record of node states and typed conclusions in business semantics, and the only data HimaJudge may read.
_Avoid_: log, database, event store

**HimaJudge**:
The role, isolated from the executor, that applies a pack's rules to HimaLedger data and decides how a node continues.
_Avoid_: HimaGate, approver, validator

**HimaChannel**:
The warm SSH channel from the harness to a Site, through jump hosts where needed. Its liveness is not Job liveness.
_Avoid_: connection, tunnel, mount

**HimaShell**:
The constrained execution environment that keeps the agent and its tools inside their Permit on a Site.
_Avoid_: terminal, sandbox (unless verified), shell (generic)

**Permit**:
The editable file that states what the agent may do on a Site: where it may write, which wrappers it may run, and what is off limits. Encodes the Site owner's operating rules.
_Avoid_: policy, ACL, sandbox config

**HimaMind**:
The domain knowledge that takes part in planning, analysis, and judgment moments of a Campaign.
_Avoid_: RAG, lookup, memory (generic)

**HimaExperience**:
The organization's archive of Campaign experience: technical reports of facts and reasoning, owned by the org and linked to their source pack.
_Avoid_: knowledge base (generic), logs
