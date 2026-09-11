# 分级测试方案

日期：2026-09-11。状态：方案已由用户明确接受，PLS-01 已实现 local/desktop/live-site 显式文件分组与隔离，见 [测试入口](../test/README.md) 和 [本次验证](assessment/2026-09-11/pls-01/README.md)。导入快照上的历史子集结果见 [本地基线](assessment/2026-09-11/local-baseline/README.md)。原则是用能够推翻该行为的最低成本测试覆盖组合，再保留必要的真实集成验证；桌面自动化、真实模型、EDA 和人工研究验收各自证明不同的事。

## 当前可复用的入口

- [boot-inprocess.ts](/Users/lluzi/code/hima_harness_reforge_polishing/test/contract/support/boot-inprocess.ts:28) 启动真实 dsh 插件树，可不带 web app。它是实际 Host，不是自建模拟器。
- [boot-host.ts](/Users/lluzi/code/hima_harness_reforge_polishing/test/contract/support/boot-host.ts) 通过与桌面共享的 launcher 启动真实 dsh 子进程，HTTP 可检验会话、路由和输出。
- [driver.ts](/Users/lluzi/code/hima_harness_reforge_polishing/test/contract/support/driver.ts) 操作真实 Electron 主进程、页面、表单、点击和渲染结果；不需要让视觉 AI 为每个回归用例逐步操作。
- 现有 local Site、stand-in flow、真实报告副本及 hash 清单，可用于离线/本地验证；模型 replay 仍在未合入 #59 分支，现有 fixtures 明确为手写机制替身，不是已录制的真实研究。

原型 [ADR-0004](/Users/lluzi/code/hima_harness_reforge_polishing/docs/upstream/b4ac9d9/docs/adr/0004-desktop-driver-as-the-test-seam.md) 让 Step 3 经 driver，是为了补足真实窗口证据。用户现在要求降低日常测试成本；polishing 的决定是保持窗口真实性，让非窗口行为在已有低层接口得到充分验证，见 [已接受 ADR](/Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0005-tiered-tests-on-existing-interfaces.md)。

## 六个验证层级

L0–L5 是测试分类，不是新增产品组件，也不沿用旧 himaharness 的复杂接纳流程。

| 层级 | 用什么验证 | 主要覆盖 | 什么时候运行 | 不能据此宣称 |
| --- | --- | --- | --- | --- |
| L0 静态与构建 | 现有类型检查、schema/引用检查、seam check、构建 | 拼装、类型、契约声明、构建与依赖问题 | 每次相关改动 | 业务正确、UI 可用 |
| L1 纯逻辑 | 真实函数/模块接口 + 小输入、独立期望值 | parser、判断、策略算术、参数边界、纯数据投影等组合 | 修改相关语义时高频运行 | dsh 集成、持久化、窗口行为 |
| L2 真实 Host/本地闭环 | 真实 dsh、Hima 模块、临时存储与文件、本地 Job；命令/HTTP | Run/记录、预算、retry/recovery、hash、权限拒绝、API；未来增长/归档机制 | 每个切片的主力回归 | 真实模型研究能力、真实 EDA、桌面视觉正确 |
| L3 桌面关键路径 | 现有 Electron driver + local Site，必要时 replay | 冷启动、登录会话、表单/点击、刷新、取消/恢复、关键渲染与错误、桌面生命周期 | UI/桌面改动时；每个 pilot checkpoint 的小集合 | 开源模型能完成研究、真实工具结果有效 |
| L4 真实依赖验证 | 分开运行小规模真实模型检查和真实 Site/工具检查 | 模型/工具接口、脚本生成与实际执行、SSH/wrapper/报告格式差异 | 对应 prompt、知识、工具、Host seam、Site 绑定变化时 | 完整 DTCO Campaign 或长期效果已经验证 |
| L5 完整 pilot 与使用验收 | 实际模型 + 真实 Site + 完整 DTCO；桌面主路径与资深工程师复核 | 真正的研究闭环、知识资产、用户控制与端到端价值 | 能力齐备的候选里程碑；相关实质变化需要再证实时 | 未测试设计、Site、版本或普遍 PPA 收益 |

L0 的静态检查与构建可以分别计费/运行；构建不应在同一轮各测试组之前重复做。运行基于 `lib/` 的测试前必须有对应源码的新构建；不能为节省成本测试旧产物。

初始反馈预算目标：**日常 L0–L2 相关子集在 3 分钟内，关键 L3 子集在 5 分钟内**。这是待 P0 校准的目标，不是实测结果，不靠删掉必要验证或跳过失败来满足。依赖安装、冷启动、重复运行和完整套件分别计时。

## 桌面产品不要求每个断言都点窗口

例如一组策略参数边界，可以在 L1/L2 遍历全部有效/无效输入，L3 保留典型合法提交和非法提示，证明真实表单传值及显示正确。报告 hash、结果投影、状态转换同理：组合在低层充分测试，窗口只验证用户真的能看到和操作关键状态。

具体保留的真实窗口内容包括：

- 从准备好的空 home 启动；桌面正确显示 Host 启动失败。
- Pack/Site/策略表单的真实输入、提交、错误与对应 Run 身份。
- 运行中刷新、用户取消/继续和可行动的状态说明。
- 报告/证据与代码查看入口，页面所见与 Host 事实一致。
- 真实窗口的焦点、滚动、键盘、尺寸与视觉可读性；交互改动时对应验证。

人工或视觉 AI 的使用体验检查集中在 checkpoint 和候选版；不能把所有 GUI 问题都交给 HTTP 检查，也无需为数值或状态的每个组合重新走完整桌面流程。

## 真实依赖分开验证

**模型侧：**先用 replay/受控输出验证记录、工具范围、失败和恢复机制；改变 prompt、知识注入或工具 schema 时，再用 DeepSeek V4 Flash 做小而真实的任务。检查可执行产物、行为边界与结果，不断言模型必须说某句固定话。手写 replay 只证明机制；真实录制也只证明该次协议路径，研究质量仍需真实任务。不能由 replay 通过推出“AI 已经会研究”。

**Site 侧：**先进行只读环境/真实报告检查，必要时运行一项最小真实工具作业，再运行完整探索。不为 UI 布局修改重新启动一整轮 DC/Innovus 研究。Site/工具变化造成的差异要反馈到本地样本和 stand-in 的适用边界。

已有教训是 Step 3 的旧 stand-in 对满足约束的情况给出正 slack，掩盖了参考 chooser 在实测零 slack 下的行为。替身需要与真实数据校准，不能用一个理想化世界证明产品。不同设计和工具行为不由单个样本外推。

## 每种改动触发哪些层

| 改动 | 最少需要检查 | 升级条件 |
| --- | --- | --- |
| 文字、布局、视觉反馈 | L0 + 对应 L3；不为纯文字变化新增镜像测试 | 改到交互传值、数据投影时补 L2 |
| parser、规则、参数校验 | L0/L1 + 至少一个真实 Host 集成路径 | 新工具/格式需要新的真实报告或 L4 Site 证据 |
| Run、预算、回溯、增长、恢复 | L0 + 可适用 L1 + L2 场景矩阵；用户控制入口保留 L3 | 改到远程作业语义需 L4 Site；改变完整研究行为需 L5 |
| 归档、复制、升级、hash | L0/L2 的真实文件操作与完整性/隔离验证，用户入口 L3 | 改变模型读取资产时加 L4 模型；知识复用价值由 L5 证明 |
| prompt、知识、模型工具 | L0/L2 的机制检查 + L4 模型；新状态显示加 L3 | 研究方法、选择或工具行为实质变化时加 L5 |
| dsh/Electron 依赖或启动接口 | L0 构建 + L2 真实 Host + L3 启动/会话/页面 | 模型接口受影响加 L4 模型，端到端风险按实际变更升级 |
| 新源快照或候选版 | 对受影响范围的 L0–L3 与原有覆盖对账 | L4/L5 按真实依赖和研究行为变化触发，不机械地每次全跑 |

未变化部分的历史证据可作回归依据，必须标明原版本和适用范围；不能写成新版本刚刚做过真实模型或 EDA 实跑。风险不能判断时先查明影响，不自动选择最贵的全量测试，也不自动假定低层通过足够。

## 实际降本方式与不能省掉的内容

1. **先分组和计时，再迁移。** 原套件暂保留，第一次导入后按资源需求对账。只在有明显成本原因或正在修改的行为上，将重复的规则/状态矩阵放到便宜入口；保留相应集成与窗口检查。不能先删除大量慢测试，再以剩余套件更快宣称改善。
2. **测试通过生产使用的接口。** 不为测试复制 Fabric/Ledger/dsh 语义，不新建通用测试运行服务，不大量增加 mock 接口，不暴露私有状态只为断言。现有 Node test runner、Host support、driver 与 stand-in 是起点。
3. **只替代昂贵外部依赖。** 逻辑与状态仍用真实实现。本地临时文件、真实进程和本地 tmux 的成本通常值得保留；外部 EDA/模型的替身必须有来源及限制。期望值来自独立的规则推导、真实报告或明确反例，不能由被测实现自己生成答案。
4. **构建一次，选择相关组。** PLS-01 已提供薄的 local/desktop/live-site 文件入口，PLS-02 的 `check:local` 执行一次新构建和完整本地检查，叶命令与 `test:contract` 不再自行构建，支持经归属校验的 `--files` 子集；pre-push 调用 `check:local`。实测见 [PLS-02](assessment/2026-09-11/pls-02/README.md)，live:model、pilot 入口在实际能力具备后提供。名称过滤不保证文件初始化无副作用。
5. **正确隔离后再并行。** 纯逻辑及独立 Host 进程可验证隔离后有限并行；in-process support 会修改 `process.env`，同进程不同 home 不可盲目并行。Electron 窗口测试串行；真实 Site 遵循自身 Job/许可证额度。
6. **减少无关启动与等待。** 只读参数矩阵可在合适的夹具生命周期复用 Host，写入场景、冷启动和恢复测试维持自己的 home/进程。使用可观察状态/受控就绪信号，避免固定长 sleep；不能把所有测试共享一个可变 Run/Store。
7. **失败后缩小复现。** 保留首个失败，转到最便宜的可复现层诊断；不自动重复整套桌面/真实 EDA 直到变绿。真正 flaky 与真实产品故障分别处理，不用重试掩盖失败。
8. **通过、跳过、未跑分别报告。** 无窗口、缺少真实报告或模型凭据不是 PASS。当前 `test:unit` 在无用例时退出 0，只表示没有单元测试；不得计为该层覆盖通过。

## 当前必须在 P0 注意的资源边界

原快照的 `ssh.test.ts`、`pack.test.ts` 与本次逐例核查发现的 `jobs.test.ts` 都在注册测试时调用真实 Site 探测。PLS-01 将它们的 live 部分移入 [ssh.live.test.ts](../test/contract/ssh.live.test.ts)、[pack.live.test.ts](../test/contract/pack.live.test.ts)、[jobs.live.test.ts](../test/contract/jobs.live.test.ts)。本地入口不加载这些文件，并用测试期 SSH 哨兵验证边界。live 恢复用例的控制 socket 现有私有目录及归属检查；真实执行前仍须核对 Site 与许可。

[boot-inprocess.ts:28](/Users/lluzi/code/hima_harness_reforge_polishing/test/contract/support/boot-inprocess.ts:28) 的环境变量变化，以及 driver 的真实窗口/焦点需求，决定了不同组不能共用一个粗暴的并发开关。每次测试只清理自身 home、workspace、窗口、进程和 Job，不干预 Claude 或用户现有运行。

## 成本与证据记录

复用现有测试输出，另保存必要的源 SHA、构建身份、测试组、pass/fail/skip/未跑、耗时、Host/窗口启动数、真实模型调用和 Site 作业投入。先用一次代表性冷/暖运行建立基线；只有出现波动或要证明优化时才做有预算的重复采样，不把一次耗时说成稳定 p95。

降本成功必须在相同的行为覆盖范围下比较。关注开发反馈时间、失败定位成本、昂贵依赖调用和需要人工介入的次数，不以测试数量或覆盖率百分比单独评判。

P0 的范围和后续 Step 衔接见 [Pilot 进度方案](/Users/lluzi/code/hima_harness_reforge_polishing/docs/pilot-plan.md)。
