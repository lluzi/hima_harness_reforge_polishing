# 独立读者与关键证据复核

复核者：按本轮用户指定的 GPT-6 Astra / high、fresh context 独立复核；没有派子 Agent。复核日期：2026-10-02 PDT / 2026-10-03 UTC。

复核对象：`report.zh-CN.md` 初稿，SHA256 `ef5c65a1db218a6a0ceddbf2a8a2e9308520c4c92fdb1d98fd1b4dd558f9a928`。实际 checkout HEAD 核对为 `b645e23b5fa4ceb0d93f731396cc6e767dbb9382`；报告标明产品依据 `77223fe`。仅此审查文件由本 reviewer 写入，未改主报告、证据包或产品。

**结论：报告可信性审查通过；未发现需要阻断内容交付的实质性问题。实际采用效果未验证。** 下述一项术语建议和一项发布路径核对不需要追加研究、安装、测试平台或治理门禁。

## 1. 未看证据包前的独立读者复述

先完整读取主报告，再读取其他材料。单靠主文，我可以复述以下内容：

- 核心判断一：已由 AI 做到可运行，不足以证明难维护，也不足以证明可靠。应按真实消费者、业务真值、时间故障和后续变化负担判断；不能按代码出身先决定重构。
- 核心判断二：默认组合是行为刻画、接口加深、独立反例；高副作用和恢复场景补状态/故障验证。角色更多、规格更多、review 更多不自动增加可靠性。
- 核心判断三：热点分析和渐进替换是证据触发的条件路径，当前优先使用已有职责和 seam；本轮不授权实现或框架迁移。

可复述的具体案例包括：Feathers 的 `formatText` 区分观察现状与正确性；dateutil 的历法混用令性质本身错误；AWS 的 35 步反例与漏查活性；Hima 的局部 `sum-valid` PASS 不等于 Goal、插入无关 Reading 不应改变明确绑定成果、receipt 丢失不能重发 effect、永远 unknown 不等于恢复完成。Hima 例子明确标为静态依据或未来反例提案，不是本轮复现。

方法选择、最强反对理由和停止条件也足够清楚：A 面向消费者负担；B 面向状态/权限/恢复；C 面向已证实的变化成本或替换必要性。oracle 复制实现、仅包装接口、删除真实保证、重复现有测试、双重完成权威、无法安全切换，都可令相应路径停止。主文已承认 Hima 净收益、工具/runner 实际兼容、真实模型稳定性、现有测试是否已覆盖建议反例尚未验证。

因此，读者无需打开工作台账就能形成采用判断；正文没有退化成候选工具名录。

## 2. 论证与仓库边界

读取了 `method-evidence.md`、`skills-evidence.md`、`verification-evidence.md`、`empirical-evidence.md`、`repo-gap-map.md` 及四份来源 JSON，并核对 `docs/agents/model-policy.md` 与 `polishing-discipline.md`。

| 复核点 | 结论与依据 |
|---|---|
| 更多 AI review 是否被当成保证 | 没有。主文说明 fresh context 降低作者叙述依赖，但不保证统计独立；要求另一来源的业务期望、实际产物或可执行反例。多 Agent 不是论证终点。 |
| 兼容刻画与正确性 | 明确分成两栏，允许现有行为是 bug；要求身份字段不能被 snapshot 归一化抹去。保持项与预期改变没有被混为一谈。 |
| safety 与 recovery liveness | 明确区分不重复 effect 与事实齐备时最终完成；主文和验证包都拒绝以永久 unknown 宣称恢复成功。 |
| 更多文档/skill 是否被当成工程化 | 没有。主文反复指向已有 Issue、职责与回归；仅非显然、不能由最终代码/测试恢复的教训值得保存。 |
| 是否扩大产品/架构任务 | 没有。两种 consumer 是方法资格样例，不是实施规格；OpenCode 仍通过现有完整工程委派 seam，未建议逐工具编排或新控制面。 |
| 与现有仓库纪律是否重复 | 基础原则确实多数已有，报告承认这一点；可选增量是 oracle、反例和可观察 caller 负担。没有把 A/B/C 写成每个 PR 全跑的新流程。 |
| 本机、上游、release、效果是否混淆 | 没有。本机未证安装 SHA、固定上游 SHA、release 元数据、catalog 可见性和实际效能分别记录。MIT/维护活动未被用于证明有效。 |

额外静态抽查 `package.json` 支持 Node >=24 和现有 unit/local/seam/boundary 入口；`test/contract/agent-recovery.host.test.ts` 中断完成用例确实断言成功 Job 不能证明 route 已提交。这里只核对测试源码的含义，没有运行测试，也没有把其存在写成通过记录。

## 3. 独立来源抽查

本次重新访问五个原始来源，未以证据包摘录替代下列核心事实核对。

| 独立来源 | 实际核对 | 判断 |
|---|---|---|
| [SkillsBench v4](https://arxiv.org/html/2602.12670v4)，§4、Table 2、§5.1.3 | 87 个任务、18 个 model–harness 配置；固定三次试验框下先按任务平均的 pass rate；33.9%→50.5%；13/87 任务负增益。 | 主文数字与版本正确，没有把平均效果外推 Hima 或 Astra。 |
| [AGENTS.md 效率研究 v2](https://arxiv.org/html/2601.20404v2)，§3.1.8、Table 1、§5 | 时间终点为 final output；语义正确性与功能等价不在完整评估范围；有 50 项人工 sanity check，但不是完整正确性评价；时间/token 的效率数字不能当质量结果。 | 主文对测量边界的陈述准确；没有将 sanity check 说成全无人工检查。 |
| [OpenSpec verify 固定源码](https://raw.githubusercontent.com/Fission-AI/OpenSpec/2500d6da971336167548b53731a35b2127df35ac/skills/openspec-verify-change/SKILL.md)，第 4–8 步 | 明确 advisory；通过查找实现、映射意图、检查场景测试是否存在组织报告；没有强制执行测试步骤。 | 报告没有把 verified/archived 误说成运行验收。原文含报告级 archive 建议，不改变它不是运行证明的事实。 |
| [AWS 作者原始报告](https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf)，PDF 第 3、7 页 | DynamoDB 表列三处 bug，正文最短反例为 35 个高层步骤；锁结构漏掉活性 bug 的原因是未检查 liveness。 | 正面价值与限制都被忠实保留；没有将模型检查通过提升为 TypeScript 实现证明。 |
| [Feathers 原文](https://michaelfeathers.silvrback.com/characterization-testing) | `formatText` 从观察实际输出建立测试；实际行为与所希望行为有别；用户曾依赖被当 bug 删掉的行为。 | 支持主文的双基线论证，而非证明旧行为应永久保留。 |

另直接读取本机 `code-review/SKILL.md` 与 `codebase-design/SKILL.md`：前者明确三点 `...HEAD` diff 和两轴 reviewer，后者明确 interface 包含顺序/不变量/错误等，并使用 deletion test 思想实验。报告对 dirty diff 风险和深接口含义的说明正确。

机械身份核对：11 个本机技能文件存在且 SHA256 与台账一致；43 个固定源码副本 SHA256 与台账一致；五组主候选的固定源码 LICENSE 均为 MIT。后两项是本地保存副本的完整性/许可核对，不是重新逐个获取上游或逐文件全语义审查；维护日期与 release 元数据仅检查了台账内部区分，没有重新请求全部 release API。

## 4. 最小修订建议与发布核对

**非阻断措辞建议：解释 deletion test。** 初稿第 70 行“接口深度和删除测试”容易被中文读者理解为删除旧测试。建议替换为“接口深度和‘假想删除模块后，复杂性是否回流到调用者’的检验”。这是模块价值的思想实验；与后文“删除旧浅测试前保留关键约束”属于两回事。无需新增段落或来源。

**发布位置核对：一个链接按最终落点判断。** 初稿指向 `../2026-10-02-fabric-business-graph/report.zh-CN.md`，在当前 `.hima-tmp/ai-engineering-methods-research/` staging 目录下不存在；实际既有报告位于 `docs/product-review/2026-10-02-fabric-business-graph/report.zh-CN.md`。若最终报告发布到 `docs/product-review/<新目录>/`，现有相对链接即正确。只需在实际交付落点核对；不要为了临时目录改坏最终链接。其他主文相对链接在 staging 下均存在。

没有发现需要增加论文、扩充工具名单、安装依赖或新增审批流程才能解决的问题。上述建议已发给主稿持有者；是否采纳由主稿集成者处理。

## 5. 本次通过的范围

“通过”指在限定抽查内，主文可理解、核心结论有一手依据、风险与未验证范围清楚、建议没有超出本次研究任务。它不证明所有来源均已由本 reviewer 全量复核，不证明候选 skills 实际遵从率，不证明 Hima 现有缺陷覆盖完整，也不证明采用后一定更快或更可靠。

本轮没有安装、执行候选 skills、运行测试/Hima/模型/EDA/SSH、创建 Issue、commit 或 push。独立复核本身不成为产品有效性的替代证据。
