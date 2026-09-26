# Final HimaHarness component-integration acceptance

Date: 2026-09-26. This is the final acceptance for **Issue #52**. It supersedes the Wave 4 held-out
DTCO/PPA closure path. Issue #39 is historical and is not a dependency of this acceptance.

## Objective

The final acceptance proves that the HimaHarness capabilities developed in the current upgrade work
together through the product's human-facing path. It does **not** certify PPA benefit, timing closure,
clean signoff, labor saving, ROI or the scientific effectiveness of one optimization method.

The stable test vehicle is the already qualified Timing ECO method:

- Pack: `xtop-timing-closure@1.0.14`;
- method digest: `19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92`;
- sealed TEST Run: `run-ddabd488-f05c-44d6-9c9b-45abccaff226`;
- Site: `linglong-swerv28`;
- input design: the Site-bound SWERV28 Innovus checkpoint and source manifest;
- operator: the production-qualified XTop interactive binding for this exact Pack/Site/tool identity.

The Pack is a workload for Harness acceptance. Its setup/hold/DRC/connectivity result is evidence the
product must display truthfully, not an acceptance threshold.

## Scope correction

Issue #52 owns this component-integration acceptance. It does not require:

- a positive Fmax or PPA delta;
- a 5% improvement;
- a held-out DTCO design;
- custom-Cell final-database adoption;
- timing, DRC or connectivity cleanliness;
- customer ROI or labor-saving evidence.

A negative, unchanged, blocked or budget-limited Timing ECO result is acceptable when the declared
method ran correctly, the evidence is complete for the reached boundary, and HimaHarness presents
the result and limitation accurately.

The DTCO attempts remain immutable research and defect evidence. They are no longer the closure path
for #52. Issue #39 closes SUPERSEDED; future DTCO value research requires a separate objective and
budget.

## Preconditions owned by the integrator

The human-like test starts from a version-isolated acceptance kit with:

1. the exact packaged App and manifest identified in the tester manual;
2. the sealed Timing ECO Pack installed and passing its digest check;
3. the qualified `linglong-swerv28` Site and Permit already installed;
4. the administrator-qualified interactive binding already configured;
5. current Site/client/licence preflight complete, with no conflicting QuaLib/XTop client;
6. one writable private Campaign root and read-only golden inputs;
7. the DeepSeek credential inherited without printing or copying it.

First-time Site creation is not part of this final acceptance. Attempt 12's multi-root Site/Permit UI
finding is retained as a separate product defect. This acceptance must not bypass the installed Site's
Permit or alter golden inputs.

## Human-like execution authority

Claude Code Desktop is the sole human-like operator. It activates the installed
`/himaharness-human-like-tester` skill and performs the product journey through Computer Use:

- mouse and keyboard against the visible HimaHarness/Catsights window;
- ordinary Guide conversation and visible product controls;
- no direct HTTP, Ledger mutation, hidden `hima_execute`, headless live runner or shell-created Run;
- no duplicate Campaign when a Claude turn ends;
- one retained report/checkpoint/handoff on PASS, FAIL or BLOCKED.

The integrator may prepare the fixed test kit and read retained evidence. The integrator does not
operate HimaHarness concurrently with Claude.

## Required component journey

### 1. Launch and inventory

- Launch the exact packaged App through its delivered launcher.
- Verify the visible App version and isolated workspace.
- Ask HimaGuide, in ordinary user language, what HimaHarness can do and what the Timing ECO Pack
  needs.
- Guide must answer from installed inventory and current context, name the installed Pack and Site,
  distinguish known facts from missing information, and avoid claiming timing benefit.

### 2. Preparation and confirmation

- Select `xtop-timing-closure` through the visible Guide/product path.
- Guide reads the installed Site, Pack, input identities and Goal fields.
- Preparation completes without creating a Run.
- One visible, concrete confirmation creates exactly one Campaign, one persistent Run and one
  Campaign owner distinct from Guide.

### 3. Workspace and graph

- Open the Campaign workspace and Live Run.
- Inspect the reference graph, current execution state and at least two node details.
- Exercise graph zoom/pan and evidence/report navigation.
- Internal ids remain available for evidence drill-down while the primary explanation stays in
  engineering language.

### 4. Independent conversation and team

- Open a Side Talk or independent child session without changing Run ownership.
- Confirm Guide remains responsive while the Campaign owner works.
- Inspect one child task, its effective context/tools, transcript and candidate result.
- Candidate child output affects the Run only after the declared owner adopts it.

### 5. Controlled execution

- Run the admitted Timing ECO reference path for the bounded test generation.
- At the XTop node, use the qualified Operator child and typed interactive commands; raw Tcl is not
  sent through an unrestricted shell.
- Preserve single-writer state, command receipts, transcript, checkpoint and normal/known close.
- Downstream Innovus, StarRC and PrimeTime stages run only as declared by the Pack and available
  budget.

### 6. Human control and recovery

- Issue one pause or hold through the visible Guide/Run controls at a safe recoverable boundary.
- Confirm the request receipt, actual Run state and in-flight Job facts are distinct.
- Continue explicitly; an old summary or model message does not lift the hold.
- Switch conversation or reopen the App at a declared recovery point and confirm the same Run,
  owner, current facts and child history return without duplicating a Job.

### 7. Result and insight

- Open the produced timing/iteration report and its source evidence.
- Use the Data Insight/report view for at least one loaded-data selection or filter without launching
  a new Campaign.
- Guide explains setup, hold, endpoint and physical evidence, including unknown/missing/non-clean
  conditions.
- The Run reaches one declared terminal or bounded test state and produces a retained archive and
  value-measurement receipt where available.

## PASS criteria

The acceptance is PASS when all of the following are true:

1. the exact App, Pack, Site and Operator identities pass preparation;
2. Guide, Campaign owner, Side Talk and child contexts remain distinct;
3. one confirmation creates one Campaign and one persistent Run;
4. the visible graph and node/evidence drill-down reflect Runtime facts;
5. a declared child/Operator task runs under its effective scope and produces inspectable receipts;
6. pause/continue and recovery preserve authoritative state without duplicate effects;
7. the Timing ECO Pack executes through the bounded evidence boundary reached by the test;
8. reports, Data Insight and Guide explanations cite the same retained facts;
9. the final status is truthful and includes all material limitations;
10. Claude completes the GUI-only journey and writes a durable, independently reviewable handoff.

No numerical QoR direction is required. A regression in timing is not a Harness acceptance failure
when it is a valid business result produced and explained correctly. A missing report, false PASS,
permission bypass, duplicate Run/Job, broken recovery, unusable UI path or mismatched identity is a
Harness acceptance failure.

## Closure

- Close #52 on one independently reviewed PASS receipt for this matrix after confirming every prior
  #52 child is terminal.
- Close #39 SUPERSEDED as a legacy DTCO/PPA task; it does not own this acceptance.
- Keep #30 and #62 on their own authority; neither blocks #52.
- Track Attempt 12's Site/Permit UI defect separately; it does not prevent this fixed-environment
  integration acceptance.
