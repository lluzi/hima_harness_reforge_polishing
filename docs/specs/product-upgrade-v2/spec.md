# HimaHarness Product Upgrade v2

状态：ready-for-agent。依据为用户于 2026-09-14 确认的[产品升级访谈](../../product-upgrade-interview.md)。本规格描述待升级行为，不声明当前实现或产品验收已经通过。

## Problem Statement

真人试用表明，当前版本虽然具备 Pack、Site、Fabric、Ledger、Agent execution、知识归档和 Desktop 工作台等工程基础，却没有把这些能力组合成客户可以自然使用和信任的业务产品。干净启动后没有可用 Pack/Site；HimaGuide 回答产品问题时扫描代码；Pack 绑定 AES/TSMC28 和既有 Golden Flow；Campaign 前置准备被暴露为表单；运行图只显示已发生的线性状态；控制通知依赖浏览器发送；知识只是整份 Markdown；完整 DTCO 没有在 held-out design 上通过定制 Cell 最终 route 采用取得更高 Fmax。

用户需要的是一项业务能力：在现有 HimaHarness 架构、当前工具栈和开源模型上，安装透明 HimaPack，给出自己的 design 和 SSH Site，由 HimaGuide 完成 Campaign Preparation，再由可见 Campaign Agent 执行一个持久 Run；用户可另开 Side Talk，观察完整业务运行图，介入控制，并得到唯一变量为新增 Cell 的 Matched Comparison Fmax 结果。普通用户不维护 YAML、知识服务、内部参数或 Golden Flow。

## Solution

加深现有模块，不重构架构：通过 DSH `systemPrompt` seam 给 HimaGuide 稳定产品上下文；在现有 Pack contract/release 读取上增加作者状态、ontology、知识 manifest 和最低 Harness 版本；通过现有 `SshChannel`、Site schema 和 Permit 自动发现 safe Site；把 `startPreparation`、`startChoices` 和 `checkPack` 组合为不创建 Campaign 的 Preparation；复用 DSH 多 live Session 实现 Campaign Agent 与 Side Talk；使用已有 `executionContext.method.reference` 投影完整图；在 `KnowledgeRecord`、workspace、run-assets 和 Pack `knowledge/` 上加入离线文档知识；用同一 Pack 格式交付不绑定 AES design 的定制 Cell Fmax-DTCO Pack；最后集中执行一次 held-out design 的真实 Matched Comparison 和候选发布。

唯一新增的产品级能力是 HimaHarness 自带的离线文档到知识实现。它必须先通过隔离 POC 证明能在 macOS 发行环境中处理代表性 EDA PDF，并继续通过现有 Pack knowledge、Ledger 和 archive seam 提供内容；不得另建用户运维的知识产品。

## User Stories

1. As a chip design engineer, I want HimaGuide to explain what HimaHarness can do immediately, so that I can begin without reading a manual.
2. As a chip design engineer, I want product answers to come from stable product context and live inventory, so that the Agent does not scan unrelated source code.
3. As a coding user, I want ordinary conversation and coding to remain available, so that installing Hima does not narrow DeepSeek Harness.
4. As a new user, I want an empty installation to show actionable Pack and Site entry points, so that an empty list is not a dead end.
5. As a chip design engineer, I want to inspect a Pack before running it, so that I understand its business purpose, method, inputs, outputs, tools, graph and limits.
6. As a chip design engineer, I want to install one fixed Pack explicitly, so that its method cannot change through a hidden update.
7. As a Pack Owner, I want my original status and vocabulary preserved, so that Hima does not rewrite author intent.
8. As a Pack Owner, I want Hima ontology to normalize unclear terms for display, so that different Packs remain understandable.
9. As a maintainer, I want Pack status to have no Runtime effect, so that one execution path serves every Pack state.
10. As a user, I want a new Pack to state its minimum Harness version, so that an old Harness refuses it with one understandable dependency error.
11. As a user, I want newer Harness versions to run older Packs, so that product upgrades do not invalidate installed business capabilities.
12. As a user, I want a Pack to remain transparent after installation, so that methods, knowledge, rules and evidence can be reviewed.
13. As a user, I want to provide only SSH identity and limited hints, so that HimaGuide does the Site discovery work.
14. As a Site user, I want HimaGuide to reuse OpenSSH config, keys, agent and jump hosts, so that I do not duplicate credentials.
15. As a Site user, I want discovered host, tool, licence, path and capacity facts saved in a safe profile, so that future Campaigns reuse them.
16. As a Site user, I want changed Site facts marked stale, so that an old check cannot claim current readiness.
17. As a Site user, I want Full local permission to remain bounded by Site Permit and the deletion red line, so that Campaign safety survives broad DSH access.
18. As a Site user, I want system-readable inputs to be discovered automatically, so that I only answer real ambiguity or business choices.
19. As a chip design engineer, I want Preparation to finish before a Campaign exists, so that setup failures do not become failed business runs.
20. As a chip design engineer, I want a short Campaign proposal containing goal, design, Site, Pack, graph, tools and unknowns, so that I approve one concrete action.
21. As a chip design engineer, I want one confirmation to start a Campaign, so that I do not configure generations, retries and internal knobs by hand.
22. As a chip design engineer, I want changed Pack, Site or design inputs to invalidate Preparation, so that stale readiness cannot launch work.
23. As a chip design engineer, I want one Campaign to retain one persistent Run, so that retries, branches and recovery do not create management clutter.
24. As a chip design engineer, I want the Campaign Agent to be a visible conversation and sole Run owner, so that execution responsibility is clear.
25. As a chip design engineer, I want to open a Side Talk while a Campaign runs, so that long EDA work does not block ordinary conversation or coding.
26. As a chip design engineer, I want Side Talk to remain non-owner until explicit handoff, so that opening another session cannot steal control.
27. As a chip design engineer, I want application-level attention notices with an owner link, so that I can return when a Campaign needs judgment.
28. As a chip design engineer, I want closing the Live Run panel or switching sessions to leave the Campaign running, so that navigation is not control.
29. As a chip design engineer, I want exiting the App to stop new Agent decisions but preserve remote Job facts, so that restart can recover safely.
30. As a chip design engineer, I want pause, stop and handoff recorded before notification, so that UI delivery is not the authority.
31. As a chip design engineer, I want to see the complete reference graph before execution, so that I understand what the Pack can do.
32. As a chip design engineer, I want reference, growth, revision and actual state shown together, so that planned method and execution history remain distinct.
33. As a chip design engineer, I want hover/click details for nodes, so that inputs, outputs, tools, evidence and controls are available without page clutter.
34. As a chip design engineer, I want business status to dominate Live Run, so that hashes and internal IDs do not occupy the main view.
35. As a chip design engineer, I want code, terminal, knowledge, evidence and report accessible in the same workspace, so that review does not leave the Campaign.
36. As a user, I want Pack knowledge available offline after installation, so that I do not configure an external RAG service or key.
37. As a user, I want to add a PDF as current knowledge, so that HimaGuide can use material I provide without modifying the Pack.
38. As a user, I want current knowledge to survive restart and remain removable, so that temporary does not mean fragile or permanent.
39. As a Site user, I want private Site knowledge reached through a Site adapter, so that Hima can use it without creating a second knowledge product.
40. As a reviewer, I want every important knowledge use to name source, version and location, so that I can inspect how it influenced a decision.
41. As a customer, I want no design, document, conversation, log or debug material uploaded automatically, so that system permissions remain the data boundary.
42. As a support user, I want local evidence and debug files preserved and selectively exportable, so that problems can be investigated without default telemetry.
43. As a Pack user, I want the Fmax-DTCO Pack to accept a new RTL design and production inputs, so that it is a reusable capability rather than an AES replay.
44. As a Pack user, I want the Pack to name the current supported tool stack and a recommended version, so that compatibility is concrete without exact version lock.
45. As a Pack user, I want Golden Flow to remain authoring reference rather than required customer input, so that the Pack performs the difficult work itself.
46. As a chip design engineer, I want the Agent to form hypotheses, write or revise algorithms and react to evidence, so that the Campaign differs from fixed automation.
47. As a chip design engineer, I want the baseline and custom-cell arm to differ only by the new Cell, so that the comparison is credible.
48. As a chip design engineer, I want the new Cell present as an effective instance in the final route database, so that cell-level promise is tied to design adoption.
49. As a chip design engineer, I want final timing derived from that database to show higher Fmax, so that the business goal is measured at the right stage.
50. As a reviewer, I want other available PPA and physical facts reported without making them hidden success gates, so that the Fmax result has context.
51. As a reviewer, I want invalid constraints, failed route or mismatched database/report identity to block success, so that a faster number cannot conceal invalid work.
52. As a customer, I want a negative Campaign to leave useful knowledge but not certify product value, so that failure remains honest.
53. As a product owner, I want a positive held-out design result before the next trial, so that expert business-capability claims rest on actual capability.
54. As a maintainer, I want most regression coverage at L1/L2, so that development does not repeatedly launch Desktop, models or EDA.
55. As a user, I want Desktop validation performed on Catsights, so that testing does not interrupt normal work.
56. As a product owner, I want the team to remove low-level defects before my review, so that final sign-off can focus on judgment and product quality.
57. As a maintainer, I want every task tied to exact existing files and symbols, so that a second-tier model can implement it without rediscovering the architecture.
58. As a maintainer, I want shared wiring files to have one owner, so that parallel work does not create avoidable merge conflicts.
59. As a maintainer, I want each local commit pushed and remote SHA verified, so that parallel work is recoverable and reviewable.
60. As a product owner, I want macOS to be the only current Desktop target, so that Linux Desktop and other platforms do not expand this recovery scope.

## Implementation Decisions

### Fixed architecture

- Continue using the existing DeepSeek Harness Agent Loop, Session sidebar, permission presets, credentials and plugin seams.
- One visible Campaign Agent owns one persistent Run. Side Talk is an ordinary independent DSH Session; it is never a second Campaign executor.
- HimaFabric, Ledger, Judge, Jobs, Channel and Site Permit retain current authority. UI and knowledge indexes are projections or derived caches.
- Keep the current Pack directory/release form. A new Pack version is explicitly installed; no automatic update manager or second Pack Runtime is introduced.
- Preserve the existing reference graph and additive growth/revision semantics. No second graph engine or Campaign management system is introduced.
- Product model/base URL selection remains a DeepSeek Harness configuration concern.
- The only current Desktop target is macOS. Linux remains a remote EDA Site and future Desktop target.

### Exact code map

The `to-spec` template normally avoids paths; the user explicitly requires stable file-level mapping for this upgrade. These paths are fixed to baseline `2a1a311` and must be updated in the task before implementation if a prior task deliberately moves a symbol.

| Feature | Existing files and symbols | Required modification | Task |
| --- | --- | --- | --- |
| Product identity and inventory | `packages/harness/src/index.ts` `Hima[Service.init]`; DSH `systemPrompt.section/context`; `packages/harness/src/commands.ts:himaCommandDescription` | Register concise product identity and dynamic installed Pack/Site state; correct stale automatic-Fabric wording | PLS-27 |
| Pack ontology/status/version | `packages/harness/src/packs.ts:packContract/loadPack/loadPackFrom/checkPack`; `packages/harness/package.json` version | Add optional author status, ontology aliases, recommended tool/version metadata and minimum Harness version; compare ordinary forward-compatible versions; status never affects execution | PLS-28 |
| Pack install | `packages/harness/src/release.ts:installPackMethod/previewPackTransfer/applyPackTransfer`; `pack-folder.ts` snapshot/seal | Reuse preview/hash/install for a new fixed Pack; no update daemon or new artifact type | PLS-28 |
| Site discovery | `packages/harness/src/sites.ts:siteSchema/loadSite/installedSites`; `channel.ts:SshChannel/readOnlyProbes`; `shell.ts` Permit decisions | Add safe discovery result and saved profile, bounded direct probes and stale facts; preserve Permit and deletion red line | PLS-29 |
| Offline/current knowledge | `workshop.ts:knowledgeForWorkshop`; `ledger.ts:knowledgeRecord/appendKnowledge`; `experience.ts` knowledge/archive reads; Pack `knowledge/` | Add Pack knowledge manifest/index reading, current knowledge persistence and source-linked retrieval; keep Pack method digest and current documents separate | PLS-30 |
| Knowledge packaging | `packages/harness/package.json`, `packages/desktop/package.json`, `scripts/package-trial.mjs` | Package the selected offline parser/index/retrieval dependencies once with Harness/Desktop; no user-managed service | PLS-30, PLS-35 |
| Campaign Preparation | `index.ts:startPreparation`; `remote.ts:startChoices/registerHimaRoutes`; `tools.ts`; `paths.ts`; `client/api.ts`; `client/HimaWorkbench.tsx:StartRunForm` | Provide one Preparation result/proposal, invalidate on input identity change, keep advanced fields secondary, create no Run before confirmation | PLS-31 |
| Campaign Agent/Side Talk | `fabric.ts:executionContext/executionAction`; `tools.ts:hima_context/hima_execute`; `index.ts` `agent.followup`; `remote.ts:controlOperation`; `client/index.ts` sessions seam; `client/api.ts:controlRun` | Preserve single owner and explicit handoff; deliver control notifications from Host after durable state; reuse native New Session | PLS-32 |
| Complete graph UI | `client/HimaWorkbench.tsx:ExecutionTrace/RunSummary`; `client/HimaRunCard.tsx`; `client/workbench-style.ts`; existing `fetchExecutionContext` | Render `method.reference` plus growth/revision and actual status in the current pane; reorganize existing sections around current business decision | PLS-33 |
| Portable Fmax Pack | Existing `packs/aes-tsmc28-dtco/**` as source reference; planned `packs/custom-cell-fmax-dtco/**` in the same format | Extract design/process/Site bindings, retain current DC/LC/Innovus stack, include method/knowledge/tools and matched A/B route adoption without requiring Golden Flow | PLS-34 |
| Pilot/release | `scripts/live-check-dtco-pilot.ts`, `scripts/audit-completed-dtco-pilot.ts`, `scripts/package-trial.mjs`, `test/contract/trial-package.test.ts`, `docs/validation/pilot-release/**` | Use held-out design and rediscovered Site, run one L5 Campaign, preserve evidence locally, package and publish only after all gates pass | PLS-35 |

### Shared-file ownership

`packages/harness/src/index.ts`, `remote.ts`, `paths.ts`, `tools.ts` and `client/api.ts` are integration hotspots. One main integrator owns their final edits. Parallel tasks expose or test behavior in their domain files; the integrator wires those results in PLS-31/32. `HimaWorkbench.tsx` has one UI owner: PLS-31 finishes intake changes before PLS-33 changes graph/information architecture.

### Pack method identity

`packs/aes-tsmc28-dtco@5` remains historical evidence and a regression reference. The portable method is a new Pack folder in the same existing format, not a new product module. It must not use `aes_cipher_top`, TSMC28 paths or a customer-prepared Golden Flow as invariant method inputs. Pack-owned flow scripts may be copied into the Campaign workspace; Site bindings supply design, PDK/library, workspace and tool environment.

### Knowledge identity

Pack knowledge contains transparent source files, manifest and optional derived index. Harness owns the offline parser/index/retrieval implementation. Current knowledge is stored separately from Pack method bytes, survives restart within its workspace/Campaign scope and can be removed. Search discovers candidates; a read returns bounded source text and records source identity. The index is never evidence authority and can be rebuilt. Site-private knowledge may use a Site-provided adapter through the same user-facing interface; this spec implements only Hima-owned Pack/current knowledge.

## Testing Decisions

### Seams

1. **Primary product seam — L2 real Host.** Reuse `test/contract/support/boot-inprocess.ts` and `boot-host.ts`, the real `/hima/api` namespace and real `hima_*` tool definitions. This is the highest existing seam that exercises composition, storage, Agent identity and files without a window.
2. **Desktop seam — one necessary L3 path.** Reuse `test/contract/support/driver.ts`. Run only interaction behavior that cannot be proved through Host data: Pack/Site/Preparation entry, complete graph rendering, two live Sessions, owner navigation and control feedback. Every Desktop run and recording occurs on Catsights.
3. **Real-dependency seams — bounded L4.** Run a small DeepSeek call only after product context/knowledge tool schemas change; run one SSH discovery/minimum EDA probe only after Site/Pack adapters stabilize.
4. **Value seam — one L5 candidate.** The held-out design Matched Comparison is the only full DTCO/EDA Campaign in this spec. It cannot be replaced by replay, stand-in, AES history or Agent review.

### Minimal tests by module

| Module | Existing prior art | Minimum new evidence |
| --- | --- | --- |
| Product context | `agent-desktop-replay.host.test.ts`, `start-form.test.ts` | One L2 root Agent assembly/turn proving bounded product context and zero fs/search tool use for product identity |
| Pack | `pack.test.ts`, `pack-method-assets.test.ts`, `pack-owner.desktop.test.ts` | L1/L2 status/min-version/ontology/install cases; one L3 install/overview path only |
| Site | `site-name.test.ts`, `ssh.test.ts`, `ssh.live.test.ts` | L1/L2 draft/save/stale/refusal; one L4 real read-only discovery and minimal probe |
| Preparation | `start-form.test.ts`, `input-admission.host.test.ts`, `pack.test.ts` | One L2 identity invalidation matrix and one L3 proposal/confirm path |
| Owner/control | `agent-controls.host.test.ts`, `conversation-execution.host.test.ts`, `agent-execution.desktop.test.ts` | L2 stale owner/handoff/control states plus one L3 Campaign A + Side Talk B path |
| Graph/UI | `agent-graph.host.test.ts`, `growth.host.test.ts`, `growth-assets.desktop.test.ts`, `revision-assets.desktop.test.ts` | One L3 graph overlay path; no per-edge Desktop matrix |
| Knowledge | `knowledge-reuse.host.test.ts`, `pack.test.ts`, `experience-files.test.ts` | L1 parser/index fixture, L2 current knowledge restart/remove/hash path, one L4 real-model retrieval use |
| Fmax Pack | `aes-domain-stages.test.ts`, `aes-analysis.test.ts`, `aes-full-graph.host.test.ts`, `dc-reader.test.ts` | L1/L2 held-out-compatible Pack/check/report counterexamples before any EDA |
| Release | `trial-package.test.ts`, `scripts/audit-completed-dtco-pilot.ts` | One L5 Campaign plus package/hash/cold-start and user sign-off handoff |

All tests assert observable behavior through module interfaces. No test copies Fabric, parser, Pack or Site logic to generate its own expected answer. Every task runs the narrowest relevant files after one fresh build; the full local group runs at integration checkpoints, not after each edit. Passing, failing, skipped and unrun remain distinct.

## Out of Scope

- Rewriting HimaHarness, replacing DeepSeek Harness, introducing a second Agent Loop, graph engine, Campaign manager, permission system or Pack Runtime.
- Modifying `/Users/lluzi/code/hima_harness_reforge_claude` or `/Users/lluzi/code/himaharness`.
- Linux Desktop, Windows, macOS Intel, multi-user collaboration, organization/RBAC UI, multiple tool stacks, SaaS knowledge, automatic Pack updates or new proprietary EDA products.
- Requiring customers to provide a Golden Flow, a pre-run result, a knowledge service, internal YAML or complete manual configuration.
- Treating area, power or other PPA as success gates for the current Fmax Campaign; available values are still reported.
- Claiming a positive result from a synthesis-only metric, an invalid constraint, a failed route, a final database without the new Cell, a mismatched report/database or a non-held-out AES replay.
- Automatic upload of customer materials, telemetry, logs, reports or debug files.
- Repeating full Desktop, model or EDA validation for changes whose behavior is already falsifiable at L1/L2.

## Further Notes

The fixed code baseline for planning is `2a1a311519757a4fb6eb5ab46858e2e669ae0df2`. Later documentation commits do not change the inspected product code. Each task begins by confirming its named symbols still exist and records any deliberate movement before editing.

Routine implementation, integration and ordinary review use `gpt-5.6-terra` at medium effort. `gpt-5.6-sol` at high effort is reserved for Site Permit, owner/control, knowledge isolation and evidence truth review. Astra is not needed unless a reproduced gap proves the existing architecture cannot express a required behavior and the user separately authorizes an architecture change.

Each local commit is pushed immediately and remote SHA verified. Parallel tasks use explicit file ownership; shared wiring is merged by the main integrator. Product completion requires PLS-35 and the user's final sign-off, not merely closure of preceding engineering tasks.
