# [PLS-35] HimaHarness 组件集成终验

> **现行验收（2026-09-26）：** 本任务不再要求定制 Cell、正向 Fmax、5% 改善或 PPA/ROI
> 证明。使用已 seal 的 `xtop-timing-closure@1.0.14` 作为稳定真实 workload，由 Claude Code
> Desktop 仅通过 Computer Use，在 HimaGuide 指导下验证 Preparation、单 Campaign/Run/owner、
> Live Run、Side Talk/child、typed Operator、暂停恢复、Memory、报告/Data Insight 与诚实终态能够
> 协同工作。Timing ECO 的数值方向不是 PASS 门。完整现行标准见
> [Final HimaHarness component-integration acceptance](../../../assessment/2026-09-26/next-stage/final-harness-integration-acceptance.md)。
> 下文原 held-out/PPA 规格作为历史范围与 DTCO 研究证据保留，已不再控制本 Issue 关闭。

状态：in-progress; first clean L5 reached only +0.193%, so the release gate is reopened for the bounded post-route feedback Campaign and 5% target
父规格：[Product Upgrade v2 / #30](https://github.com/lluzi/hima_harness_reforge_polishing/issues/30)
Issue：[PLS-35 / #39](https://github.com/lluzi/hima_harness_reforge_polishing/issues/39)
方法论设计：[Library Function Richness Optimization Framework](../library-function-richness-optimization-framework.md)
模型：主集成 `gpt-5.6-terra` / medium；最终证据审查 `gpt-5.6-sol` / high
最低测试：受影响 L0–L3 + 有界 L4 + 单次 L5 + 用户最终签收

## 用户场景

团队从干净 macOS发行物开始，不读手册、不使用开发者私有 Home，安装正式 Pack，从 SSH发现真实 Site，为明确的 `aes_cipher_top` 完成 Preparation、Campaign、Side Talk、完整图与控制。逻辑综合和探针必须以显式 reg2reg path group 施加优化压力；定制 Cell最终route采用并获得更高Fmax后，才交给用户本人签收。

## 当前证据

- `v0.2.0-trial.1` 保留为历史 prerelease，但真人试用判定产品失败。
- 当前正式 AES Campaign是有证据的负结果，前三路selector有输入结构错误，不能作为正向价值证明。
- `scripts/live-check-dtco-pilot.ts`、`audit-completed-dtco-pilot.ts`、`package-trial.mjs`和 `docs/validation/pilot-release/` 已有真实验证/打包骨架。
- 当前 Desktop/Pack/Site/Run历史只能作为 prior art，不替代本任务新候选证据。
- 2026-09-15 首轮统一 47-Cell L5 最终route保留250个定制Cell实例，但 matched Fmax仅从
  1923.076923 MHz提升至1926.782274 MHz（约+0.193%），远低于5%目标。其post-route
  reg2reg WNS为-19 ps，CTS仍混用普通BUFF。该结果是下一代研究输入，不是发布通过。
- 第一轮 iterative L5 已证明 DCCK-only CTS 与第二代 graph revisit，但第一代 Fmax 为
  `-0.179211%`，第二代因 Innovus `flop2flop` 标签适配和旧 100 分钟测试外层硬截止而被安全
  取消。两项均已在最低层重现并修正；取消的 Run 保留为负面集成证据，不计作目标结束。
- 第二轮 iterative L5 的六条 post-route 分支全部通过，形成21个保留候选加7个新候选；随后
  generation发现碰撞后缀把`sha256:`冒号带入candidate ID。三个bounded attempts均在layout/DC前
  被拒绝并安全取消。后缀已改为identifier-safe并有直接反例测试；该Run同样不计作目标结束。

## 固定代码范围

- 产品代码不在本任务顺手修改。发现缺口返回 PLS-27～34对应模块，以独立修复/测试提交合入后重跑受影响门。
- `scripts/live-check-dtco-pilot.ts`：适配新 Campaign/Pack身份和最少L5步骤。
- `scripts/audit-completed-dtco-pilot.ts`：审计 proposal、owner/Side Talk、graph、A/B唯一变量、adoption、database/report和Fmax。
- `scripts/package-trial.mjs`、`packages/desktop/package.json`、`test/contract/trial-package.test.ts`：打包自带runtime/Pack入口和冷启动。
- `docs/validation/pilot-release/`：新增候选目录，不改写旧证据；本地私有 Site/凭据/材料不提交。
- GitHub Release：保留旧 prerelease；先准备本地候选和可审阅 draft，用户最终签收后才发布新的 trial。

## 保持项

- 不在验收任务中顺手修改产品模块；缺口返回其原所有者和最低测试层修复。
- 不改写旧 prerelease、AES Campaign、失败记录、客户输入或已保存现场证据。
- 不将 replay、stand-in、Agent 代操作或准备好的私有 Home 当作真人产品通过。
- 不上传 Site、design、模型凭据、日志、报告或 debug 材料。

## 精确执行

1. 绑定 Site 上真实 `aes_cipher_top` RTL，记录完整输入身份和 hash；portable Pack 仍不得把 AES 名称写成自身方法不变量。
2. 从全新 DSH/Hima user-data开始，安装/读取 Pack，不使用预准备私有 Home。
3. 仅从 SSH/jump/账号和少量提示发现第二 Site；验证其与 Pack的能力等价，不复制原 Site YAML。
4. 由 HimaGuide完成 Preparation，所有必要条件 ready后生成 proposal并一次确认创建一个 Campaign/Run。
5. Campaign Agent执行；另建 Side Talk完成普通Coding/对话并返回owner；验证pause/cancel/handoff和关闭pane不改变事实。
6. 运行完整定制 Cell方法。Matched A/B除新Cell/library content外，RTL、约束、工具、核数、流程和设置一致。
   本次研究把多种方法给出的等价候选合并，按 AI 的统一 best-first 排名生成最多 50 个不同布尔/接口类并装入一个库，随后只用一对 50% uncertainty DC筛选采用；报告实际采用的 Cell、实例数及其来源方法。采用为零时停止，采用为正才进入一对PNR。
   第一代从DC probe挖掘；未达到5%时，后续代从上一代generated final-route netlist与最多100条
   post-route reg2reg path继续挖掘。按去索引后的beginpoint/endpoint family识别同类timing graph
   区域，保留最多25个实际采用最强的旧候选，其余槽位由新候选填充。每代仍只有一个公共库、
   一对DC和一对APR，最多四代。
7. 验证route成功、最终database含新Cell有效实例、timing读取同一database、自定义臂Fmax更高；其他PPA如实报告。
8. 归档算法、代码、输入身份、图、Jobs、知识引用、database/report身份、结果和debug现场；默认不上传客户内容。
9. 完成受影响L0–L3、知识/模型与Site L4、单次L5；通过/失败/未跑分开。
10. 打包、冷启动、hash和重启读回通过后准备本地候选与 draft release，提交试用说明和用户签收入口；用户本人确认后才发布trial。

## 验收标准

- 用户不看手册即可理解产品、Pack和下一行动。
- 安装内容非空，Pack/Site/Preparation都可由产品完成。
- 本次验收的实际 top 是 `aes_cipher_top`；任何其他 top 的结果只能算 off-target 诊断。
- DC probe、mining 和 matched synthesis 使用显式 reg2reg path group；probe 在目标 period 保留 `-0.1 ns` 或更差 WNS，不能向零 violation 放宽，I/O violation 不能代表 Fmax pressure。
- 一个Campaign只有一个Run和一个owner，Side Talk不阻塞也不夺权。
- 完整参考图、实际状态、代码、知识、evidence和report可达。
- 新Cell是A/B唯一变量；一次公共 DC→APR 验证中的最终route database实际采用它，结果Fmax更高。不得为每种挖掘方法复制验证链。
- 两臂APR使用25% period uncertainty再加固定50 ps；CCOpt只能使用Site声明且以DCCK开头的
  buffer/inverter。最终routed netlist中的每个`CTS_`实例都必须通过该白名单审计。
- 当前Campaign的发布目标是matched post-route Fmax提升至少5%。较小正收益继续形成下一代输入，
  只有预算、四代上限或有证据的收敛才能诚实结束，不能将小收益写成目标完成。
- route/constraint/database/report身份通过 `comparison_valid`；setup、hold、route DRC、connectivity和cell-only checker结果单独披露，不把对foundry臂同样出现的诊断误报成生成Cell失效，也不宣称physical signoff clean。
- 团队在交付前修复所有主路径/低级问题；只允许定义内的少量trial缺陷。

任一门失败时不发布trial；保留失败证据并回流所属任务。负结果可以成为知识，但不能满足本任务正向产品价值门。

## 测试与成本

- 受影响L0/L2按各任务文件选择；只在整合checkpoint运行一次完整 `pnpm run check:local`。
- Catsights L3只跑：干净入口/Pack/Site/Preparation、Campaign+Side Talk、完整图/控制、报告/知识读回。录制集中一次。
- L4模型、Site/tool各做一次最小验证；模型配置沿用DSH。
- L5完整EDA Campaign只在 AES top、目标 path-group、综合采用和固定物理条件的低层门全部通过后运行。若失败，先在最低可复现层修复，不重复整套直到根因解决。

## 回滚与交付

候选发布以固定commit、Pack digest、软件/Pack版本、Site能力、design输入和SHA清单为身份。回滚到上一个候选不删除新Campaign或现场证据。所有commit立即push并核对remote SHA；最终用户签收与Agent/团队验收分开记录。
