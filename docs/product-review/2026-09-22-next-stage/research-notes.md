# 研究范围、证据与复核记录

日期：2026-09-22。主报告为 [review.zh-CN.md](review.zh-CN.md)。本文件用于保留判断依据，不定义产品新规则。

## 研究合同与可修订提纲

读者：产品负责人、EDA 产品/工程团队。决策：下一阶段功能投资顺序、架构复用边界和客户价值证明。

范围：当前 polishing `b032bb031703cc4fd73f3a073e5d543035e17e99`；已保留 DTCO/XTop 试用；中文 demo；本日打开的官方外部资料。排除新商业实验、恢复暂停的 tester/Campaign、改产品行为、读取用户 `tmp/`。主综合者 root；三个独立证据审查者均为 `gpt-5.6-sol / high`、干净上下文；不递归派工。审查和文档无需重新跑产品 L0–L5。

| 必须回答的问题 | 证据范围 | 本轮状态 |
| --- | --- | --- |
| 当前能力与真实收益到了哪里 | 源码、trial24、trial30 留存、demo | 已区分实现、历史实测、商业收益和未验证范围 |
| sub-agent 团队怎样减少主上下文负担 | DSH/Fabric seams、owner/epoch、当前工具限制 | 提出有界委派；未新增 runtime |
| Guide 怎样成为主要入口 | context/inventory、Preparation、authoring/session/skills | 现状与四类任务建议已区分 |
| Pack 作者怎样形成可靠方法 | compiler/check、作者阶梯、两个 Pack、发布 | 指出结构检查与业务语义/成熟度区别 |
| 洞察 GUI 怎样承载 Liberty 工作 | ADR0012、#49、native qualification、Workbench | 保持三类分析；API 门未过 |
| 竞争与采购价值是什么 | 官方资料、内部方法与结果 | vendor claim 不等于独立 benchmark；DIY 优势保留 |
| 人如何使用、判断与恢复 | 历史试用、三张保留画面、当前接口 | 给出最小改进与用户验收，无新真人测试声明 |

提纲变化记录：初稿按六项需求加现状基线组织；源码复核后在现状节增加 Guide 身份、发布证据和 XTop chooser/完成门三个具体问题。独立反馈与反证发现后，保留 Fabric 全 verdict guard，不将 chooser 不一致升级为“会错误完成”的事实。

## 检索协议与停止理由

| 线 | 关键检索/读取 | 纳入与排除 | 停止理由 |
| --- | --- | --- | --- |
| 当前产品 | AGENTS、product-definition、CONTEXT、ADR0001/2/8/12、testing-strategy、polishing discipline/model policy | 当前 accepted 规则与实际源码；upstream、旧规格和 open issue 不自动当现行事实 | 职责与复用边界足以决定下阶段切片 |
| 运行与使用 | trial24、trial30、cycle/checkpoint、demo manifest/README/截图 | 保留版本/时刻；不操作 UI 或 live Site | 已可区分负结果、改善和暂停；重跑不改变产品评审所需证据 |
| Guide/作者 | `index.ts`、`authoring.ts`、`skills.ts`、`packs.ts`、`release.ts`、技能/测试 | 静态实现不冒充本次测试；读取实际消费端 | 问题集中于已有机制的连续体验与语义一致性 |
| Library | library-intelligence-platform docs、API qualification、Workbench seam | 接口声明与可运行资格分列；不调试 vendor 二进制 | 下一关键证据是实际 qualification，不是更多文献 |
| 外部竞争 | “Codex subagents automations skills worktrees”；“Claude Code subagents”；“Synopsys AgentEngineer”；“Cadence ChipStack”；“Siemens Fuse”；“ORFS AutoTuner”；“ChipAgents multi-agent” | 只用官方文档、厂商原始发布、项目官方 repo；Reddit/SEO 仅可能是发现线索，未用作最终证据 | 通用 agent、多工具与领域 AI 已是竞争基线；继续查营销数字不会改变定位 |
| 反证检索 | XTop rule 顺序 → exploreEvidence → completeAdmittedNode | 独立审查提出疑点后，沿实际执行保护查到底 | 找到 `fabric.ts:2565` 全规则门，修正原先疑虑；无需把假设升级成运行事故 |

竞争来源与 claim 摘要见 [sources.json](sources.json)。9 个主要外部页面用 ego-browser 真实打开、读取正文，研究 task space 完成后已关闭；没有访问登录账户或发送外部消息。OpenAI 能力采用 official OpenAI documentation。网页原文留在本地 `.hima-tmp/product-review-20260922/web-*.txt`，不随报告复制整篇商业资料。

## 关键论证卡与反例

| 判断 | 机制与本地案例 | 最强反例/替代解释 | 决策影响 |
| --- | --- | --- | --- |
| 领域方法与可核验交付比通用 agent 特性更有竞争价值 | XTop 跨工具并保留 best DB，DTCO 保留真实负结果与采用 | 大厂也已做领域 agent；客户已有 CAD flow 可能更成熟 | 选具体业务、实测适配/审阅/维护成本，不声称独有 |
| sub-agent 能减轻上下文负担，但不自动提升可靠性 | 多轮 reader/数据合同与 compact 相关问题；owner 仍需持久状态 | 任务本身依赖强；多个 agent 可能重复错误并增加成本 | 先 Analyst/Reviewer，固定输入 A/B 后才扩展 |
| Guide 的核心是完成任务的连续性 | 已有 context、作者会话、准备和转移预览，但多个入口分散 | 高级用户可能偏好命令和显式阶段 | 保留专家入口，新增连续引导，不把全自动替代明确责任 |
| 洞察应联到设计决定而非止于曲线 | mock Liberty 曾直接影响 DTCO 解释；库变化需要实际工作点和采用上下文 | Solido 已能检查/比较/画图；设计 join 成本可能高于收益 | 先只读同族 delta triage，测审阅成本与高影响问题召回 |
| 运行图需要业务摘要 | 保留画面节点名截断、证据卡先展示路径 | 专家需要完整细节；图已有 zoom/pan | 摘要与分组是投影升级，不能删掉审计细节 |
| XTop 建议可能与实际完成门不同 | 前两 rule 供 chooser，第三条 hold 仍记录 | Fabric 全 verdict PASS 门拒绝错误 goal-met | 报告为建议/行动一致性缺口；不声称试用错误结束 |

## 仍会改变决策的证据缺口

| 缺口 | 已有证据 | 尚缺什么 | 下一项最便宜证据 |
| --- | --- | --- | --- |
| 客户净节省 | 可追踪的真实轮次/报告 | 熟练人工/脚本基线和独立用户成本 | 同一短任务的操作/审阅对照 |
| 自主研究有效性 | 多代策略、代码与 demand 变化 | 固定难度下的成功率、排除价值和成本 | frozen feedback A/B；之后另预算真实业务 |
| Liberty API | 原生接口 inventory 与 exit139 留存 | 当前可运行 parse/query/round-trip | vendor 修复或明确授权后最小 qualification |
| 跨设计与 Site 迁移 | 少量设计/一套主要环境 | 适配工作量与非原作者成功 | 第二个受支持环境/设计的迁移清单 |
| Guide 与 delegated workers | 底层 seam 可复用 | 真正角色/上下文/权限隔离的产品验收 | 无商业作业的小型任务对照 |
| 采购与留存 | 当前定位和可解释价值 | buyer 访谈、预算、试点验收与续用 | 使用者/CAD/预算负责人分别访谈 |

这些缺口不阻止形成方向判断，但阻止宣称“商业成熟”“可靠自主研究”或确定 ROI。

## 验证记录

本轮验证仅针对交付文档和判断：实际执行结果写在本节后续记录。未执行产品测试；没有新 DeepSeek 模型调用、没有 EDA Job、没有恢复 trial30。产品部署与代理外发权限未被修改。

## 当前实现与保留证据的定位表

下列路径相对仓库根，行号基于本轮冻结 SHA。独立审查包保留在 `.hima-tmp/product-review-20260922/`（`execution-human.md`、`guide-pack.md`、`liberty-insights.md`、`reader-review.md`）；主报告经综合修正，原始 packet 中的建议不覆盖主报告。

| 主报告判断 | 精确依据 | 证据边界 |
| --- | --- | --- |
| Guide 为普通 Agent 的 context/inventory | `packages/harness/src/index.ts:327–364,459–474` | 静态实现 |
| selected Run 未充分进入对话 | `index.ts:342–364`; `tools.ts:445–455`; demo `screen-recording/04-generations.png` | 画面出现 unknown run 后目录搜索；306K 是画面显示 context，不解释成此次调用计费 token |
| 作者五阶段及手工调用 | `skills.ts:18–22,35–78,101–106`; `authoring.ts:69–107,350–399` | shell/范围限制是有意权限保护 |
| publication handoff | `client/PackOwnerPanel.tsx:1–5,20–76`; `release.ts:235–325,671–707` | Guide 不应静默绕过确认 |
| 观察性 proxy 文档漂移 | `docs/product-definition.md:15`; `CONTEXT.md:163–165`; DTCO `graph.yml:340–348` | 已接受产品规则和实际 graph 均保留观察性，词汇表落后 |
| chooser/完成门不一致 | `node-turns.ts:1881–1906`; XTop `graph.yml:84–93`; `choosers/xtop-next-iteration.yml:7–15`; `fabric.ts:2563–2566` | recommendation 可忽略第三条；实际完成门检查全部，不能报告为错误完成事故 |
| 人类暂停 | `ledger.ts:1486–1503`; `fabric.ts:2080–2129`; tester-checkpoint | 有历史见证与当前代码机制；尚未新建 red/green 用例 |
| Site 政策 | `sites.ts:188–248`; `index.ts:760–794` | bindings 保留不等于人工 permit/capacity 均保留；不声称已见越权 EDA 执行 |
| 配置 loading | `client/ConfigurationPage.tsx:290–305,411–426,681–697` | 错误设置与 early-return 分支静态可核对；未新开 UI 重现 |
| best DB 物理有效性 | XTop `flow/closure.py:519–565,700–759`; v29/v30 retained reports | timing 改善真实；缺 baseline DRC，不归因 72,799 的根因 |
| subagent 原语已有 | `pnpm-lock.yaml:4411–4427,6213–6223`; `authoring.ts:57–61`; `fabric.ts:2026–2044` | 不等于 Hima 业务团队已实现；子 Agent 无 owner 权限是正确边界 |
| 可复用研究分析记录 | `ledger.ts:995–1009`; `fabric.ts:2065–2078`; `remote.ts:942–950` | 可作为团队产物投影起点，非新事实权威 |
| Library 第二 UI 模式可复用 | `client/index.ts:151–199`; `HimaWorkbench.tsx:77–84,160–168`; ADR0012 | 只证明 seam，不证明图表和真实数据已实现 |
| API 未资格化 | `docs/package-development/library-intelligence-platform/environment-qualification.md:67–100` | retained lib.name exit139；本次未连接服务器 |

## 独立复核与修正

- 三位 Sol/High reviewer 分别给出执行/人因、Guide/作者、Library GUI evidence packet；root 独立核查关键源码与保留图像。
- Guide reviewer 对主报告做独立读者审查，六项需求均覆盖。已补作者 packStage 恢复、只读 publication handoff、act retry/block 覆盖。
- 初始 XTop “可能错误完成”疑虑经 `fabric.ts:2565` 反证降级为建议/执行门不一致；没有重写成已经发生的 defect。
- root 额外验证 Trial30 `#000812` 的 retained bytes 与 SHA-256 一致，读取其中 after.metrics，而非复述 checkpoint 中错误的 179.80。冻结摘录见 [retained-run-snapshot.json](retained-run-snapshot.json)。
- Trial30 人类暂停、Site policy 与 configuration error 纳入优先级；它们属于下一阶段切片，本次只记录未实施。
- 执行 reviewer 对集成结果再复核。已精确补充 pause/continue 请求的 origin 和请求 revision；root 从 Ledger 独立提取到冻结 JSON。最终 wildcard pause 自身不是“持久人类 hold”的证据。
- Site 建议改为完整保留已保存管理员政策，已实现 roots/wrappers/bindings 保留不被重复描述为缺失；业务 advisor 首切片明确复用 DSH subagent/filter 和分析记录，Workshop 只用于后续节点 Coding。

实际文档验证：26 个仓库内 Markdown 目标存在；JSON 可解析；来源 URL 无重复。9 个外部页面均经浏览器正文读取，自动 HEAD 为 8 个 HTTP 200、Cadence 1 个 HTTP 403（浏览器访问正文成功）；HTTP 可达不代替语义核对。`git diff --check` 通过。机器记录见 [verification.json](verification.json)。开发/审查 agent token 与总成本未测量；被评审产品的模型调用为零。
