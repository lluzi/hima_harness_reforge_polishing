# 持续升级纪律

## 工作模式

本仓库处于 **polishing** 模式：已有产品架构、模块和测试是工作的起点。
一次合格升级由五项组成：已核实的当前行为、明确的用户结果、现有模块内的
最小增量、能够推翻结果的测试，以及可恢复的提交。

产品定义以 `docs/product-definition.md` 为准。用户明确改变产品定义时，先更新
产品文档和 ADR；普通反馈、缺陷和体验问题进入现有模块，不自动产生一套新产品、
新运行时或新控制面。

## 每个切片的执行步骤

1. **定位。** 从 Issue、规格和失败证据定位现有入口、模块、接口、实现、测试及
   最近有效提交。完成条件：任务正文列出准确文件和关键符号，不以仓库全量扫描
   作为默认起点。
2. **陈述当前行为。** 用源码、测试或可复现结果说明系统现在怎样工作。完成条件：
   当前行为与期望行为可以分别观察，推断被明确标记。
3. **定义增量。** 说明哪个现有模块继续拥有该行为、接口怎样加深、哪些行为保持。
   完成条件：调用者需要学习的概念没有无故增加；新增字段、动作或状态都有真实
   消费者。
4. **选择反证。** 按 `docs/testing-strategy.md` 选择能够最快推翻预期行为的最低测试
   层级。完成条件：测试断言用户可观察结果或模块接口，不复制实现。
5. **实施。** 在已列出的文件和接口内完成增量，保留无关改动。完成条件：实现范围
   与任务正文一致；发生范围变化时先重写任务，而不是静默扩大。
6. **验证。** 先运行相关子集，只有风险或失败要求时才扩大层级。完成条件：通过、
   失败、跳过和未运行分别报告，实际产物对应当前源码构建。
7. **复核与同步。** 检查差异、证据、回滚和用户结果；commit 后立即 push 并核对
   远端 SHA。完成条件：本地与远端提交一致，未验证范围留有明确记录。

一次失败不会触发另一个方案的盲试。重新建立根因，判断现有模块是否仍是正确归属，
再决定修正、缩小或停止。

## 当前模块地图

下表是现有职责的默认归属。切片先在对应模块内寻找可用接口，再判断是否需要扩大。

| 行为 | 现有模块与接口 | 默认升级方式 |
| --- | --- | --- |
| 产品身份、能力上下文 | `packages/harness/src/index.ts`；DSH `systemPrompt.section/context` | 注册稳定产品说明和小型动态 inventory |
| Pack 读取与适用性 | `packs.ts` 的 `loadPack`、`packWords`、`checkPack`、`installedPacks` | 从现有 contract、graph、方法文件形成更有用的读取结果 |
| Pack 安装与升级 | `release.ts` 的 `installPackMethod`、`previewPackTransfer`、`applyPackTransfer` | 为现有安装能力补入口、选择和审阅 |
| Pack 作者方法 | `packages/harness/skills/`、Pack 的 `INTENT.md`、`SPEC.md`、`contract.yml`、`graph.yml`、tools/readers/knowledge | 优先修改 Pack 内容；Harness 只承接可复现的通用缺口 |
| Site 声明与检查 | `sites.ts` 的 schema、`loadSite`、`installedSites` | 校验、导入和保存同一 Site 文件模型 |
| 本地/SSH 执行 | `channel.ts` 的 `LocalChannel`、`SshChannel`、命令白名单 | 增加有界 probe 或复用现有 Channel，不建立另一远程执行层 |
| Run 准备 | `index.ts:startPreparation`、`remote.ts:startChoices`、`packs.ts:checkPack` | 加深已有准备结果；表单和对话读取同一结果 |
| Agent 业务执行 | DSH Agent Loop；`tools.ts:hima_execute`；`fabric.ts:executionAction` | 继续使用同一对话 Agent 和现有动作，不建立第二 Agent Loop |
| 运行图与状态 | `fabric.ts:executionContext`、`remote.ts:RunView` | 投影现有 reference/growth graph 和 Ledger 状态，不建立第二图引擎 |
| 人类控制与通知 | `client/api.ts:controlRun`、`remote.ts:controlOperation`、`fabric.ts:executionAction`、`index.ts` 的 `agent.followup` | 让 Host 负责控制落账后的可靠通知；UI 负责呈现 |
| 研究代码与策略变化 | Workshop、`analyze`、`grow`、`revise`、Judge、Chooser | 用 Pack 方法和实测数据改善决策；新增 Runtime 动作需要通用缺口证据 |
| 知识与历史资产 | `workshop.ts:knowledgeForWorkshop`、Ledger `KnowledgeRecord`、`experience.ts`、Pack archive | 原件和记录保持权威；外部检索只提供候选并落回现有证据模型 |
| Desktop 呈现 | `packages/harness/src/client/`、`workbench-style.ts`、`packages/desktop/` | 重排现有信息和交互；Host/Runtime 继续拥有事实 |

文件可以新增，模块职责保持稳定。一个帮助函数、测试夹具、Pack 或外部 adapter 不等于
新产品模块；让多个现有模块适配新的生命周期、身份或事实权威，才属于架构扩张。

## 任务就绪标准

Issue 或实施规格在派给实现 Agent 前必须包含：

- **用户场景：** 哪个用户在什么状态下要得到什么结果。
- **当前证据：** 当前行为、失败或缺口来自哪个源码符号、测试或运行记录。
- **行为归属：** 哪个现有模块继续拥有它，调用者经过哪个接口。
- **代码范围：** 预计修改的文件和关键符号；共享文件的单一所有者。
- **精确增量：** 输入、输出、状态、错误和顺序怎样变化。
- **保持项：** 现有架构、数据、兼容行为和用户资产中哪些必须保持。
- **验收示例：** 至少一个通过例和一个能推翻实现的失败/边界例。
- **测试层级：** 具体命令或测试文件；昂贵依赖的升级条件。
- **回滚：** 哪个 commit、配置或版本可以恢复。
- **模型分配：** 按 `docs/agents/model-policy.md` 指定模型和 Effort。

任务正文自身应足以让第二梯队模型执行。若实现 Agent 必须重新解释产品、全仓库寻找
归属、猜测接口或创造验收标准，任务尚未就绪，先补规格。

### 任务写法示例

| 模糊任务 | 可执行升级 |
| --- | --- |
| 改善首次使用 | 在 `index.ts` 通过现有 `systemPrompt` seam 注册产品说明和安装 inventory；“你能做什么”不触发 fs/search 工具；以真实 Host 会话记录验证 |
| 做 Pack 安装系统 | 在现有 `PackOwnerPanel` 接入 DSH directory picker，调用 `previewPackTransfer` 和 `installPackMethod`，安装后刷新 `installedPacks` |
| 建立运行图 | 在 `HimaWorkbench` 调用已有 `fetchExecutionContext`，绘制 `method.reference` 并以 `RunView.nodes` 叠加状态 |
| 让停止通知 Agent | 在现有控制落账后由 Host 调用 `agent.followup`；验证 Agent inbox 与 Run stop 状态，不改变 Fabric 控制语义 |
| 增强 DTCO AI | 在现有 Pack 的 knowledge、Workshop、Chooser 和 graph 中写明假设、反馈和下一策略；只有现有动作无法表达时才提交 Runtime 缺口证据 |

## 模型解耦

产品的可靠行为由代码、Pack 声明、Site Permit、工具输出、Ledger 和 Judge 保证。模型负责
理解、研究、生成候选和在声明范围内选择；模型自述不写成成功事实。

开发任务通过以下方式与模型能力解耦：

1. 任务给出准确入口、文件、符号、接口和完成标准。
2. 业务术语、策略范围和输入含义写入 Pack/知识，不依赖模型预训练猜测。
3. 确定性检查、权限、状态转换、hash 和恢复由代码执行。
4. 模型输出进入窄 schema，并由实际工具结果和 Judge 验证。
5. 普通修改、测试、文档和集成以第二梯队模型完成；模型升级只处理已有证据表明的
   复杂判断，不用于弥补含糊任务。
6. 产品真实模型保持既定基线；replay、低层测试与真实模型验证分别说明，不互相替代。

强模型可以提高研究质量，但产品正确性和常规维护不能以最强模型为隐性依赖。

## 并行纪律

独立模块可以并行，依赖只约束共享接口和最终集成：

- 主任务先冻结最小共享接口和文件所有权。
- 每个 Agent 只修改其任务列出的模块；`index.ts`、`remote.ts`、`paths.ts`、`tools.ts`
  等共享接线文件由单一集成者拥有。
- UI、Site/Channel、Pack 内容、知识 POC 等无共享写入的工作同时推进。
- 每条线独立验证、commit、push；主任务按接口合入并运行组合测试。
- Subagent 不递归派工。并行度、模型与 Effort 以 `model-policy.md` 为准。

并行不是同时重新设计多个子系统。并行切片都应是同一现有产品上的独立增量。

## 架构升级门

仅在以下证据同时具备时进入新模块或新组件设计：

1. 用户结果已经具体到可验证行为。
2. 当前模块和接口逐项核对过，无法在原职责内表达该行为。
3. 强行放入现有模块会造成更大的接口泄漏、重复事实或生命周期冲突。
4. 新设计说明消费者、数据权威、迁移、测试和回滚成本。
5. 用户明确接受这项架构扩张；决定写入 ADR。

外部知识库等真正有高收益的依赖先作为隔离 POC 验证，再通过现有 DSH plugin/MCP seam
接入。POC 通过不自动授权替换 Hima 的 Pack、Ledger、Archive 或权限模型。

## 完成定义

切片完成意味着：目标用户结果可观察；相关测试通过；失败和未验证范围已记录；现有
行为与资产保持；没有引入第二事实源或第二控制者；提交已同步远端。若这些条件未同时
成立，状态写为进行中、失败或受阻，不用文档叙述补成完成。
