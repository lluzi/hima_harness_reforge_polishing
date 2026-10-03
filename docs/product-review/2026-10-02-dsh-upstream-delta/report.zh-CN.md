# DeepSeek Harness 上游变化与 Hima 消费面复核

研究日期：2026-10-02（America/Los_Angeles）。首次官方联网采样：**2026-10-03 02:37:03 UTC / 2026-10-02 19:37:03 PDT**。后续请求在同一研究窗口完成；默认分支冻结到下表 SHA，避免移动主线使比较失真。

研究者：GPT-6 Astra / high，独立上下文，只读研究；主会话独立核对本地基线、npm 发布声明、关键源码和提交计数。遵循 research skill 的一手来源方法，以及本仓库产品定义、polishing discipline、model policy、ADR-0001/0002。没有升级依赖、安装包、运行仓库脚本、产品测试、模型试验、Hima Host、SSH 或 EDA；研究阶段没有修改 Hima 运行代码或依赖；归档阶段仅在本目录新增报告与证据索引。上游只在 OS temp 创建隔离 checkout，clone/checkout 禁用 hooks。

## 结论

**相对 Hima 开发初期、至今仍固定的 0.1.5-alpha.1，上游变化大，已经跨过数个真实接口与持久化兼容边界；相对 9 月 22 日调查过但没有接入的 0.1.7-alpha.2，变化中等，主要继续扩展 UI、配置、工具恢复和桌面可靠性。** 两个参照不能混用。最显著的四处 Hima 断点——子 Agent catalog 返回结构、工具结果消息结构、通用 `plugin` 消息 source、客户端会话导航——在 9/22 的上游调查快照中已经存在，本次把它们追到了今天 Hima 的实际消费者。它们不是“最近十天才全部新增”。[版本比较][compare-pin-release]、[9/22 后比较][compare-previous-release]

建议 **保留当前产品 pin，同时把一次独立的 DSH 升级资格化列为近期基础维护切片**。候选先固定已发布 `0.2.0-rc.2` 及其对应包集合；不要追 master，不要批量使用 `latest`，不要在 A/B 架构整理里顺带升级。当前证据不支持“当天直接替换依赖”，也不支持“上游没变，继续长期忽略”。已有明确迁移成本与可靠性收益，但尚未完成任何 Hima 兼容资格化。

上游仍是 Cordis/plugin + Agent/Session/Workspace 体系；没有证据表明 Hima 应重写 Fabric、Ledger 或 Site。A（Campaign preparation 的来源、确认身份、实际执行值）和 B（共同 RunControl 解释）依然是 Hima 自身的业务一致性问题。上游新增的是通用机制，可以改变适配层的实现方式，不能直接接管这些事实与授权。[preset registry][S-preset]、[Session controller][S-client-contract]

## 1. 三套基线和发布事实

| 对象 | 已核实版本/身份 | 时间与证据意义 |
|---|---|---|
| Hima 首次 polishing 导入 | 本地 `d6cadfbe`，2026-09-11；root/harness/desktop 的 DSH pin 已是 `0.1.5-alpha.1`，Cordis `4.0.2` | 主会话和本研究分别读本地 Git 历史；这是本仓库可证明的开发初期，不外推其他源项目更早历史 |
| Hima 当前 | `0626bba394db8b29a02aa9defa718aba07554571`；仍固定 DSH `0.1.5-alpha.1` | 初期 pin 与当前 pin 相同。不是在 9/22 后升级到了 0.1.7 |
| pin 的同名官方 Git tag | `dsh-v0.1.5-alpha.1` → `5dda764ed3aa172535a7967b06ff95d9cbfe536a` | commit 2026-09-08 15:25:45 UTC；npm dsh 发布 15:57:30.560 UTC |
| 9/22 调查中的上游 | `dsh-v0.1.7-alpha.2` → `00102833dfaee1da9f48a3a8eae9d34005a75218` | commit 2026-09-22 15:25:38 UTC；GitHub release 15:49:49 UTC；npm 16:08:55.647 UTC。旧报告同时以 5dda…引用已安装版本的源码，两个 SHA 用途不同 |
| 当前最新**正式稳定**版本 | **没有找到** | 官方 GitHub 本次返回的所有 release 均 `prerelease=true`；npm dsh 所有已列版本均有 alpha/rc 后缀。不能把 npm `latest` 当 stable |
| 当前最新 GitHub / npm dsh 预发布 | `0.2.0-rc.2`；tag → `639ed015397290b3745d163aafe02ffee4aa3f84` | commit 2026-09-29 09:21:31 UTC；GitHub release 09:42:36 UTC；npm dsh 09:56:27.792 UTC |
| 默认分支冻结 HEAD | `master` → `da00f7f5358f2949383b35c14f548bc20187d80c` | commit 2026-10-02 23:44:05 UTC（PDT 16:44:05），合并 PR #5623；相对 rc.2 的未发布主线 |

来源：[GitHub repo API][repo-api]、[tags][tags-api]、[releases][releases-api]、[master commit][master-api]、[npm dsh][npm-dsh]。旧调查文件为 `docs/product-review/2026-09-22-ecosystem-reuse/decision-report.zh-CN.md:72,92,102` 和 `component-shortlist.zh-CN.md:7–14`。

**npm 与源码映射的限制：** registry 的 dsh、agent、subagent、llm、session、agent-preset-registry 对本次抽查版本都没有 `gitHead`。本稿源码比较使用**同名官方发布 tag**，没有宣称 tag 的源代码和全部 npm 产物已逐字节映射。另对 npm `dsh-agent` 两版及 rc.2 的 subagent/llm/session/preset-registry tarball 做了只读下载、sha512 校验、声明抽取；六份 tarball 均匹配 registry integrity。因此关键发布 API 的变化有真实发布声明支持，而不仅靠 master 文档猜测。主会话另独立抽取旧版与新版 llm/subagent 声明，结论一致。没有执行包内脚本。

**dist-tag 不统一：** dsh 是 `latest=next=0.2.0-rc.2, alpha=0.1.7-alpha.2`；agent 的 `latest` 仍为 `0.1.0-rc.6`；subagent/llm/session 的 `latest` 仍为 `0.0.1-rc.1`，它们的 `next` 才是 `0.2.0-rc.2`。新增 agent-preset-registry 的 latest 为 `0.1.7-alpha.1`、next 为 rc.2。原 agent-presets 包已不随 rc.2 同名发布（主会话 registry 核对）；升级必须核对新旧包身份和完整依赖集合，不能简单给所有包写 `latest` 或机械同版。归档的 dist-tag 证据见 [npm 元数据摘要](npm-metadata.json)。[npm agent][npm-agent]、[npm subagent][npm-subagent]、[npm llm][npm-llm]

## 2. 变化规模：区分合并提交、生产源码和生成噪声

以下是冻结 SHA 的 `git rev-list BASE..TARGET --count`，另列 `--first-parent --count`；是可达提交差集，**不是 PR 数，也不是线性开发天数**。旁支 commit 的自身日期可能早于基线标签，但合入发生在基线之后。

| 区间 | 全部提交（含 merge） | first-parent | 日期跨度（端点 commit UTC） |
|---|---:|---:|---|
| pin → 9/22 调查 tag | 3,431 | 380 | 09-08 → 09-22 |
| pin → rc.2 | 4,381 | 549 | 09-08 → 09-29 |
| 9/22 tag → rc.2 | 950 | 169 | 09-22 → 09-29 |
| rc.2 → 冻结 master | 258 | 42 | 09-29 → 10-02 |
| pin → master | 4,639 | 591 | 09-08 → 10-02 |
| 9/22 tag → master | 1,208 | 211 | 09-22 → 10-02 |

全部区间为 ancestor→descendant；API compare 与本地 Git 主要三段计数相同。GitHub compare API 只返回至多 300 文件/默认 250 commit，**没有用这个截断列表算总体规模**。

全树 pin→rc.2 的粗计是 9,511 文件、约 +134.7 万/−16.6 万行，**这个数字严重混入 docs、翻译、配置、快照、测试、生成 catalog、版本批量更新**；全树 rename detection 还达到默认上限，因此只作审计原始值，不作为架构判断。

为减少噪声，另固定口径：`git diff --no-renames --numstat BASE TARGET -- packages/**/src/** apps/**/src/**`，排除 `tests/`, `test/`, `__snapshots__`, `.test.`, `.spec.` 路径。结果 pin→rc.2 **1,988 文件 +148,806/−54,075**；9/22→rc.2 **849 文件 +37,738/−7,486**；rc.2→master **293 文件 +12,813/−5,933**。这仍包含 `packages/test-support`、源码内生成物与搬迁，并非净生产逻辑复杂度，不能把每一行当新行为。

语义尺度：

- **核心组织方式小变**：仍保留原生 Agent Loop、注册表、Session、workspace、tool guard、plugin composition；没有整体换引擎。
- **Hima 适配契约大变**：消息角色/source、Session V4、child catalog、client Session lifetime/navigation、preset/settings 装配都跨边界。
- **9/22 之后中等增量**：工具失败后可继续的恢复、桌面关闭/退出、环境继承、配置/插件可靠性、UI/快捷键/预览等；没有证据把它描述成第二次全面换架构。
- **master 新增能力集中且未发布**：实验性 Claude Code mods bridge、Session inspector、schedule/preset 归属和若干性能/装配修复。它们不构成 Hima 立即追主线的理由。

精确原始统计、逐文件 numstat、提交列表、过滤后目录统计位于本次临时证据目录的 `diffs/`；本目录归档其小型证据汇总，不把大体积上游 checkout 纳入产品仓库。

## 3. Hima 的四处明确兼容断点

这些为**已发布源码/声明 + 当前消费者静态对照确定的结构差异**；没有把静态推演写成已运行故障复现。

| 断点 | 旧 → 新 | Hima 当前消费及后果 | 证据 |
|---|---|---|---|
| 子 Agent `listChildren` | `SubagentListEntry[]` 含 `kind:'child'/'diagnostic'`、按子会话发现 → `SubagentCatalogEntry[]` 来自 parent durable catalog，含 id/createdAt/mode/label，**无 kind**，可有 `mode:'unknown'` | `delegation.ts:186–195,345–353` 手写旧类型并 `candidate.kind==='child'`，原样升级会找不到匹配 child；创建/恢复/结果读取链的身份核验均受影响 | npm rc.2 `dsh-subagent/lib/types/index.d.ts:218`；[新 catalog][S-catalog]；[源码改动 e55093b][C-catalog] |
| 工具结果 | `role:'user', content:[{type:'tool-result',toolCallId,isError,content}]` → `role:'tool'`，`toolCallId/isError` 为 message 顶层，content 直接是内容块 | `delegation.ts:664–671` 仍从 `message.content[0]` 提取 tool-result，可能静默遗漏已成功 write/edit 的产物/diff/test 证据。修 listChildren 后仍不能忽略此处 | 旧/新 npm llm 声明；[消息源码][S-message]；[f4a32db][C-flat] |
| 通用 plugin source | `MessageSourceMap.plugin={kind:'plugin',plugin:string}` → 去掉 catch-all，每个 producer 自己声明 source kind | `authoring.ts:94`、`index.ts:1228,1484`、`moments.ts:300` 用旧 source；全 harness/src 未见本地 MessageSourceMap augmentation。须决定并迁移 Hima 专属来源语义，保留历史读兼容；不能只强制 cast | [消息源码][S-message]。`createUserMessage` 仍存在，但它接受的来源类型已不同 |
| Client Session 导航 | `ctx.sessions.open/openSubagent` + list.current → `sessions.retain/using` 管本地引用/generation，导航归 `ctx.uiWorkspace.openSession(target)` | `client/index.ts:31,170,197` 旧 open/openSubagent 调用影响 owner、child、authoring；WorkbenchEntry 的 `useSessions(state.current)` 也依赖旧 selection feed。手写 ClientContext 可能让编译检查漏过真实运行错误，必须 L3 验证 | [新 Session 合约][S-client-contract]、[原生 child 导航示例][S-ui-child]、[6830e14][C-client] |

这四项对应改动均已在 `00102833`（9/22 tag）的祖先里；已发布 rc.2 继续包含。上次报告“接口应另做兼容资格化”的方向成立，但不能继续把旧 0.1.5 的接口表当成今天可直接升级的接线指南。

## 4. 其他相关子系统：新增、修复与仍保持的 seam

| 范围 | 已核实旧→新变化与状态 | 对 Hima 的意义 |
|---|---|---|
| Agent 生命周期 | `agent/created` 从同步通知变为串行 awaited 初始化；移除 `agent/session-start`，source/signal 合入 created；create/resume/get/list 仍在。9/09 [9b7a8cc][C-created]，已在 9/22 和 rc.2 | 外部插件 setup/listener 的抛错、异步初始化与处置顺序要重验。未发现 Hima 直接订阅被删事件，故不是凭名称直接判其现有代码断裂。[Agent contract][S-agent] |
| inbox / followup / steer / inject | pin **已经有 durable inbox projection**、`inbox.replace`、followup/steer/inject；这些签名保留。完成回调唤醒默认无限、可配置 cap 的修复 [b6775f6][C-wake] 已在 9/22 | 不能把持久收件箱写成升级新增，也不能把成功排入收件箱等同 Hima Run控制已执行。`index.ts` 的合并通知逻辑仍有消费价值；迁移 source、恢复重复投递和 cancel 边界要测 |
| Session / 持久化 / query | format 常量 V3→**V4**；增加 developer/message、工具 schema 增量、flat tool result；历史迁移通过 catalog，保留旧 generation。`sessionPersistence.stat`、`sessionQuery.readSession/readSurface` 名称与返回总形状继续存在 | `native-session-memory.ts` 把 header.version 和完整 events hash 纳入 identity；即便 seq 连续，迁移后的 version/数据内容/追加 catalog 可改变历史摘要 identity，必须定义 stale/重新证实策略，不能默默重写为同一证据。迁移前备份整个相关 Session store，回退旧 binary不等于自动降级 V4。[Session types][S-session]、[query][S-query]、[迁移决定][S-migration] |
| 子 Agent 历史/capacity | parent catalog 支持 unknown mode、坏 child 的局部诊断；continuable 容量默认8，深度默认1，可配置；9/22 后 listDescendants 改递归沿可达 catalog 遍历，缺失分支有诊断 | 可减少 Hima自建发现逻辑，不能替代 Run分配总预算/权限/epoch/结果采用/取消事实。Hima显式maxDepth不应被默认值替代；恢复冷child满容量需要可见失败。[runtime][S-subagent]、[迁移决定][S-migration] |
| fork | 从完整 completed-turn prefix 扩为精确 inclusive event prefix，open tail有child-owned synthetic closers与`forked`结束原因；默认省略atSeq仍取completed边界 | child上下文可更精确；Hima现有fresh continuable路径不能因此自动宣称继承上下文。审计/结果判定不能把forked当completed。[Session types][S-session]、[client合约][S-client-contract] |
| Workspace | registry增加 archive activity/stop hooks；turn/subagent/jobs参与归档准入。目录命名语言中立、历史列表/缺失身份恢复改进；sessionController.create(workspaceId/cwd/sessionId/agentPreset)与workspaceRegistry.list仍有对应接口 | Guide新任务绑定已有Workspace机制仍可复用；归档通用DSH会话时取消原生活动，不等于完成 Hima 远端Job/Run停机，需要保持业务事实核对。[workspace][S-workspace]、[Agent archive][S-archive] |
| preset/settings | 原磁盘目录 preset→`dsh-agent-preset-registry` + 声明式`dsh-agent-preset`/bundle；**服务名agentPresets和mount(ctx,id)仍在**，变为共享generation、scoped绑定。settings-file→profile config-editor/settings，旧settings一次迁入，live Config/HMR支持重载 | `guide-sessions.ts` mount不能仅凭服务同名放行；普通/child继承实际tool/permission、选择/覆盖/重启要测。Hima自己的bundle仍走原有plugin seam，不必换产品模块。[preset][S-preset]、[定义变更][C-preset]、[base patch][S-base] |
| 权限/sandbox | 增加实验Auto review；拒绝后可在允许人工审批的会话由人决定；Windows删除与ACL约束修复。用户开的Web terminal明确使用system-user permissions（9/16），不冒充Agent sandbox | Hima terminal guard、Site Permit、Channel allowlist必须继续是硬边界。新增Auto审阅不能接管Site权限；人类terminal的权限模型应在资格化中对照，不把UI terminal与Campaign受控执行混为一类。[auto review][S-auto]、[human terminal commit][C-human-terminal] |
| tools / systemPrompt | `defineTool/register/guard`继续存在；pre-tool decision新增cancel、结构化错误；PTC的codeRuntime迁为ptcRuntime；工具增量通过developer消息，model须声明支持。systemPrompt.section/context仍在，新增interpolate:false；Hima所用DEPLOYMENT_PERSONA_PREFIX/SUBAGENT_DELEGATION仍有注册顺序 | Hima无需新建tool或prompt系统。确保guard在ordinary/child/PTC路径仍有效；不能由工具schema可见推导权限允许。以实际model配置验证，不保证KV缓存收益。[tools][S-tools]、[prompt][S-prompt] |
| compaction & memory | 保留摘要/查询体系；新增image offload；主动压缩扣除输出保留量并默认65536 headroom，summary maxTokens默认由8192改为headroom。[555b664][C-headroom] | 改善长上下文压力但更改预算/触发点。没有看到一套可直接替代Hima Run/Knowledge/experience 的通用长期事实服务；摘要不是授权/测量/作业完成依据。Flash长会话/child预算仍需资格化。[compaction config][S-compaction] |
| tool异常恢复 | 9/22 后，scheduler failure会drain已开派发，由owning step补保守恢复结果；`TOOL_NOT_STARTED`与`TOOL_OUTCOME_UNKNOWN`区分，避免会话卡死与盲目重试 | 对Hima可靠性有价值，仍须读取Ledger/真实Job判副作用；这个通用失败状态不能替代Hima idempotency request/执行身份。[recovery][S-repair]、[8de4e51][C-recovery] |
| terminal / jobs | terminal service核心源文件在pin→rc.2未变；Bash/PowerShell backend修复缓冲、prompt/结束识别；tool-terminal对Jobs owner/output接线改变；shell可后台化并展示实时输出 | 普通terminal可受益；Hima interactive-runtime的executionId、命令receipt、checkpoint、断连unknown与Site约束不能删掉。底层terminal存在不是EDA交互资格通过。[terminal-tools][S-terminal] |
| remote / client UI | Remote双向流/二进制，workspace文件读取统一readBytes；slots及sidebarRightTabs仍保留，但客户端会话生命周期/导航已变；新增文件/Office/PDF/浏览器/terminal预览、快捷键 | Hima remote服务与自定义panel需真实组合验证，现有style对上游DOM/CSS的依赖也需L3。保留slot名字不等于所有props/hooks可兼容。[workspace-files][S-files]、[client contract][S-client-contract] |
| Host启动/桌面 | `--profile --host --port --no-open`和`dsh web:`认证URL契约仍有；Profile HMR、bundle patches、config schema与错误诊断增强。官方Desktop新增关窗后台与退出提醒、登录shell环境、捆绑CLI | Hima自带Electron shell + 自己host-launch/main/hima-home，**官方Desktop的主进程修复不会因升级npm dsh自动全部接入**。可借鉴既有shell，须实际验证CLI readiness/token/quit fence，不替换Hima退出协议。[CLI参考][S-cli]、[Desktop关闭PR][C-desktop-close]、[环境PR][C-desktop-env] |
| Ledger底层storage-domain | pin→rc.2的`packages/storage/storage-domain/src`无源码diff；defineDomain/domainTable依旧 | 这是明确的小变化面，但新版Session格式与HimaLedger业务schema是不同存储边界。不能据此推导全部持久化兼容 |

Hima profile 的 `agent-default-model`、`llm-deepseek`、`plugin-package-inventory-deepseek`、`session-telemetry-otel` **row id仍在**。但 `llm-deepseek` 的 plugin name 已改为 `dsh-llm-deepseek-api-key`，另加account adapter；官方DeepSeek协议变为Messages-only，provider仍为`deepseek-official`。Hima overlay不能因为row id仍命中就免测；其 `models`、credential和重启生效要检查。base如今已默认`deepseek-flash`，Hima纠正老wire id的补丁可能可在资格化后简化；当前不删。[base patch][S-base]、[API-key adapter][S-deepseek-key]

## 5. 新能力是否改变 A/B 和既有适配层

**A：Campaign preparation 来源、确认identity、实际execution值的统一。** 新preset registry、workspace/session controller及配置schema可为准备过程提供更可靠的“实际选中值”，但它们不懂Pack digest、Site permit、输入内容identity、proposal确认或真正执行时的绑定。因此 A 的归属仍在已有 preparation/Fabric seam；可把“读取实际native model/preset/workspace”当现有准备接口的adapter输入，不把DSH Session当proposal批准记录。升级不消除tools/remote/index/fabric之间应收敛的数据解释。

**B：fabric/delegation-runtime/interactive-runtime共同解释 RunControl。** 新原生archive admission、Agent cancellation、child capacity和unknown工具结果可提供基础信号，不能决定Hima owner epoch/revision、pause语义、exit fence、time budget、远端Job是否已经停稳。仍应在Hima既有RunControl职责内消除分散解释，再由adapter消费DSH状态。保持“请求接受、原生停止、远端副作用已结清、业务完成”分别记录。B不被上游新控制功能自动取代。

可考虑减少的Hima适配：

1. **原生Session/child导航与catalog**：升级后改用上游uiWorkspace、parent catalog与retained session APIs；这些足以承载独立child可见性，不新增第二会话registry。
2. **配置/预设与plugin安装/diagnostics**：上游profile config-editor、bundle和标准UI可能减少hima-home中的配置修补，但须保持Hima隐私overlay、实际模型和已安装Pack/Site身份。先列出每项补丁的仍必要证据。
3. **普通长工具与Session恢复**：采用上游修复，不在Hima复制AgentLoop；业务Job的reconcile、unknown side effects和恢复授权继续保留。
4. **新SSH providers**：官方新增ssh/fs-ssh/subprocess-ssh/sandbox-ssh，是可隔离研究的远程基础层候选。它要求POSIX两端、预部署可信helper/hash、Unix socket forwarding；无自动provision/reconnect/replay，连接关闭/lease到期会触发helper清理，Web文件UI仍假设Host路径。**这些语义可能与Hima持久EDA Job/SSH Channel不同**，不能仅因“已有SSH插件”替换Channel。若以后论证，可在现有Channel职责内做隔离适配POC，保留Site许可、资源、工具身份、Job receipt、Ledger与归档。[SSH官方说明][S-ssh]、[sandbox-ssh][S-ssh-sandbox]

仍必须由Hima承担：Campaign唯一owner与Guide关系、Pack方法/digest和授权输入、Site Permit/工具白名单/许可证资源、Run预算/epoch/revision/人类pause、Job副作用与恢复、Judge/acceptance、测量证据、candidate adoption、Knowledge/Archive与跨任务经验修正。上游存在Team、goal、schedule或memory-like机制，不是这些业务事实的替代权威。

## 6. master 与已发布 rc.2 的边界

冻结master比rc.2多258提交/42 first-parent；当前HEAD新增**实验性Claude Code mods bridge**（PR #5623），官方README自行称alpha interface-compatibility demonstration，有未服务事件/成员和兼容差异表。另有Session inspector（#5259）、preset-scoped schedule tools（#5161）、goal cancellation停顿修复（#5469）、plugin resolution/HMR失效修复及Session corpus性能工作。[master bridge][S-mods]、[主线比较][compare-release-master]

这些均属于本次rc.2之后的主线证据，不能说“升级rc.2即可获得”。master中的部分大面积删除来自invariant companion调整和文档/代码治理，不能据行数宣称运行时核心重写。没有运行其测试，也没有证明其新实验桥接适合Hima。

## 7. 建议的最小升级资格化范围

这是后续切片建议，**本次未执行**：

1. **冻结输入与可回退资产**：rc.2准确package集合/lock，旧pin baseline、Hima profile与home配置、Session store和Ledger副本；在隔离home验证V3→V4迁移。不能让试验先写真人唯一Session store，也不能把退package版本视作V4→V3迁移。
2. **L0静态/构建**：npm包身份/exports/peer、旧preset包替代、message source augmentation、flat tool results、catalog shape、client导航；扫描结构cast和自定义ClientContext。类型检查必须覆盖host/client，但不会抓住所有手写结构边界。
3. **L2契约反证**：Guide→独立Campaign session确定性identity；registered Workspace membership；preset实际model/tools；child新建/恢复/冷恢复容量/unknown catalog/跟进/取消；completed vs forked/interrupted；产物/diff证据提取；V3/V4 readSession/readSurface/hash/throughSeq；notification replace/followup/重启去重；pause/stop/expiry/exit fence不放行工具；工具outcome unknown不得重复执行。沿用已有测试模块，验证外部结果，不复制实现。
4. **L3实际组合**：Hima profile干净启动和旧home副本启动；真实owner/child/authoring导航、Workbench/footer entry/slot props、workspace picker、普通terminal、reconnect、close-window/quit、CLI URL readiness。重点用真实上游client service，不以本地mock的open方法通过宣称兼容。
5. **边界资格后才L4**：DeepSeek Flash真实API一次有界coding/child/长上下文与compaction，确认Messages adapter、输出reservation、tool guard和通知路径。涉及Site执行再沿现有测试策略授权与预算；不以此调查自动启动L4/L5。

优先级判断：**中高优先级的独立资格化，非立即发布升级**。若当前pin出现本报告涉及的已复现fatal tool recovery、长期会话或配置故障，可提高该升级切片优先级；在没有复现与隔离验证前，不把上游修复当成Hima当下故障根因。A/B普通域内收敛可以继续，但若切片将改native子会话/preset/客户端navigation，应先冻结预期版本，避免重复接线。

## 8. 证据、限制与可审计范围

归档内容：[统计与版本证据](evidence-summary.json)、[源码身份索引](source-files.json)、[npm 发布包校验](npm-declaration-receipts.json)、[npm 元数据摘要](npm-metadata.json)、[Hima 消费清单](hima-consumption.json)、[主会话核对](verification.json)。

下文 `metadata/`、`diffs/`、`npm-declarations/` 和 `upstream/` 是本次临时证据目录中的路径：
`/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/dsh-upstream-20261002-jukggh44`。临时目录可能被系统清理；长期复核以本目录索引中的官方 URL、固定 SHA、统计命令和发布包 integrity 为准。

- **事实级别**：官方registry/API/固定tag源码/npm tarball声明为一手已核实事实；Hima后果为静态契约推演；升级建议/A-B归属为分析判断。没有产品运行验证，未宣称兼容或方法有效性通过。
- 已读Hima消费者：index、tools、delegation、delegation-runtime、guide-sessions、native-session-memory、client/index、profiles、desktop host-launch/hima-home；主会话补充moments、Ledger与本地消费清单。
- 没有逐个审计所有4381提交、所有平台sandbox、所有Community plugin或全部UI CSS。没有验证所有npm包与Git tag的构建字节映射；gitHead缺失保持未知。
- GitHub原始metadata保留首次观察；任何在研究之后发布的新版本都不在此冻结快照内。parent-catalog排序/类型、发布声明、生命周期改变已逐源码核对，release notes仅作索引。
- `metadata/`：GitHub repo/tags/releases/master/compare原始JSON，npm registry原始与压缩summary；`npm-declaration-receipts.json`：tarball URL、sha512与校验结果；`npm-declarations/`与`npm-agent/`：发布声明抽取。
- `diffs/`：全部commit/numstat、关键源码patch、统计口径、关键commit是否已在9/22的祖先记录。`refs.json`、`access-time.json`、`source-files.json`记录SHA/时间/源码URL/hash。
- 隔离 `upstream/` checkout固定rc.2，所有研究输出在OS temp。主会话另有本地消费清单与独立发布包抽查目录；归档时宜复制报告和小型证据索引，勿把整个clone或全部npm registry历史加入产品repo。

## 一手来源索引

[repo-api]: https://api.github.com/repos/deepseek-ai/deepseek-harness
[tags-api]: https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=100
[releases-api]: https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100
[master-api]: https://github.com/deepseek-ai/deepseek-harness/commit/da00f7f5358f2949383b35c14f548bc20187d80c
[npm-dsh]: https://registry.npmjs.org/@deepseek-ai%2Fdsh
[npm-agent]: https://registry.npmjs.org/@deepseek-ai%2Fdsh-agent
[npm-subagent]: https://registry.npmjs.org/@deepseek-ai%2Fdsh-subagent
[npm-llm]: https://registry.npmjs.org/@deepseek-ai%2Fdsh-llm
[compare-pin-release]: https://github.com/deepseek-ai/deepseek-harness/compare/5dda764ed3aa172535a7967b06ff95d9cbfe536a...639ed015397290b3745d163aafe02ffee4aa3f84
[compare-previous-release]: https://github.com/deepseek-ai/deepseek-harness/compare/00102833dfaee1da9f48a3a8eae9d34005a75218...639ed015397290b3745d163aafe02ffee4aa3f84
[compare-release-master]: https://github.com/deepseek-ai/deepseek-harness/compare/639ed015397290b3745d163aafe02ffee4aa3f84...da00f7f5358f2949383b35c14f548bc20187d80c
[C-catalog]: https://github.com/deepseek-ai/deepseek-harness/commit/e55093b47d6cfc7db94d703ee6b04fdf39d925aa
[C-flat]: https://github.com/deepseek-ai/deepseek-harness/commit/f4a32dbd0a2cd4ad3c0f22a3b7f7cdc0ccc7a67a
[C-client]: https://github.com/deepseek-ai/deepseek-harness/commit/6830e1460d0f09ed48fc976efc6193e67d345faf
[C-created]: https://github.com/deepseek-ai/deepseek-harness/commit/9b7a8ccc9fabc2e87386acf7f8b0741baf978022
[C-preset]: https://github.com/deepseek-ai/deepseek-harness/commit/d1e22a7e247060496e1acdba9ef3be1700e23ec7
[C-headroom]: https://github.com/deepseek-ai/deepseek-harness/commit/555b664b08db05e1cf8eeebb7eb00960ddf785b7
[C-wake]: https://github.com/deepseek-ai/deepseek-harness/commit/b6775f6d4f55eaa0bcac36318cd7dfc98d70195c
[C-recovery]: https://github.com/deepseek-ai/deepseek-harness/commit/8de4e51875d0957fcac4259a0a6a008d3bdffd8c
[C-human-terminal]: https://github.com/deepseek-ai/deepseek-harness/commit/ab695ef4cf4c798840506e45503ffd75c38cc47a
[C-desktop-close]: https://github.com/deepseek-ai/deepseek-harness/pull/5015
[C-desktop-env]: https://github.com/deepseek-ai/deepseek-harness/pull/5393

[S-preset]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/preset/agent-preset-registry/src/index.ts
[S-client-contract]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/api/session-controller/src/client/contract/sessions.ts
[S-catalog]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/subagent/subagent/src/projection-types.ts
[S-message]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm/src/message.ts
[S-ui-child]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-subagent/src/client/index.ts
[S-agent]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/agent/src/runtime-types.ts
[S-session]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/session/src/types.ts
[S-query]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/session-query/session-query/src/index.ts
[S-migration]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/.agents/notes/implemented/bug-fix/2026-09-19-session-local-subagent-migration.md
[S-subagent]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/subagent/subagent/src/index.ts
[S-workspace]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/workspace/workspace/src/index.ts
[S-archive]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/agent/src/archive-admission.ts
[S-base]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/bundle/base/cordis.patch.yml
[S-auto]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/experimental/auto-review/src/index.ts
[S-tools]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/tools/src/index.ts
[S-prompt]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/system-prompt/src/index.ts
[S-compaction]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/compaction/compaction-basic/src/config.ts
[S-repair]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/session/src/repair.ts
[S-terminal]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/terminal/tool-terminal/src/index.ts
[S-files]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/api/workspace-files/src/index.ts
[S-cli]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/cli/reference/README.md
[S-deepseek-key]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-deepseek-api-key/src/index.ts
[S-ssh]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/ssh/ssh/README.md
[S-ssh-sandbox]: https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/ssh/sandbox-ssh/README.md
[S-mods]: https://github.com/deepseek-ai/deepseek-harness/blob/da00f7f5358f2949383b35c14f548bc20187d80c/packages/experimental/claude-code-mods/README.md
